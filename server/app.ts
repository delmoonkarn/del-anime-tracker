// API routes shared by both starters:
//   server/index.ts  — Node + local SQLite (`npm start`, `npm run dev`, ATracker.exe)
//   server/worker.ts — Cloudflare Workers + D1
// Anything that differs between them (where the database comes from, sign-in
// and backup-email settings, static files) is passed in or added by the
// starter.
//
// Endpoints:
//   GET  /api/storage/:key   → readByKey
//   PUT  /api/storage/:key   → writeByKey
//   POST /api/storage/:key   → writeByKey (mirrors PUT; used by sendBeacon)
//   GET  /api/backup         → download a backup (.sql, server/backup.ts)
//   GET  /api/backup/status  → is email set up, and how did the last one go
//   POST /api/backup/email   → email a backup now
//   /api/auth/*              → sign-in (server/auth.ts)

import { Hono, type Context, type Env } from 'hono';
import { mountAuth, type AuthConfig } from './auth';
import { backupFilename, buildBackupSql, emailBackup, lastBackup, type EmailConfig } from './backup';
import { readByKey, writeByKey, type DbKey } from './db';
import type { SqlDb } from './sql';

export interface BackupConfig {
  email?: EmailConfig;
  /** This server also emails a backup on the 1st of each month (the Workers cron). */
  monthly: boolean;
}

const ALLOWED: ReadonlySet<DbKey> = new Set<DbKey>([
  'state',
  'collection',
  'discover-cache',
  'tags',
  'h-prefs',
  'h-favorites',
  'stream-links',
  'anilist-links',
  'link-sources',
]);
function isAllowed(key: string): key is DbKey {
  return ALLOWED.has(key as DbKey);
}

/**
 * `dbFor` / `authFor` / `backupFor` hand each request its database, sign-in
 * and backup settings (on Workers they come from the request's env).
 */
export function createApp<E extends Env = Env>(
  dbFor: (c: Context<E>) => SqlDb,
  authFor: (c: Context<E>) => AuthConfig,
  backupFor: (c: Context<E>) => BackupConfig,
): Hono<E> {
  const app = new Hono<E>();

  // First, so its "signed in?" check runs before every route added after it,
  // including the ones the starters add.
  mountAuth(app, dbFor, authFor);

  // ---- /api/storage/:key -------------------------------------------------

  app.get('/api/storage/:key', async (c) => {
    const key = c.req.param('key');
    if (!isAllowed(key)) return c.text('Not allowed', 400);
    try {
      const value = await readByKey(dbFor(c), key);
      return c.json(value ?? null);
    } catch (err) {
      console.error(`[api/storage] read ${key} failed`, err);
      return c.text('Read failed', 500);
    }
  });

  async function handleWrite(c: Context<E>) {
    const key = c.req.param('key') ?? '';
    if (!isAllowed(key)) return c.text('Not allowed', 400);
    let raw: string;
    try {
      raw = await c.req.text();
    } catch {
      return c.text('Invalid body', 400);
    }
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return c.text('Invalid JSON', 400);
    }
    try {
      await writeByKey(dbFor(c), key, value);
      return c.text('OK');
    } catch (err) {
      console.error(`[api/storage] write ${key} failed`, err);
      return c.text('Write failed', 500);
    }
  }
  app.put('/api/storage/:key', handleWrite);
  app.post('/api/storage/:key', handleWrite); // sendBeacon on page unload

  // ---- /api/backup -------------------------------------------------------

  app.get('/api/backup', async (c) => {
    try {
      const now = new Date();
      const { sql } = await buildBackupSql(dbFor(c), undefined, now);
      return new Response(sql, {
        headers: {
          'Content-Type': 'application/sql; charset=utf-8',
          'Content-Disposition': `attachment; filename="${backupFilename(now)}"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      console.error('[api/backup] failed', err);
      return c.text('Failed to build the backup', 500);
    }
  });

  app.get('/api/backup/status', async (c) => {
    const cfg = backupFor(c);
    return c.json({
      email: cfg.email ? { to: cfg.email.to } : null,
      monthly: cfg.monthly && !!cfg.email,
      last: await lastBackup(dbFor(c)),
    });
  });

  app.post('/api/backup/email', async (c) => {
    const cfg = backupFor(c);
    if (!cfg.email) return c.json({ error: "Email isn't set up: RESEND_API_KEY and BACKUP_EMAIL_TO." }, 400);
    const result = await emailBackup(dbFor(c), cfg.email, 'manual');
    return c.json(result, result.ok ? 200 : 502);
  });

  return app;
}
