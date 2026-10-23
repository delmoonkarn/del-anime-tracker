-- Settings changed from the app's Settings page (server/settings.ts), e.g.
-- the backup email's Resend key and address. Left out of backups.
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Password-reset links (server/auth.ts). token_hash is a SHA-256 of the
-- link's token; each link works once, for 30 minutes.
CREATE TABLE auth_reset (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
