import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';
import { AuthContext, describeAuthResult, fetchAuth, SIGNED_OUT_EVENT, type AuthInfo } from '@/lib/auth';
import { BTN } from '@/lib/ui';
import { SignInPage } from './SignInPage';

// Google / AniList send you back with ?auth=... or ?auth_error=...; read it
// once at load and tidy the address bar.
function takeRedirectResult() {
  const params = new URLSearchParams(window.location.search);
  const result = describeAuthResult(params);
  if (result) {
    params.delete('auth');
    params.delete('auth_error');
    const query = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }
  return result;
}

/**
 * Renders the app only once you're signed in (or when sign-in is off, as on
 * the local app), so a signed-out visitor never loads — or saves over — an
 * empty tracker. Shows first-run setup / the sign-in page otherwise.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<AuthInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState(takeRedirectResult);

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

  // Notices (e.g. "Google is linked") clear themselves.
  useEffect(() => {
    if (!result?.notice) return;
    const t = setTimeout(() => setResult(null), 6000);
    return () => clearTimeout(t);
  }, [result]);

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
    return (
      <SignInPage
        info={info}
        initialError={result?.error}
        onSignedIn={() => {
          setResult(null);
          void refresh();
        }}
      />
    );
  }

  return (
    <AuthContext.Provider value={{ info, refresh }}>
      {children}
      {result && (result.notice || result.error) && (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 z-50 flex w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-2xl motion-safe:animate-pop-in ${
            result.error
              ? 'border-rose-500/40 bg-zinc-900 text-rose-200'
              : 'border-emerald-500/40 bg-zinc-900 text-emerald-200'
          }`}
        >
          <span className="flex-1">{result.error ?? result.notice}</span>
          <button type="button" onClick={() => setResult(null)} className="text-zinc-400 hover:text-zinc-100" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </AuthContext.Provider>
  );
}
