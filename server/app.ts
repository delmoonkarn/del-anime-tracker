// API routes shared by both starters:
//   server/index.ts  — Node + local SQLite (`npm start`, `npm run dev`, ATracker.exe)
//   server/worker.ts — Cloudflare Workers + D1
// Anything that differs between them (where the database comes from, sign-in
// settings, static files, the backup download) is passed in or added by the
// starter.
//
// Endpoints:
//   GET  /api/storage/:key   → readByKey
//   PUT  /api/storage/:key   → writeByKey
//   POST /api/storage/:key   → writeByKey (mirrors PUT; used by sendBeacon)
//   /api/auth/*              → sign-in (server/auth.ts)

import { Hono, type Context, type Env } from 'hono';
import { mountAuth, type AuthConfig } from './auth';
import { readByKey, writeByKey, type DbKey } from './db';
import type { SqlDb } from './sql';

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
 * `dbFor` / `authFor` hand each request its database and sign-in settings
 * (on Workers both come from the request's env).
 */
export function createApp<E extends Env = Env>(
  dbFor: (c: Context<E>) => SqlDb,
  authFor: (c: Context<E>) => AuthConfig,
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

  return app;
}
