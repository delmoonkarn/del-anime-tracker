// Hono server — replaces the Next.js API routes from the old project.
//
// Dev: runs on :3001, Vite proxies /api/* here from :5173.
// Prod (`npm run build` then `npm start`): also serves the built static
// frontend from dist/, so a single Node process delivers both.
//
// Endpoints:
//   GET  /api/storage/:key   → readByKey
//   PUT  /api/storage/:key   → writeByKey
//   POST /api/storage/:key   → writeByKey (mirrors PUT; used by sendBeacon)
//   GET  /api/db-zip         → streams the SQLite DB inside a date-stamped zip

import { Hono, type Context } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import JSZip from 'jszip';
import { readByKey, writeByKey, readDbSnapshot, type DbKey } from './db';

const PORT = Number(process.env.PORT) || 3001;
const ALLOWED: ReadonlySet<DbKey> = new Set<DbKey>([
  'state',
  'collection',
  'discover-cache',
  'tags',
  'h-prefs',
  'h-favorites',
]);
function isAllowed(key: string): key is DbKey {
  return ALLOWED.has(key as DbKey);
}
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

const app = new Hono();

// ---- /api/storage/:key ---------------------------------------------------

app.get('/api/storage/:key', (c) => {
  const key = c.req.param('key');
  if (!isAllowed(key)) return c.text('Not allowed', 400);
  try {
    const value = readByKey(key);
    return c.json(value ?? null);
  } catch (err) {
    console.error(`[api/storage] read ${key} failed`, err);
    return c.text('Read failed', 500);
  }
});

async function handleWrite(c: Context) {
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
    writeByKey(key, value);
    return c.text('OK');
  } catch (err) {
    console.error(`[api/storage] write ${key} failed`, err);
    return c.text('Write failed', 500);
  }
}
app.put('/api/storage/:key', handleWrite);
app.post('/api/storage/:key', handleWrite); // sendBeacon on page unload

// ---- /api/db-zip ---------------------------------------------------------

app.get('/api/db-zip', async (c) => {
  try {
    const { buffer } = readDbSnapshot();
    const zip = new JSZip();
    // Nested under data/ so extraction matches the project layout — the
    // user can drop the whole data/ folder back at the root to restore.
    zip.file('data/anime-tracker.db', buffer);
    const zipped = await zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    const now = new Date();
    const filename = `${pad(now.getDate())}_${pad(now.getMonth() + 1)}_${now.getFullYear()}_data.zip`;
    return new Response(zipped, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[api/db-zip] failed:', err);
    return c.text('Failed to build database zip', 500);
  }
});

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

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`[api] listening on http://localhost:${info.port}`);
  if (existsSync(distDir)) {
    console.log(`[api] serving static dist/ from same port`);
  }
});
