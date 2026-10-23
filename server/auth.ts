// Sign-in. The tracker has one account (yours): a username + password.
//
// Sessions are rows in auth_session keyed by a SHA-256 of the random token in
// the cookie, so they can be revoked and a database copy holds no live token.
// Everything goes through SqlDb and Web Crypto, so it runs on both starters.
// The Workers starter always requires sign-in; the Node one only when
// REQUIRE_LOGIN=1 (the local app is only reachable from your own PC).
//
// Endpoints:
//   GET    /api/auth/me                   who's signed in
//   POST   /api/auth/setup                first run: create the account (needs SETUP_CODE)
//   POST   /api/auth/login                username + password
//   POST   /api/auth/logout               this device
//   POST   /api/auth/logout-all           every device
//   PUT    /api/auth/password             change username + password

import type { Context, Env, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sql, type SqlDb } from './sql';

export interface AuthConfig {
  /** false: everything is open and /me says so (the local app's default). */
  required: boolean;
  /** One-time code that unlocks first-run setup; unset means setup is closed. */
  setupCode?: string;
  /** The caller's address, for the wrong-password lockout. */
  ip: string;
}

const SESSION_COOKIE = 'session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
// Sessions in use get pushed out again once they're past halfway.
const RENEW_BELOW_MS = SESSION_MS / 2;
const LOCKOUT_TRIES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
// PBKDF2 rounds. OWASP suggests far more, but each request on the Workers
// free plan gets 10 ms of CPU and 100k rounds take ~25 ms. The lockout above
// keeps online guessing slow; the round count is stored with each hash, so
// raising this re-hashes the password at its next sign-in.
const PBKDF2_ROUNDS = 25_000;

// ---- Crypto helpers --------------------------------------------------------

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}

function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256(text: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}

/** Compares without bailing out at the first difference. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sameText(a: string, b: string): Promise<boolean> {
  // Hash first so the comparison doesn't leak the secret's length either.
  return sameBytes(fromB64url(await sha256(a)), fromB64url(await sha256(b)));
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, rounds: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256);
  return new Uint8Array(bits);
}

/** "pbkdf2-sha256$rounds$salt$hash" */
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ROUNDS);
  return `pbkdf2-sha256$${PBKDF2_ROUNDS}$${b64url(salt)}$${b64url(hash)}`;
}

async function checkPassword(password: string, stored: string): Promise<{ ok: boolean; rehash: boolean }> {
  const [scheme, rounds, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2-sha256' || !rounds || !salt || !hash) return { ok: false, rehash: false };
  const got = await pbkdf2(password, fromB64url(salt), Number(rounds));
  const ok = sameBytes(got, fromB64url(hash));
  return { ok, rehash: ok && Number(rounds) < PBKDF2_ROUNDS };
}

// ---- Account and sessions --------------------------------------------------

interface AccountRow {
  username: string;
  password_hash: string | null;
}

function getAccount(db: SqlDb): Promise<AccountRow | null> {
  return db.first<AccountRow>('SELECT username, password_hash FROM auth_account WHERE id = 1');
}

function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MS / 1000,
  });
}

async function startSession(c: Context, db: SqlDb): Promise<void> {
  const token = randomToken();
  const now = Date.now();
  await db.batch([
    sql('DELETE FROM auth_session WHERE expires_at < ?', now),
    sql('INSERT INTO auth_session (token_hash, created_at, expires_at) VALUES (?, ?, ?)', await sha256(token), now, now + SESSION_MS),
  ]);
  setSessionCookie(c, token);
}

/** The signed-in session's token hash, or null. Renews sessions past halfway. */
async function currentSession(c: Context, db: SqlDb): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Date.now();
  const row = await db.first<{ expires_at: number }>(
    'SELECT expires_at FROM auth_session WHERE token_hash = ? AND expires_at > ?',
    tokenHash,
    now,
  );
  if (!row) return null;
  if (row.expires_at - now < RENEW_BELOW_MS) {
    await db.batch([sql('UPDATE auth_session SET expires_at = ? WHERE token_hash = ?', now + SESSION_MS, tokenHash)]);
    setSessionCookie(c, token);
  }
  return tokenHash;
}

async function lockedOut(db: SqlDb, ip: string): Promise<boolean> {
  const row = await db.first<{ n: number }>(
    'SELECT COUNT(*) AS n FROM auth_failure WHERE ip = ? AND at > ?',
    ip,
    Date.now() - LOCKOUT_MS,
  );
  return (row?.n ?? 0) >= LOCKOUT_TRIES;
}

async function recordFailure(db: SqlDb, ip: string): Promise<void> {
  const now = Date.now();
  await db.batch([
    sql('DELETE FROM auth_failure WHERE at < ?', now - 24 * 60 * 60 * 1000),
    sql('INSERT INTO auth_failure (ip, at) VALUES (?, ?)', ip, now),
  ]);
}

function cleanUsername(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length >= 1 && s.length <= 64 ? s : null;
}

function cleanPassword(v: unknown): string | null {
  return typeof v === 'string' && v.length >= 8 && v.length <= 256 ? v : null;
}

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const v = await c.req.json();
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ---- Routes ----------------------------------------------------------------

