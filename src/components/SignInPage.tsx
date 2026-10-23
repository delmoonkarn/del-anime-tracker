import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiCall, authCall, clearResetToken, type AuthInfo } from '@/lib/auth';
import { BTN_PRIMARY, FIELD, SURFACE } from '@/lib/ui';

const INPUT = `${FIELD} h-10 w-full`;

/** The centered card every signed-out screen sits in. */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className={`${SURFACE} w-full max-w-sm p-6 sm:p-7`}>
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/logo.png" alt="" className="h-9 w-9 rounded-lg" />
          <span className="text-lg font-bold tracking-tight">Anime Tracker</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** First-run setup when there's no account yet, otherwise sign-in (or "forgot password"). */
export function SignInPage({ info, onSignedIn }: { info: AuthInfo; onSignedIn: () => void }) {
  const [forgot, setForgot] = useState(false);
  return (
    <Card>
      {info.needsSetup ? (
        <SetupForm needsCode={!!info.needsCode} onDone={onSignedIn} />
      ) : forgot ? (
        <ForgotForm onBack={() => setForgot(false)} />
      ) : (
        <SignInForm canReset={!!info.canReset} onForgot={() => setForgot(true)} onDone={onSignedIn} />
      )}
    </Card>
  );
}

function Note({ ok = false, text }: { ok?: boolean; text: string }) {
  return (
    <p
      role={ok ? 'status' : 'alert'}
      className={`rounded-lg border px-3 py-2 text-sm ${
        ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
      }`}
    >
      {text}
    </p>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function SignInForm({ canReset, onForgot, onDone }: { canReset: boolean; onForgot: () => void; onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const err = await authCall('POST', 'login', { username, password });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Sign in</h1>
      {error && <Note text={error} />}
      <Field label="Username">
        <input className={INPUT} autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
      </Field>
      <Field label="Password">
        <input
          className={INPUT}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <button type="submit" className={`${BTN_PRIMARY} h-10`} disabled={busy || !username || !password}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Sign in
      </button>
      {canReset && (
        <button type="button" className="self-center text-sm text-zinc-400 hover:text-zinc-100" onClick={onForgot}>
          Forgot password?
        </button>
      )}
    </form>
  );
}

function ForgotForm({ onBack }: { onBack: () => void }) {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    const { data, error } = await apiCall<{ to: string }>('POST', '/api/auth/forgot');
    setBusy(false);
    setNote(
      error
        ? { ok: false, text: error }
        : { ok: true, text: `Sent to ${data?.to}. Open the link in it within 30 minutes (check spam too).` },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Forgot your password?</h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          We'll email a link to your backup email address. It lets you choose a new password; your data stays as it is.
        </p>
      </div>
      {note && <Note {...note} />}
      <button type="button" className={`${BTN_PRIMARY} h-10`} disabled={busy} onClick={() => void send()}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {note?.ok ? 'Send it again' : 'Email me a reset link'}
      </button>
      <button type="button" className="self-center text-sm text-zinc-400 hover:text-zinc-100" onClick={onBack}>
        Back to sign in
      </button>
    </div>
  );
}

function SetupForm({ needsCode, onDone }: { needsCode: boolean; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    const err = await authCall('POST', 'setup', { code, username, password });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onDone();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Set up your tracker</h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          Create the account that owns this tracker. Until you do, anyone who opens this address could, so do it now.
        </p>
      </div>
      {error && <Note text={error} />}
      {needsCode && (
        <Field label="Setup code (SETUP_CODE on the server)">
          <input className={INPUT} autoComplete="off" autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
      )}
      <Field label="Username">
        <input className={INPUT} autoComplete="username" autoFocus={!needsCode} value={username} onChange={(e) => setUsername(e.target.value)} />
      </Field>
      <Field label="Password (8+ characters)">
        <input
          className={INPUT}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field label="Password again">
        <input
          className={INPUT}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>
      <button
        type="submit"
        className={`${BTN_PRIMARY} h-10`}
        disabled={busy || (needsCode && !code) || !username || password.length < 8 || !confirm}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Create account
      </button>
    </form>
  );
}

/** Opened from the emailed link (?reset=...): choose a new password. */
export function ResetPasswordPage({ token, onDone }: { token: string; onDone: () => void }) {
  const [username, setUsername] = useState<string | null>(null);
  const [linkError, setLinkError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data, error: err } = await apiCall<{ username: string }>('POST', '/api/auth/reset/check', { token });
      if (err) setLinkError(err);
      else setUsername(data?.username ?? '');
    })();
  }, [token]);

  function leave() {
    clearResetToken();
    onDone();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setBusy(true);
    const err = await authCall('POST', 'reset', { token, username, password });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    leave();
  }

  return (
    <Card>
      {linkError ? (
        <div className="flex flex-col gap-4">
          <h1 className="text-xl font-semibold">Reset your password</h1>
          <Note text={linkError} />
          <button type="button" className={`${BTN_PRIMARY} h-10`} onClick={leave}>
            Go to sign in
          </button>
        </div>
      ) : username === null ? (
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-zinc-500" />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <h1 className="text-xl font-semibold">Choose a new password</h1>
            <p className="mt-1.5 text-sm text-zinc-400">Every device signed in to your tracker will be signed out.</p>
          </div>
          {error && <Note text={error} />}
          <Field label="Username">
            <input className={INPUT} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          <Field label="New password (8+ characters)">
            <input
              className={INPUT}
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field label="New password again">
            <input
              className={INPUT}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <button
            type="submit"
            className={`${BTN_PRIMARY} h-10`}
            disabled={busy || !username.trim() || password.length < 8 || !confirm}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save and sign in
          </button>
        </form>
      )}
    </Card>
  );
}
