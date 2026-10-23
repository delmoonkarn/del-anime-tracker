import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, Loader2, LogOut, UserRound, X } from 'lucide-react';
import { authCall, goToProvider, PROVIDER_NAME, useAuth, type Provider } from '@/lib/auth';
import { useClickOutside } from '@/hooks/useClickOutside';
import { BTN, BTN_ICON, BTN_PRIMARY, DIALOG, DIALOG_BACKDROP, EYEBROW, FIELD, MENU, MENU_ITEM } from '@/lib/ui';
import { useConfirm } from './ConfirmDialog';
import { ProviderIcon } from './ProviderIcon';

/** Header button for the signed-in account. Renders nothing when sign-in is off. */
export function AccountMenu() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [methodsOpen, setMethodsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  const account = auth?.info.account;
  if (!auth || !account) return null;

  async function signOut() {
    await authCall('POST', 'logout');
    await auth?.refresh();
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={BTN_ICON}
        title={`Signed in as ${account.username}`}
        aria-label="Account"
        aria-expanded={open}
      >
        <UserRound className="h-4 w-4" />
      </button>
      {open && (
        <div className={`absolute right-0 mt-2 w-60 p-1.5 ${MENU}`}>
          <div className="px-2.5 pb-2 pt-1.5">
            <div className={EYEBROW}>Signed in as</div>
            <div className="truncate text-sm font-medium text-zinc-100">{account.username}</div>
          </div>
          <button
            type="button"
            className={`${MENU_ITEM} text-sm text-zinc-200`}
            onClick={() => {
              setOpen(false);
              setMethodsOpen(true);
            }}
          >
            <KeyRound className="h-4 w-4 text-zinc-400" />
            Sign-in methods
          </button>
          <button type="button" className={`${MENU_ITEM} text-sm text-zinc-200`} onClick={() => void signOut()}>
            <LogOut className="h-4 w-4 text-zinc-400" />
            Sign out
          </button>
        </div>
      )}
      {methodsOpen && <SignInMethodsDialog onClose={() => setMethodsOpen(false)} />}
    </div>
  );
}

/** Password + Google + AniList: link, unlink, change. One always stays. */
function SignInMethodsDialog({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const confirm = useConfirm();
  const [editingPassword, setEditingPassword] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const info = auth?.info;
  const account = info?.account;
  if (!auth || !info || !account) return null;

  const linkedCount = (account.hasPassword ? 1 : 0) + (account.google ? 1 : 0) + (account.anilist ? 1 : 0);
  const isLast = linkedCount <= 1;

  async function run(call: Promise<string | null>) {
    const err = await call;
    setError(err ?? '');
    await auth?.refresh();
  }

  async function removePassword() {
    const ok = await confirm({
      title: 'Remove password?',
      message: 'You will only be able to sign in with your linked Google / AniList account.',
      confirmText: 'Remove',
      kind: 'warning',
    });
    if (ok) await run(authCall('DELETE', 'password'));
  }

  async function unlink(p: Provider) {
    const ok = await confirm({
      title: `Unlink ${PROVIDER_NAME[p]}?`,
      message: `You won't be able to sign in with ${PROVIDER_NAME[p]} until you link it again.`,
      confirmText: 'Unlink',
      kind: 'warning',
    });
    if (ok) await run(authCall('DELETE', p));
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

  // Portaled: the header's backdrop blur would otherwise pin this "fixed"
  // overlay to the header instead of the window.
  return createPortal(
    <div className={`${DIALOG_BACKDROP} z-50`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${DIALOG} w-full max-w-md`} role="dialog" aria-modal="true" aria-label="Sign-in methods">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-base font-semibold">Sign-in methods</h2>
          <button type="button" className={BTN_ICON} onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-5">
          <p className="text-sm text-zinc-400">
            Sign in with any of these. Keep at least one linked.
          </p>
          {error && (
            <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          )}

          {/* Password */}
          <div className="rounded-xl border border-zinc-800 p-3">
            <div className="flex items-center gap-3">
              <KeyRound className="h-4 w-4 shrink-0 text-zinc-400" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">Username &amp; password</div>
                <div className="truncate text-xs text-zinc-500">
                  {account.hasPassword ? account.username : 'No password set'}
                </div>
              </div>
              {!editingPassword && (
                <>
                  <button type="button" className={BTN} onClick={() => setEditingPassword(true)}>
                    {account.hasPassword ? 'Change' : 'Set'}
                  </button>
                  {account.hasPassword && (
                    <button
                      type="button"
                      className={BTN}
                      disabled={isLast}
                      title={isLast ? 'Link Google or AniList first' : undefined}
                      onClick={() => void removePassword()}
                    >
                      Remove
                    </button>
                  )}
                </>
              )}
            </div>
            {editingPassword && (
              <PasswordForm
                hasPassword={account.hasPassword}
                username={account.username}
                onDone={async () => {
                  setEditingPassword(false);
                  setError('');
                  await auth.refresh();
                }}
                onCancel={() => setEditingPassword(false)}
              />
            )}
          </div>

          {(['google', 'anilist'] as Provider[]).map((p) => {
            const linked = account[p];
            const available = !!info.providers?.[p];
            return (
              <div key={p} className="flex items-center gap-3 rounded-xl border border-zinc-800 p-3">
                <ProviderIcon provider={p} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{PROVIDER_NAME[p]}</div>
                  <div className="truncate text-xs text-zinc-500">
                    {linked ?? (available ? 'Not linked' : 'Not set up on this server')}
                  </div>
                </div>
                {linked ? (
                  <button
                    type="button"
                    className={BTN}
                    disabled={isLast}
                    title={isLast ? 'Add another sign-in method first' : undefined}
                    onClick={() => void unlink(p)}
                  >
                    Unlink
                  </button>
                ) : (
                  available && (
                    <button type="button" className={BTN_PRIMARY} onClick={() => goToProvider(p, 'link')}>
                      Link
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end border-t border-zinc-800 px-5 py-3">
          <button type="button" className={`${BTN} text-rose-300`} onClick={() => void signOutEverywhere()}>
            <LogOut className="h-4 w-4" />
            Sign out everywhere
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PasswordForm({
  hasPassword,
  username: initialUsername,
  onDone,
  onCancel,
}: {
  hasPassword: boolean;
  username: string;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = `${FIELD} w-full`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) {
      setError("The new passwords don't match.");
      return;
    }
    setBusy(true);
    const err = await authCall('PUT', 'password', { current, username, password });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    await onDone();
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col gap-2 border-t border-zinc-800 pt-3">
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {hasPassword && (
        <input
          className={input}
          type="password"
          placeholder="Current password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      )}
      <input
        className={input}
        placeholder="Username"
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        className={input}
        type="password"
        placeholder="New password (8+ characters)"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <input
        className={input}
        type="password"
        placeholder="New password again"
        autoComplete="new-password"
        value={again}
        onChange={(e) => setAgain(e.target.value)}
      />
      <p className="text-xs text-zinc-500">Saving signs out your other devices.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className={BTN_PRIMARY}
          disabled={busy || !username.trim() || password.length < 8 || (hasPassword && !current)}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </button>
      </div>
    </form>
  );
}
