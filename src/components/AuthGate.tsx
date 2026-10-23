import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { AuthContext, fetchAuth, SIGNED_OUT_EVENT, type AuthInfo } from '@/lib/auth';
import { BTN } from '@/lib/ui';
import { SignInPage } from './SignInPage';

/**
 * Renders the app only once you're signed in (or when sign-in is off, as on
 * the local app), so a signed-out visitor never loads — or saves over — an
 * empty tracker. Shows first-run setup / the sign-in page otherwise.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<AuthInfo | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setInfo(await fetchAuth());
      setFailed(false);
    } catch (err) {
      console.warn('[auth] /api/auth/me failed', err);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onSignedOut = () => void refresh();
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [refresh]);

  if (failed && !info) {
    return (
      <div className="grid min-h-screen place-items-center px-4 text-center">
        <div className="flex flex-col items-center gap-3 text-sm text-zinc-400">
          Couldn't reach the server.
          <button type="button" className={BTN} onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!info) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }
  if (info.required && !info.signedIn) {
    return <SignInPage info={info} onSignedIn={() => void refresh()} />;
  }

  return <AuthContext.Provider value={{ info, refresh }}>{children}</AuthContext.Provider>;
}
