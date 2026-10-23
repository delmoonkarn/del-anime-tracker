import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { authCall, type AuthInfo } from '@/lib/auth';
import { BTN_PRIMARY, FIELD, SURFACE } from '@/lib/ui';

interface Props {
  info: AuthInfo;
  onSignedIn: () => void;
}

const INPUT = `${FIELD} h-10 w-full`;

/** First-run setup when there's no account yet, otherwise the sign-in form. */
export function SignInPage({ info, onSignedIn }: Props) {
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className={`${SURFACE} w-full max-w-sm p-6 sm:p-7`}>
        <div className="mb-6 flex items-center gap-2.5">
          <img src="/logo.png" alt="" className="h-9 w-9 rounded-lg" />
          <span className="text-lg font-bold tracking-tight">Anime Tracker</span>
        </div>
        {info.needsSetup ? (
          <SetupForm canSetup={!!info.canSetup} onDone={onSignedIn} />
        ) : (
          <SignInForm onDone={onSignedIn} />
        )}
      </div>
    </div>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
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

function SignInForm({ onDone }: { onDone: () => void }) {
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
      {error && <ErrorNote text={error} />}
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
    </form>
  );
}

function SetupForm({ canSetup, onDone }: { canSetup: boolean; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!canSetup) {
    return (
      <div className="flex flex-col gap-3 text-sm text-zinc-300">
        <h1 className="text-xl font-semibold text-zinc-100">Set up your tracker</h1>
        <p>This tracker has no account yet, and setup is closed.</p>
        <p>
          Set a setup code on the server first, then reload:
          <code className="mt-2 block rounded-lg bg-zinc-950 px-3 py-2 text-xs text-zinc-200">
            npx wrangler secret put SETUP_CODE
          </code>
        </p>
      </div>
    );
  }

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
          Create the account that owns this tracker.
        </p>
      </div>
      {error && <ErrorNote text={error} />}
      <Field label="Setup code (SETUP_CODE on the server)">
        <input className={INPUT} autoComplete="off" autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Field label="Username">
        <input className={INPUT} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
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
        disabled={busy || !code || !username || password.length < 8 || !confirm}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Create account
      </button>
    </form>
  );
}
