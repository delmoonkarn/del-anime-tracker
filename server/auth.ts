// Sign-in. The tracker has one account (yours), which can sign in with a
// username + password, Google, or AniList — any mix, linked from the app's
// Sign-in methods dialog. At least one method always stays linked.
//
// Sessions are rows in auth_session keyed by a SHA-256 of the random token in
// the cookie, so they can be revoked and a database copy holds no live token.
// Everything goes through SqlDb and Web Crypto, so it runs on both starters.
// The Workers starter always requires sign-in; the Node one only when
// REQUIRE_LOGIN=1 (the local app is only reachable from your own PC).
//
// Endpoints:
//   GET    /api/auth/me                   who's signed in, and with what
//   POST   /api/auth/setup                first run: create the account (needs SETUP_CODE)
//   POST   /api/auth/login                username + password
//   POST   /api/auth/logout               this device
//   POST   /api/auth/logout-all           every device
//   PUT    /api/auth/password             set or change username + password
//   DELETE /api/auth/password             remove the password
//   GET    /api/auth/:provider/start      off to Google / AniList (?mode=login|link)
//   GET    /api/auth/:provider/callback   back from Google / AniList
//   DELETE /api/auth/:provider            unlink Google / AniList

import type { Context, Env, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sql, type SqlDb } from './sql';

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface AuthConfig {
  /** false: everything is open and /me says so (the local app's default). */
  required: boolean;
  /** One-time code that unlocks first-run setup; unset means setup is closed. */
  setupCode?: string;
  google?: OAuthClient;
  anilist?: OAuthClient;
  /** The caller's address, for the wrong-password lockout. */
  ip: string;
}

type Provider = 'google' | 'anilist';

const SESSION_COOKIE = 'session';
const STATE_COOKIE = 'oauth_state';
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
interface IdentityRow {
  provider: Provider;
  subject: string;
  label: string | null;
}

function getAccount(db: SqlDb): Promise<AccountRow | null> {
  return db.first<AccountRow>('SELECT username, password_hash FROM auth_account WHERE id = 1');
}

function getIdentities(db: SqlDb): Promise<IdentityRow[]> {
  return db.all<IdentityRow>('SELECT provider, subject, label FROM auth_identity');
}

function isHttps(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c),
    // Lax, not Strict: the cookie has to come along when Google / AniList
    // send you back here, or linking couldn't see who's signed in.
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

// ---- Google / AniList ------------------------------------------------------

interface ProviderSpec {
  authorizeUrl: string;
  extraParams: Record<string, string>;
  /** Trades the code for the provider's id for this person, plus a label to show. */
  identify(client: OAuthClient, code: string, redirectUri: string): Promise<{ subject: string; label: string }>;
}

async function okJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

const PROVIDERS: Record<Provider, ProviderSpec> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    extraParams: { scope: 'openid email profile', prompt: 'select_account' },
    async identify(client, code, redirectUri) {
      const token = await okJson<{ access_token: string }>(
        await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: client.clientId,
            client_secret: client.clientSecret,
            redirect_uri: redirectUri,
          }),
        }),
        'Google token',
      );
      const me = await okJson<{ sub: string; email?: string; name?: string }>(
        await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { Authorization: `Bearer ${token.access_token}` },
        }),
        'Google userinfo',
      );
      return { subject: me.sub, label: me.email ?? me.name ?? 'Google account' };
    },
  },
  anilist: {
    authorizeUrl: 'https://anilist.co/api/v2/oauth/authorize',
    extraParams: {},
    async identify(client, code, redirectUri) {
      const token = await okJson<{ access_token: string }>(
        await fetch('https://anilist.co/api/v2/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            client_id: client.clientId,
            client_secret: client.clientSecret,
            redirect_uri: redirectUri,
            code,
          }),
        }),
        'AniList token',
      );
      const me = await okJson<{ data?: { Viewer?: { id: number; name: string } } }>(
        await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token.access_token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ query: '{ Viewer { id name } }' }),
        }),
        'AniList viewer',
      );
      const viewer = me.data?.Viewer;
      if (!viewer) throw new Error('AniList viewer: no Viewer in response');
      return { subject: String(viewer.id), label: viewer.name };
    },
  },
};

function isProvider(p: string): p is Provider {
  return p === 'google' || p === 'anilist';
}

