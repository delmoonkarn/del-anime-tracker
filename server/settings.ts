// Settings changed from the app's Settings page, kept in app_settings. That
// table stays out of backups (server/backup.ts): the Resend key would
// otherwise travel inside every emailed backup.

import type { EmailConfig } from './email';
import { sql, type SqlDb } from './sql';

export interface EmailSettings extends EmailConfig {
  /** Email a backup on the 1st of each month (cloud version). */
  monthly: boolean;
}

interface StoredEmail {
  apiKey: string;
  to: string;
  from: string;
  monthly: boolean;
}

const EMAIL_KEY = 'backup-email';

async function readEmail(db: SqlDb): Promise<StoredEmail | null> {
  const row = await db.first<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', EMAIL_KEY);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as StoredEmail;
  } catch {
    return null;
  }
}

async function writeEmail(db: SqlDb, value: StoredEmail): Promise<void> {
  await db.batch([
    sql(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      EMAIL_KEY,
      JSON.stringify(value),
      Date.now(),
    ),
  ]);
}

/**
 * The backup-email settings, or null when email isn't set up. Servers set up
 * before the Settings page had RESEND_API_KEY / BACKUP_EMAIL_TO secrets
 * (`server`): those are copied in once, the first time nothing is saved yet.
 */
export async function getEmailSettings(db: SqlDb, server?: EmailConfig): Promise<EmailSettings | null> {
  let stored = await readEmail(db);
  if (!stored && server) {
    stored = { apiKey: server.apiKey, to: server.to, from: server.from ?? '', monthly: true };
    await writeEmail(db, stored);
  }
  if (!stored?.apiKey || !stored.to) return null;
  return { apiKey: stored.apiKey, to: stored.to, from: stored.from || undefined, monthly: stored.monthly };
}

/** What the Settings page may see: never the key itself. */
export function describeEmail(s: EmailSettings | null) {
  return s ? { to: s.to, from: s.from ?? '', monthly: s.monthly, keyHint: `••••${s.apiKey.slice(-4)}` } : null;
}

export async function saveEmailSettings(
  db: SqlDb,
  input: { apiKey?: unknown; to?: unknown; from?: unknown; monthly?: unknown },
  server?: EmailConfig,
): Promise<string | null> {
  const current = await getEmailSettings(db, server);
  const apiKey = typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : current?.apiKey;
  const to = typeof input.to === 'string' ? input.to.trim() : '';
  const from = typeof input.from === 'string' ? input.from.trim() : '';
  if (!apiKey) return 'Enter your Resend API key.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return 'Enter the email address to send backups to.';
  if (from && !/@/.test(from)) return 'The sender needs an email address, e.g. Anime Tracker <backup@yourdomain.com>.';
  await writeEmail(db, { apiKey, to, from, monthly: input.monthly !== false });
  return null;
}

/** Turns email off. Kept as a saved, empty setting so old server secrets aren't copied back in. */
export async function clearEmailSettings(db: SqlDb): Promise<void> {
  await writeEmail(db, { apiKey: '', to: '', from: '', monthly: true });
}
