// Cloudflare Workers starter: the shared API (server/app.ts) on D1, with
// sign-in always required, plus the monthly backup email (the cron in
// wrangler.toml calls `scheduled` below).
//
// Only /api/* reaches this code. The built frontend in dist/ is served by
// Workers Static Assets, with unknown paths falling back to index.html
// (see [assets] in wrangler.toml).
//
// Secrets (`wrangler secret put NAME`, or .dev.vars for wrangler dev):
//   SETUP_CODE                        unlocks first-run account setup
//   RESEND_API_KEY / BACKUP_EMAIL_TO  optional: backup emails
//   BACKUP_EMAIL_FROM                 optional: sender on your own Resend domain

import { createApp } from './app';
import { emailBackup, type EmailConfig } from './backup';
import { d1Db, type D1Database } from './d1';

interface Bindings {
  DB: D1Database;
  SETUP_CODE?: string;
  RESEND_API_KEY?: string;
  BACKUP_EMAIL_TO?: string;
  BACKUP_EMAIL_FROM?: string;
}

function email(env: Bindings): EmailConfig | undefined {
  return env.RESEND_API_KEY && env.BACKUP_EMAIL_TO
    ? { apiKey: env.RESEND_API_KEY, to: env.BACKUP_EMAIL_TO, from: env.BACKUP_EMAIL_FROM }
    : undefined;
}

const app = createApp<{ Bindings: Bindings }>(
  (c) => d1Db(c.env.DB),
  (c) => ({
    required: true,
    setupCode: c.env.SETUP_CODE,
    ip: c.req.header('cf-connecting-ip') ?? 'unknown',
  }),
  (c) => ({ email: email(c.env), monthly: true }),
);

export default {
  fetch: app.fetch,
  async scheduled(_controller: unknown, env: Bindings, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const cfg = email(env);
    if (!cfg) {
      console.warn('[backup] monthly email skipped: set RESEND_API_KEY and BACKUP_EMAIL_TO');
      return;
    }
    ctx.waitUntil(emailBackup(d1Db(env.DB), cfg, 'monthly'));
  },
};