function redirectUri(c: Context, provider: Provider): string {
  return `${new URL(c.req.url).origin}/api/auth/${provider}/callback`;
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
    const providers = { google: !!cfg.google, anilist: !!cfg.anilist };
    if (!account) return c.json({ required: true, signedIn: false, needsSetup: true, canSetup: !!cfg.setupCode, providers });
    if (!session) return c.json({ required: true, signedIn: false, needsSetup: false, providers });
    const ids = await getIdentities(db);
    const label = (p: Provider) => {
      const row = ids.find((i) => i.provider === p);
      return row ? (row.label ?? p) : null;
    };
    return c.json({
      required: true,
      signedIn: true,
      needsSetup: false,
      providers,
      account: {
        username: account.username,
        hasPassword: account.password_hash != null,
        google: label('google'),
        anilist: label('anilist'),
      },
    });
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

  app.delete('/api/auth/password', async (c) => {
    const db = dbFor(c);
    if (!(await currentSession(c, db))) return c.json({ error: 'signed-out' }, 401);
    if ((await getIdentities(db)).length === 0) {
      return c.json({ error: 'Link Google or AniList first, so you can still sign in.' }, 409);
    }
    await db.batch([sql('UPDATE auth_account SET password_hash = NULL WHERE id = 1')]);
    return c.json({ ok: true });
  });

  app.get('/api/auth/:provider/start', async (c) => {
    const provider = c.req.param('provider');
    const client = isProvider(provider) ? authFor(c)[provider] : undefined;
    if (!isProvider(provider) || !client) return c.json({ error: 'Not set up on this server.' }, 404);
    const mode = c.req.query('mode') === 'link' ? 'link' : 'login';
    const db = dbFor(c);
    if (mode === 'link' && !(await currentSession(c, db))) return c.redirect('/?auth_error=signed-out');
    if (mode === 'login' && !(await getAccount(db))) return c.redirect('/?auth_error=no-account');
    const state = randomToken(16);
    setCookie(c, STATE_COOKIE, `${provider}.${mode}.${state}`, {
      httpOnly: true,
      secure: isHttps(c),
      sameSite: 'Lax',
      path: '/api/auth',
      maxAge: 10 * 60,
    });
    const spec = PROVIDERS[provider];
    const url = new URL(spec.authorizeUrl);
    url.search = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: redirectUri(c, provider),
      response_type: 'code',
      state,
      ...spec.extraParams,
    }).toString();
    return c.redirect(url.toString());
  });

  app.get('/api/auth/:provider/callback', async (c) => {
    const provider = c.req.param('provider');
    const client = isProvider(provider) ? authFor(c)[provider] : undefined;
    if (!isProvider(provider) || !client) return c.json({ error: 'Not set up on this server.' }, 404);
    // The state cookie proves this callback finishes a sign-in this browser
    // started. Without it, someone could send you a link that quietly links
    // *their* Google or AniList account to your tracker.
    const saved = getCookie(c, STATE_COOKIE)?.split('.') ?? [];
    deleteCookie(c, STATE_COOKIE, { path: '/api/auth' });
    const [savedProvider, mode, savedState] = saved;
    const state = c.req.query('state');
    const code = c.req.query('code');
    if (savedProvider !== provider || !savedState || !state || !(await sameText(state, savedState))) {
      return c.redirect('/?auth_error=state');
    }
    if (!code) return c.redirect(`/?auth_error=cancelled`);
    let who: { subject: string; label: string };
    try {
      who = await PROVIDERS[provider].identify(client, code, redirectUri(c, provider));
    } catch (err) {
      console.error(`[auth] ${provider} sign-in failed`, err);
      return c.redirect(`/?auth_error=${provider}`);
    }
    const db = dbFor(c);
    if (mode === 'link') {
      if (!(await currentSession(c, db))) return c.redirect('/?auth_error=signed-out');
      await db.batch([
        sql(
          `INSERT INTO auth_identity (provider, subject, label, linked_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(provider) DO UPDATE SET subject = excluded.subject, label = excluded.label, linked_at = excluded.linked_at`,
          provider,
          who.subject,
          who.label,
          Date.now(),
        ),
      ]);
      return c.redirect(`/?auth=linked-${provider}`);
    }
    const linked = await db.first<{ subject: string }>(
      'SELECT subject FROM auth_identity WHERE provider = ? AND subject = ?',
      provider,
      who.subject,
    );
    if (!linked) return c.redirect(`/?auth_error=not-linked-${provider}`);
    await startSession(c, db);
    return c.redirect('/');
  });

  app.delete('/api/auth/:provider', async (c) => {
    const provider = c.req.param('provider');
    if (!isProvider(provider)) return c.json({ error: 'Unknown sign-in method.' }, 404);
    const db = dbFor(c);
    if (!(await currentSession(c, db))) return c.json({ error: 'signed-out' }, 401);
    const [account, ids] = await Promise.all([getAccount(db), getIdentities(db)]);
    const others = ids.filter((i) => i.provider !== provider).length + (account?.password_hash ? 1 : 0);
    if (others === 0) return c.json({ error: "That's your only way to sign in. Add another first." }, 409);
    await db.batch([sql('DELETE FROM auth_identity WHERE provider = ?', provider)]);
    return c.json({ ok: true });
  });
}