export function mountAuth<E extends Env>(
  app: Hono<E>,
  dbFor: (c: Context<E>) => SqlDb,
  authFor: (c: Context<E>) => AuthConfig,
): void {
  // Everything else under /api needs a session when sign-in is required.
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/')) return next();
    if (!authFor(c).required) return next();
    if (await currentSession(c, dbFor(c))) return next();
    return c.json({ error: 'signed-out' }, 401);
  });

  // The auth routes below only exist when sign-in is required.
  app.use('/api/auth/*', async (c, next) => {
    if (c.req.path === '/api/auth/me' || authFor(c).required) return next();
    return c.json({ error: 'sign-in is off' }, 404);
  });

  app.get('/api/auth/me', async (c) => {
    const cfg = authFor(c);
    if (!cfg.required) return c.json({ required: false });
    const db = dbFor(c);
    const [account, session] = await Promise.all([getAccount(db), currentSession(c, db)]);
    if (!account) return c.json({ required: true, signedIn: false, needsSetup: true, canSetup: !!cfg.setupCode });
    if (!session) return c.json({ required: true, signedIn: false, needsSetup: false });
    return c.json({ required: true, signedIn: true, needsSetup: false, account: { username: account.username } });
  });

  app.post('/api/auth/setup', async (c) => {
    const cfg = authFor(c);
    const db = dbFor(c);
    if (await getAccount(db)) return c.json({ error: 'The account already exists.' }, 409);
    if (!cfg.setupCode) return c.json({ error: 'Setup is closed: SETUP_CODE is not set.' }, 403);
    if (await lockedOut(db, cfg.ip)) return c.json({ error: 'Too many wrong tries. Wait 15 minutes.' }, 429);
    const b = await body(c);
    if (typeof b.code !== 'string' || !(await sameText(b.code, cfg.setupCode))) {
      await recordFailure(db, cfg.ip);
      return c.json({ error: 'Wrong setup code.' }, 403);
    }
    const username = cleanUsername(b.username);
    const password = cleanPassword(b.password);
    if (!username) return c.json({ error: 'Pick a username (up to 64 characters).' }, 400);
    if (!password) return c.json({ error: 'The password needs at least 8 characters.' }, 400);
    await db.batch([
      sql(
        'INSERT INTO auth_account (id, username, password_hash, created_at) VALUES (1, ?, ?, ?)',
        username,
        await hashPassword(password),
        Date.now(),
      ),
    ]);
    await startSession(c, db);
    return c.json({ ok: true });
  });

  app.post('/api/auth/login', async (c) => {
    const cfg = authFor(c);
    const db = dbFor(c);
    if (await lockedOut(db, cfg.ip)) return c.json({ error: 'Too many wrong tries. Wait 15 minutes.' }, 429);
    const b = await body(c);
    const account = await getAccount(db);
    const result =
      account?.password_hash &&
      typeof b.username === 'string' &&
      typeof b.password === 'string' &&
      b.username.trim().toLowerCase() === account.username.toLowerCase()
        ? await checkPassword(b.password, account.password_hash)
        : { ok: false, rehash: false };
    if (!result.ok) {
      await recordFailure(db, cfg.ip);
      return c.json({ error: 'Wrong username or password.' }, 401);
    }
    const statements = [sql('DELETE FROM auth_failure WHERE ip = ?', cfg.ip)];
    if (result.rehash) {
      statements.push(sql('UPDATE auth_account SET password_hash = ? WHERE id = 1', await hashPassword(b.password as string)));
    }
    await db.batch(statements);
    await startSession(c, db);
    return c.json({ ok: true });
  });

  app.post('/api/auth/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await dbFor(c).batch([sql('DELETE FROM auth_session WHERE token_hash = ?', await sha256(token))]);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.post('/api/auth/logout-all', async (c) => {
    const db = dbFor(c);
    if (!(await currentSession(c, db))) return c.json({ error: 'signed-out' }, 401);
    await db.batch([sql('DELETE FROM auth_session')]);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.put('/api/auth/password', async (c) => {
    const db = dbFor(c);
    const session = await currentSession(c, db);
    if (!session) return c.json({ error: 'signed-out' }, 401);
    const account = await getAccount(db);
    if (!account) return c.json({ error: 'signed-out' }, 401);
    const b = await body(c);
    if (account.password_hash) {
      const ok = typeof b.current === 'string' && (await checkPassword(b.current, account.password_hash)).ok;
      if (!ok) return c.json({ error: 'Your current password is wrong.' }, 403);
    }
    const username = cleanUsername(b.username);
    const password = cleanPassword(b.password);
    if (!username) return c.json({ error: 'Pick a username (up to 64 characters).' }, 400);
    if (!password) return c.json({ error: 'The password needs at least 8 characters.' }, 400);
    // A new password signs out every other device.
    await db.batch([
      sql('UPDATE auth_account SET username = ?, password_hash = ? WHERE id = 1', username, await hashPassword(password)),
      sql('DELETE FROM auth_session WHERE token_hash != ?', session),
    ]);
    return c.json({ ok: true });
  });
}
