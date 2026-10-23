import { useCallback, useRef, useState } from 'react';
import { LogOut, Settings, UserRound } from 'lucide-react';
import { authCall, useAuth } from '@/lib/auth';
import { useClickOutside } from '@/hooks/useClickOutside';
import { BTN_ICON, EYEBROW, MENU, MENU_ITEM } from '@/lib/ui';

/**
 * Header button for the signed-in account: Settings (backups live there) and
 * sign out. With sign-in off, as on the local app, it's a plain Settings gear.
 */
export function AccountMenu({ onOpenSettings }: { onOpenSettings: () => void }) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  const account = auth?.info.account;
  if (!auth || !account) {
    return (
      <button type="button" onClick={onOpenSettings} className={`${BTN_ICON} shrink-0`} title="Settings and backups" aria-label="Settings">
        <Settings className="h-4 w-4" />
      </button>
    );
  }

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
              onOpenSettings();
            }}
          >
            <Settings className="h-4 w-4 text-zinc-400" />
            Settings and backups
          </button>
          <button type="button" className={`${MENU_ITEM} text-sm text-zinc-200`} onClick={() => void signOut()}>
            <LogOut className="h-4 w-4 text-zinc-400" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
