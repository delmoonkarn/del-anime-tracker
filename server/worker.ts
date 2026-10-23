// Cloudflare Workers starter: the shared API (server/app.ts) on D1, with
// sign-in always required.
//
// Only /api/* reaches this code. The built frontend in dist/ is served by
// Workers Static Assets, with unknown paths falling back to index.html
// (see [assets] in wrangler.toml).
//
// Secrets (`wrangler secret put NAME`, or .dev.vars for wrangler dev):
//   SETUP_CODE                                  unlocks first-run account setup
//   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET     optional: Sign in with Google
//   ANILIST_CLIENT_ID / ANILIST_CLIENT_SECRET   optional: Sign in with AniList

import { createApp } from './app';
import type { OAuthClient } from './auth';
import { d1Db, type D1Database } from './d1';

type Env = {
  Bindings: {
    DB: D1Database;
    SETUP_CODE?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    ANILIST_CLIENT_ID?: string;
    ANILIST_CLIENT_SECRET?: string;
  };
};

function client(id?: string, secret?: string): OAuthClient | undefined {
  return id && secret ? { clientId: id, clientSecret: secret } : undefined;
}

const app = createApp<Env>(
  (c) => d1Db(c.env.DB),
  (c) => ({
    required: true,
    setupCode: c.env.SETUP_CODE,
    google: client(c.env.GOOGLE_CLIENT_ID, c.env.GOOGLE_CLIENT_SECRET),
    anilist: client(c.env.ANILIST_CLIENT_ID, c.env.ANILIST_CLIENT_SECRET),
    ip: c.req.header('cf-connecting-ip') ?? 'unknown',
  }),
);

export default app;
