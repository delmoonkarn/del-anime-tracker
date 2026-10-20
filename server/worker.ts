// Cloudflare Workers starter: the shared API (server/app.ts) on D1.
//
// Only /api/* reaches this code. The built frontend in dist/ is served by
// Workers Static Assets, with unknown paths falling back to index.html
// (see [assets] in wrangler.toml).

import { createApp } from './app';
import { d1Db, type D1Database } from './d1';

type Env = { Bindings: { DB: D1Database } };

const app = createApp<Env>((c) => d1Db(c.env.DB));

export default app;
