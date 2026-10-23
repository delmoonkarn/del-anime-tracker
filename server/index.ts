// Node starter: the shared API (server/app.ts) on local SQLite.
//
// Dev: runs on :3001, Vite proxies /api/* here from :5173.
// Prod (`npm run build` then `npm start`, or ATracker.exe): also serves the
// built static frontend from dist/, so a single Node process delivers both.
//
// Sign-in is off, so the app listens only on this PC (127.0.0.1) and answers
// only to its own names. Running this on a server instead? Set HOST=0.0.0.0,
// REQUIRE_LOGIN=1 and SETUP_CODE.
//
// Backup email is set up from the Settings page here too ("Email backup
// now"); the monthly email is the cloud version's (Workers cron).

import { serve } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createApp } from './app';
import { openSqlite } from './sqlite';

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '127.0.0.1';

// Answers only to this PC's own names: otherwise a website could point its
// domain at 127.0.0.1 (DNS rebinding), and its pages could use the app.
const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
function fromThisPc(req: Request): boolean {
  return HOST !== '127.0.0.1' || LOCAL_NAMES.has(new URL(req.url).hostname);
}
const DATA_DIR = join(process.cwd(), 'data');
const local = openSqlite(join(DATA_DIR, 'anime-tracker.db'));
const db = local.db;

/** Before a restore from Settings: the current data, copied aside (as npm run restore does). */
async function saveCopy(): Promise<string> {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const name = `anime-tracker.before-restore-${stamp}.db`;
  await local.copyTo(join(DATA_DIR, name));
  return `data/${name}`;
}

const env = process.env;
const app = createApp(
  () => db,
  (c) => ({
    required: env.REQUIRE_LOGIN === '1',
    setupCode: env.SETUP_CODE,
    ip: getConnInfo(c).remote.address ?? 'unknown',
  }),
  () => ({
    serverEmail:
      env.RESEND_API_KEY && env.BACKUP_EMAIL_TO
        ? { apiKey: env.RESEND_API_KEY, to: env.BACKUP_EMAIL_TO, from: env.BACKUP_EMAIL_FROM }
        : undefined,
    cron: false,
    beforeRestore: saveCopy,
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

const fetch: typeof app.fetch = (req, env) =>
  fromThisPc(req) ? app.fetch(req, env) : new Response('Not found', { status: 403 });
serve({ fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
  if (existsSync(distDir)) {
    console.log(`[api] serving static dist/ from same port`);
  }
});
