// Node starter: the shared API (server/app.ts) on local SQLite.
//
// Dev: runs on :3001, Vite proxies /api/* here from :5173.
// Prod (`npm run build` then `npm start`, or ATracker.exe): also serves the
// built static frontend from dist/, so a single Node process delivers both.
//
// Sign-in is off: the local app is only reachable from your own PC. Running
// this on a server instead? Set REQUIRE_LOGIN=1 plus the same SETUP_CODE /
// GOOGLE_* / ANILIST_* variables the Workers starter reads.
//
// "Email backup now" works here too with RESEND_API_KEY + BACKUP_EMAIL_TO
// set; the monthly email is the cloud version's (Workers cron).

import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createApp } from './app';
import { writeByKey } from './db';
import { importLegacyJson, openSqlite } from './sqlite';

const PORT = Number(process.env.PORT) || 3001;
const DATA_DIR = join(process.cwd(), 'data');
const db = openSqlite(join(DATA_DIR, 'anime-tracker.db')).db;

const env = process.env;
const client = (id?: string, secret?: string) => (id && secret ? { clientId: id, clientSecret: secret } : undefined);
const app = createApp(
  () => db,
  (c) => ({
    required: env.REQUIRE_LOGIN === '1',
    setupCode: env.SETUP_CODE,
    google: client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
    anilist: client(env.ANILIST_CLIENT_ID, env.ANILIST_CLIENT_SECRET),
    ip: getConnInfo(c).remote.address ?? 'unknown',
  }),
  () => ({
    email:
      env.RESEND_API_KEY && env.BACKUP_EMAIL_TO
        ? { apiKey: env.RESEND_API_KEY, to: env.BACKUP_EMAIL_TO, from: env.BACKUP_EMAIL_FROM }
        : undefined,
    monthly: false,
  }),
);

// ---- Static frontend (production only) ----------------------------------
// In dev, Vite serves the frontend on :5173 and proxies /api here. In prod,
// `npm run build` outputs to dist/, and this server serves both.
const distDir = resolve(process.cwd(), 'dist');
if (existsSync(distDir)) {
  app.use(
    '*',
    serveStatic({
      root: './dist',
      rewriteRequestPath: (path) => {
        // Anything without a file extension that didn't match an API route
        // falls back to index.html (SPA single-route).
        if (path.startsWith('/api/')) return path;
        const ext = extname(path);
        return ext ? path : '/index.html';
      },
    }),
  );
  // Fallback for routes the rewrite didn't catch (e.g. exact /).
  app.get('*', (c) => {
    const html = readFileSync(join(distDir, 'index.html'), 'utf-8');
    return c.html(html);
  });
}

// Pull in JSON files left by very old versions before taking requests.
importLegacyJson(DATA_DIR, (key, value) => writeByKey(db, key, value)).finally(() => {
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`[api] listening on http://localhost:${info.port}`);
    if (existsSync(distDir)) {
      console.log(`[api] serving static dist/ from same port`);
    }
  });
});
