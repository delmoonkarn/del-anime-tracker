// Node starter: the shared API (server/app.ts) on local SQLite.
//
// Dev: runs on :3001, Vite proxies /api/* here from :5173.
// Prod (`npm run build` then `npm start`, or ATracker.exe): also serves the
// built static frontend from dist/, so a single Node process delivers both.
//
// Endpoints added here on top of server/app.ts:
//   GET  /api/db-zip         → streams the SQLite DB inside a date-stamped zip

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import JSZip from 'jszip';
import { createApp } from './app';
import { writeByKey } from './db';
import { importLegacyJson, openSqlite } from './sqlite';

const PORT = Number(process.env.PORT) || 3001;
const DATA_DIR = join(process.cwd(), 'data');
const local = openSqlite(join(DATA_DIR, 'anime-tracker.db'));
const db = local.db;
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

const app = createApp(() => db);

// ---- /api/db-zip ---------------------------------------------------------

app.get('/api/db-zip', async (c) => {
  try {
    const buffer = local.snapshot();
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

// Pull in JSON files left by very old versions before taking requests.
importLegacyJson(DATA_DIR, (key, value) => writeByKey(db, key, value)).finally(() => {
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`[api] listening on http://localhost:${info.port}`);
    if (existsSync(distDir)) {
      console.log(`[api] serving static dist/ from same port`);
    }
  });
});
