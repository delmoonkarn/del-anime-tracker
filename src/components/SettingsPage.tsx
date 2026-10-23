import { useEffect, useRef, useState } from 'react';
import { Download, KeyRound, Loader2, LogOut, Mail, Upload } from 'lucide-react';
import { apiCall, authCall, useAuth } from '@/lib/auth';
import { resumeSaving, stopSaving } from '@/lib/storage';
import { BTN, BTN_PRIMARY, EYEBROW, FIELD, SURFACE } from '@/lib/ui';
import { useConfirm } from './ConfirmDialog';
import { PageHeader } from './PageHeader';

interface EmailView {
  to: string;
  from: string;
  monthly: boolean;
  /** The saved key's last characters, e.g. "••••a1b2". */
  keyHint: string;
}

interface LastBackup {
  at: number;
  ok: boolean;
  reason: 'monthly' | 'manual';
  error?: string;
}

const INPUT = `${FIELD} h-10 w-full`;

function Note({ ok, text }: { ok: boolean; text: string }) {
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

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-zinc-300">{label}</span>
      {children}
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`${SURFACE} p-5 sm:p-6`}>
      <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function when(at: number): string {
  return new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Account and backup-email settings: everything that used to need the terminal. */
export function SettingsPage() {
  const auth = useAuth();
  const account = auth?.info.account;
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <PageHeader title="Settings" description="Your account, and how your data gets backed up." />
      <div className="flex flex-col gap-5">
        {account && <AccountSection username={account.username} />}
        <BackupSection signedIn={!!account} />
      </div>
    </div>
  );
}

// ---- Account ---------------------------------------------------------------

function AccountSection({ username: savedUsername }: { username: string }) {
  const auth = useAuth();
  const confirm = useConfirm();
  const [current, setCurrent] = useState('');
  const [username, setUsername] = useState(savedUsername);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) {
      setNote({ ok: false, text: "The new passwords don't match." });
      return;
    }
    setBusy(true);
    const err = await authCall('PUT', 'password', { current, username, password });
    setBusy(false);
    if (err) {
      setNote({ ok: false, text: err });
      return;
    }
    setCurrent('');
    setPassword('');
    setAgain('');
    setNote({ ok: true, text: 'Saved. Your other devices were signed out.' });
    await auth?.refresh();
  }

  async function signOutEverywhere() {
    const ok = await confirm({
      title: 'Sign out everywhere?',
      message: 'Every device signed in to this tracker, including this one, will need to sign in again.',
      confirmText: 'Sign out everywhere',
      kind: 'danger',
    });
    if (!ok) return;
    await authCall('POST', 'logout-all');
    await auth?.refresh();
  }

  return (
    <Section title="Account" icon={<KeyRound className="h-4 w-4 text-zinc-400" />}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <p className="text-sm text-zinc-400">
          Signed in as <span className="font-medium text-zinc-100">{savedUsername}</span>. To change your username or
          password, enter your current password first.
        </p>
        {note && <Note {...note} />}
        <Field label="Current password">
          <input className={INPUT} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="Username">
          <input className={INPUT} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="New password" hint="8 or more characters">
            <input className={INPUT} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="New password again">
            <input className={INPUT} type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button type="button" className={`${BTN} text-rose-300`} onClick={() => void signOutEverywhere()}>
            <LogOut className="h-4 w-4" />
            Sign out everywhere
          </button>
          <button
            type="submit"
            className={BTN_PRIMARY}
            disabled={busy || !current || !username.trim() || password.length < 8 || !again}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </form>
    </Section>
  );
}

// ---- Backups -----------------------------------------------------------------

