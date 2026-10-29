// API routes shared by both starters:
//   server/index.ts  — Node + local SQLite (`npm start`, `npm run dev`, ATracker.exe)
//   server/worker.ts — Cloudflare Workers + D1
// Anything that differs between them (where the database comes from, sign-in
// settings, static files) is passed in or added by the starter.
//
// Endpoints:
//   GET    /api/storage/:key     → readByKey
//   PUT    /api/storage/:key     → writeByKey
//   POST   /api/storage/:key     → writeByKey (mirrors PUT; used by sendBeacon)
//   GET    /api/backup           → download a backup (.sql, server/backup.ts)
//   GET    /api/backup/status    → is email set up, and how did the last one go
//   POST   /api/backup/email     → email a backup now
//   POST   /api/backup/restore   → load a backup back in (the .sql file as the body)
//   GET    /api/settings         → the Settings page's values (server/settings.ts)
//   PUT    /api/settings/email   → save the backup-email settings
//   DELETE /api/settings/email   → turn backup email off
//   /api/auth/*                  → sign-in (server/auth.ts)

import { Hono, type Context, type Env } from 'hono';
import { mountAuth, type AuthConfig } from './auth';
import {
  BackupFileError,
  backupFilename,
  buildBackupSql,
  emailBackup,
  lastBackup,
  parseBackup,
  restoreBackup,
} from './backup';
import { readByKey, writeByKey, type DbKey } from './db';
import type { EmailConfig } from './email';
import { clearEmailSettings, describeEmail, getEmailSettings, saveEmailSettings } from './settings';
import type { SqlDb } from './sql';

export interface BackupConfig {
  /** RESEND_API_KEY / BACKUP_EMAIL_TO set on the server, copied into Settings once. */
  serverEmail?: EmailConfig;
  /** This server emails a backup on the 1st of each month (the Workers cron). */
  cron: boolean;
  /** Runs just before a restore; resolves to where it saved a copy of the current data. */
  beforeRestore?: () => Promise<string>;
}

const ALLOWED: ReadonlySet<DbKey> = new Set<DbKey>([
  'state',
  'collection',
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

/** A request that a page on another site made the browser send. Browsers set these headers themselves. */
function fromOtherSite(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  if (site) return site !== 'same-origin';
  const origin = req.headers.get('origin');
  return !!origin && origin !== new URL(req.url).origin;
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
  const emailFor = (c: Context<E>) => getEmailSettings(dbFor(c), backupFor(c).serverEmail);

  // Changes come only from the app's own pages. Another site can still get a
  // visitor's browser to send a form or a no-cors request here, and the local
  // app has no sign-in to stop it.
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && fromOtherSite(c.req.raw)) {
      return c.json({ error: 'Not allowed from another site.' }, 403);
    }
    await next();
  });

  // First, so its "signed in?" check runs before every route added after it,
  // including the ones the starters add. Reset links go to the backup email.
  mountAuth(app, dbFor, (c) => ({ ...authFor(c), resetEmail: () => emailFor(c) }));

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
      // Rows changed: other open tabs reload only when something did.
      return c.json({ changed: await writeByKey(dbFor(c), key, value) });
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
    const email = await emailFor(c);
    return c.json({
      email: email ? { to: email.to } : null,
      monthly: backupFor(c).cron && !!email?.monthly,
      last: await lastBackup(dbFor(c)),
    });
  });

  app.post('/api/backup/email', async (c) => {
    const email = await emailFor(c);
    if (!email) return c.json({ error: "Backup email isn't set up yet: add it in Settings." }, 400);
    const result = await emailBackup(dbFor(c), email, 'manual');
    return c.json(result, result.ok ? 200 : 502);
  });

  app.post('/api/backup/restore', async (c) => {
    let backup;
    try {
      backup = parseBackup(await c.req.text());
    } catch (err) {
      if (err instanceof BackupFileError) return c.json({ error: `${err.message} Nothing was changed.` }, 400);
      throw err;
    }
    try {
      const savedCopy = await backupFor(c).beforeRestore?.();
      await restoreBackup(dbFor(c), backup);
      return c.json({ rows: backup.rows, madeAt: backup.madeAt, savedCopy });
    } catch (err) {
      console.error('[api/backup/restore] failed', err);
      const reason = err instanceof Error ? err.message : String(err);
      return c.json({ error: `Couldn't restore it (${reason}). Nothing was changed.` }, 500);
    }
  });

  // ---- /api/settings -----------------------------------------------------

  app.get('/api/settings', async (c) => {
    return c.json({ email: describeEmail(await emailFor(c)), cron: backupFor(c).cron });
  });

  app.put('/api/settings/email', async (c) => {
    let input: Record<string, unknown> = {};
    try {
      input = (await c.req.json()) ?? {};
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }
    const error = await saveEmailSettings(dbFor(c), input, backupFor(c).serverEmail);
    if (error) return c.json({ error }, 400);
    return c.json({ email: describeEmail(await emailFor(c)) });
  });

  app.delete('/api/settings/email', async (c) => {
    await clearEmailSettings(dbFor(c));
    return c.json({ email: null });
  });

  return app;
}
