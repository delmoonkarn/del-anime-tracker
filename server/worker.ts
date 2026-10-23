// Cloudflare Workers starter: the shared API (server/app.ts) on D1, with
// sign-in always required, plus the monthly backup email (the cron in
// wrangler.toml calls `scheduled` below).
//
// Only /api/* reaches this code. The built frontend in dist/ is served by
// Workers Static Assets, with unknown paths falling back to index.html
// (see [assets] in wrangler.toml).
//
// Optional secrets (`wrangler secret put NAME`, or .dev.vars for wrangler dev).
// Everything else is set from the app's Settings page.
//   SETUP_CODE                        a code first-run setup asks for
//   RESEND_API_KEY / BACKUP_EMAIL_TO  backup email set the old way; copied
//   BACKUP_EMAIL_FROM                 into Settings the first time it's opened

import { createApp } from './app';
import { emailBackup } from './backup';
import { d1Db, type D1Database } from './d1';
import type { EmailConfig } from './email';
import { getEmailSettings } from './settings';

interface Bindings {
  DB: D1Database;
  SETUP_CODE?: string;
  RESEND_API_KEY?: string;
  BACKUP_EMAIL_TO?: string;
  BACKUP_EMAIL_FROM?: string;
}

function serverEmail(env: Bindings): EmailConfig | undefined {
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
  (c) => ({ serverEmail: serverEmail(c.env), cron: true }),
);

export default {
  fetch: app.fetch,
  async scheduled(_controller: unknown, env: Bindings, ctx: { waitUntil(p: Promise<unknown>): void }) {
    const db = d1Db(env.DB);
    ctx.waitUntil(
      (async () => {
        const email = await getEmailSettings(db, serverEmail(env));
        if (!email) {
          console.warn('[backup] monthly email skipped: backup email is not set up (Settings)');
          return;
        }
        if (!email.monthly) {
          console.info('[backup] monthly email is turned off in Settings');
          return;
        }
        await emailBackup(db, email, 'monthly');
      })(),
    );
  },
};
