-- Sign-in (server/auth.ts). Kept out of backups: they hold how you sign in,
-- not tracker data.

-- The one account. id is always 1.
CREATE TABLE auth_account (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  password_hash TEXT,
  created_at INTEGER NOT NULL
);

-- Google / AniList accounts linked to it, one per provider. subject is the
-- provider's id for you; label is what the app shows (email, AniList name).
CREATE TABLE auth_identity (
  provider TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  label TEXT,
  linked_at INTEGER NOT NULL
);

-- Signed-in devices. token_hash is a SHA-256 of the cookie's token.
CREATE TABLE auth_session (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Wrong passwords / setup codes, for the 5-tries-per-15-minutes lockout.
CREATE TABLE auth_failure (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX idx_auth_failure_ip ON auth_failure(ip, at);