function BackupSection({ signedIn }: { signedIn: boolean }) {
  const confirm = useConfirm();
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState<EmailView | null>(null);
  const [cron, setCron] = useState(false);
  const [last, setLast] = useState<LastBackup | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [to, setTo] = useState('');
  const [from, setFrom] = useState('');
  const [monthly, setMonthly] = useState(true);
  const [showFrom, setShowFrom] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [restoreNote, setRestoreNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'save' | 'send' | 'remove' | 'restore' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function show(view: EmailView | null) {
    setEmail(view);
    setApiKey('');
    setTo(view?.to ?? '');
    setFrom(view?.from ?? '');
    setMonthly(view?.monthly ?? true);
    setShowFrom(!!view?.from);
  }

  async function loadLast() {
    const { data } = await apiCall<{ last: LastBackup | null }>('GET', '/api/backup/status');
    setLast(data?.last ?? null);
  }

  useEffect(() => {
    void (async () => {
      const { data } = await apiCall<{ email: EmailView | null; cron: boolean }>('GET', '/api/settings');
      show(data?.email ?? null);
      setCron(!!data?.cron);
      setLoaded(true);
      await loadLast();
    })();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save');
    setNote(null);
    const { data, error } = await apiCall<{ email: EmailView }>('PUT', '/api/settings/email', { apiKey, to, from, monthly });
    setBusy(null);
    if (error) {
      setNote({ ok: false, text: error });
      return;
    }
    show(data?.email ?? null);
    setNote({ ok: true, text: 'Saved. Send a backup now to check it arrives.' });
  }

  async function sendNow() {
    setBusy('send');
    setNote(null);
    const { error } = await apiCall('POST', '/api/backup/email');
    setBusy(null);
    setNote(error ? { ok: false, text: error } : { ok: true, text: `Sent to ${email?.to}. Check your inbox (and spam).` });
    await loadLast();
  }

  async function remove() {
    const ok = await confirm({
      title: 'Turn off backup email?',
      message: signedIn
        ? 'No more backup emails, and "Forgot password?" stops working until you set email up again. Your saved API key is deleted.'
        : 'No more backup emails. Your saved API key is deleted.',
      confirmText: 'Turn off',
      kind: 'warning',
    });
    if (!ok) return;
    setBusy('remove');
    await apiCall('DELETE', '/api/settings/email');
    setBusy(null);
    show(null);
    setNote({ ok: true, text: 'Backup email is off.' });
  }

  function download() {
    // A temporary <a> so the browser takes the filename from Content-Disposition.
    const a = document.createElement('a');
    a.href = '/api/backup';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function restore(file: File) {
    setRestoreNote(null);
    const text = await file.text();
    const madeAt = /^-- Anime Tracker backup, (\S+)/.exec(text)?.[1];
    if (!madeAt) {
      setRestoreNote({ ok: false, text: "That file isn't an Anime Tracker backup. Nothing was changed." });
      return;
    }
    const ok = await confirm({
      title: 'Restore this backup?',
      message: `Everything in your tracker is replaced with the backup from ${when(Date.parse(madeAt))}. Your account and settings stay as they are. Close the tracker on your other devices first, or they may save their old data back over it.`,
      confirmText: 'Restore',
      kind: 'danger',
    });
    if (!ok) return;
    setBusy('restore');
    await stopSaving();
    let result: { rows?: number; savedCopy?: string; error?: string };
    try {
      const res = await fetch('/api/backup/restore', { method: 'POST', headers: { 'content-type': 'application/sql' }, body: text });
      result = (await res.json().catch(() => null)) ?? { error: `Something went wrong (HTTP ${res.status}). Nothing was changed.` };
    } catch {
      result = { error: "Couldn't reach the server. Nothing was changed." };
    }
    if (result.error || result.rows === undefined) {
      resumeSaving();
      setBusy(null);
      setRestoreNote({ ok: false, text: result.error ?? 'Something went wrong.' });
      return;
    }
    const copy = result.savedCopy ? ` What you had before is saved in ${result.savedCopy}.` : '';
    setRestoreNote({ ok: true, text: `Restored ${result.rows} rows.${copy} Reloading…` });
    // This page still holds the old data; start over from the restored one.
    setTimeout(() => window.location.reload(), copy ? 4000 : 1500);
  }

  return (
    <Section title="Backups" icon={<Mail className="h-4 w-4 text-zinc-400" />}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-400">A copy of your tracker data as a .sql file.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BTN} disabled={!!busy} onClick={() => fileRef.current?.click()}>
                {busy === 'restore' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Restore from backup
              </button>
              <button type="button" className={BTN} onClick={download}>
                <Download className="h-4 w-4" />
                Download backup
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".sql"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void restore(file);
              }}
            />
          </div>
          {restoreNote && <Note {...restoreNote} />}
        </div>

        <div className="border-t border-zinc-800 pt-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className={EYEBROW}>Backup email</div>
            {loaded && (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  email ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {email ? 'On' : 'Off'}
              </span>
            )}
          </div>
          <p className="mb-4 text-sm text-zinc-400">
            Emails you a backup{cron ? ' on the 1st of every month' : ' when you ask'}
            {signedIn ? ', and sends the link when you forget your password' : ''}. It goes through{' '}
            <a href="https://resend.com" target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline">
              Resend
            </a>{' '}
            (free): sign up there, then create an API key under API Keys with Sending access.
          </p>

          {!loaded ? (
            <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
          ) : (
            <form onSubmit={save} className="flex flex-col gap-3">
              {note && <Note {...note} />}
              <Field label="Resend API key">
                <input
                  className={INPUT}
                  type="password"
                  autoComplete="off"
                  placeholder={email ? `Saved (${email.keyHint}). Leave empty to keep it.` : 're_...'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </Field>
              <Field
                label="Send backups to"
                hint="Unless your own domain is set up on Resend, this has to be the email you signed up to Resend with."
              >
                <input className={INPUT} type="email" autoComplete="email" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
              {cron && (
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} className="h-4 w-4 accent-indigo-500" />
                  Email a backup on the 1st of every month
                </label>
              )}
              {showFrom ? (
                <Field label="Sender (optional)" hint="Only with your own domain verified on Resend.">
                  <input
                    className={INPUT}
                    placeholder="Anime Tracker <backup@yourdomain.com>"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </Field>
              ) : (
                <button type="button" className="self-start text-xs text-zinc-500 hover:text-zinc-300" onClick={() => setShowFrom(true)}>
                  Using your own domain on Resend? Set the sender
                </button>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap gap-2">
                  {email && (
                    <>
                      <button type="button" className={BTN} disabled={!!busy} onClick={() => void sendNow()}>
                        {busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                        Send a backup now
                      </button>
                      <button type="button" className={`${BTN} text-rose-300`} disabled={!!busy} onClick={() => void remove()}>
                        Turn off
                      </button>
                    </>
                  )}
                </div>
                <button type="submit" className={BTN_PRIMARY} disabled={!!busy || !to.trim() || (!email && !apiKey.trim())}>
                  {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />}
                  {email ? 'Save changes' : 'Turn on'}
                </button>
              </div>
              {last && (
                <p className={`text-xs ${last.ok ? 'text-zinc-500' : 'text-rose-300'}`}>
                  Last {last.reason === 'monthly' ? 'monthly email' : 'email'}: {when(last.at)},{' '}
                  {last.ok ? 'sent' : `failed${last.error ? ` (${last.error})` : ''}`}
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </Section>
  );
}
