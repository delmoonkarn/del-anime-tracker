import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KeyRound, Loader2, LogOut, UserRound, X } from 'lucide-react';
import { authCall, useAuth } from '@/lib/auth';
import { useClickOutside } from '@/hooks/useClickOutside';
import { BTN, BTN_ICON, BTN_PRIMARY, DIALOG, DIALOG_BACKDROP, EYEBROW, FIELD, MENU, MENU_ITEM } from '@/lib/ui';
import { useConfirm } from './ConfirmDialog';

/** Header button for the signed-in account. Renders nothing when sign-in is off. */
export function AccountMenu() {
  const auth = useAuth();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  const account = auth?.info.account;
  if (!auth || !account) return null;

  async function signOut() {
    await authCall('POST', 'logout');
    await auth?.refresh();
  }

  async function signOutEverywhere() {
    setOpen(false);
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
              setPasswordOpen(true);
            }}
          >
            <KeyRound className="h-4 w-4 text-zinc-400" />
            Change password
          </button>
          <button type="button" className={`${MENU_ITEM} text-sm text-zinc-200`} onClick={() => void signOut()}>
            <LogOut className="h-4 w-4 text-zinc-400" />
            Sign out
          </button>
          <button type="button" className={`${MENU_ITEM} text-sm text-rose-300`} onClick={() => void signOutEverywhere()}>
            <LogOut className="h-4 w-4" />
            Sign out everywhere
          </button>
        </div>
      )}
      {passwordOpen && <PasswordDialog username={account.username} onClose={() => setPasswordOpen(false)} />}
    </div>
  );
}

function PasswordDialog({ username: initialUsername, onClose }: { username: string; onClose: () => void }) {
  const auth = useAuth();
  const [current, setCurrent] = useState('');
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = `${FIELD} h-10 w-full`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    await auth?.refresh();
    onClose();
  }

  // Portaled: the header's backdrop blur would otherwise pin this "fixed"
  // overlay to the header instead of the window.
  return createPortal(
    <div className={`${DIALOG_BACKDROP} z-50`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        onSubmit={submit}
        className={`${DIALOG} w-full max-w-sm`}
        role="dialog"
        aria-modal="true"
        aria-label="Change password"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-base font-semibold">Change password</h2>
          <button type="button" className={BTN_ICON} onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-2.5 p-5">
          {error && (
            <p role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
              {error}
            </p>
          )}
          <input
            className={input}
            type="password"
            placeholder="Current password"
            autoComplete="current-password"
            autoFocus
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
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
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button type="button" className={BTN} onClick={onClose}>
            Cancel
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
    </div>,
    document.body,
  );
}
