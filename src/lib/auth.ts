// Client side of sign-in (server/auth.ts). AuthGate (components/AuthGate.tsx)
// asks /api/auth/me on load and shows the sign-in page until you're in.

import { createContext, useContext } from 'react';

export type Provider = 'google' | 'anilist';

export interface AuthInfo {
  /** false on the local app: no sign-in at all. */
  required: boolean;
  signedIn?: boolean;
  /** No account yet: first-run setup. */
  needsSetup?: boolean;
  /** Setup is possible (SETUP_CODE is set on the server). */
  canSetup?: boolean;
  /** Which of Google / AniList the server has client ids for. */
  providers?: Record<Provider, boolean>;
  account?: {
    username: string;
    hasPassword: boolean;
    /** Linked account's label (email / AniList name), or null. */
    google: string | null;
    anilist: string | null;
  };
}

export const PROVIDER_NAME: Record<Provider, string> = { google: 'Google', anilist: 'AniList' };

/** storage.ts fires this when the server answers 401 mid-session. */
export const SIGNED_OUT_EVENT = 'auth:signed-out';

export async function fetchAuth(): Promise<AuthInfo> {
  const res = await fetch('/api/auth/me', { cache: 'no-store' });
  if (!res.ok) throw new Error(`auth/me: HTTP ${res.status}`);
  return (await res.json()) as AuthInfo;
}

/** Calls an auth endpoint; resolves to the server's error message, or null when it worked. */
export async function authCall(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<string | null> {
  try {
    const res = await fetch(`/api/auth/${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return data?.error ?? `Something went wrong (HTTP ${res.status}).`;
  } catch {
    return "Couldn't reach the server.";
  }
}

/** Full-page trip to Google / AniList; they send you back to /api/auth/:provider/callback. */
export function goToProvider(provider: Provider, mode: 'login' | 'link'): void {
  window.location.href = `/api/auth/${provider}/start?mode=${mode}`;
}

/** What the server's ?auth_error= / ?auth= redirect codes mean. */
export function describeAuthResult(params: URLSearchParams): { error?: string; notice?: string } | null {
  const error = params.get('auth_error');
  const done = params.get('auth');
  if (done === 'linked-google') return { notice: 'Google is linked. You can sign in with it now.' };
  if (done === 'linked-anilist') return { notice: 'AniList is linked. You can sign in with it now.' };
  if (!error) return null;
  const messages: Record<string, string> = {
    'not-linked-google':
      "That Google account isn't linked to this tracker. Sign in another way, then link it under Sign-in methods.",
    'not-linked-anilist':
      "That AniList account isn't linked to this tracker. Sign in another way, then link it under Sign-in methods.",
    'signed-out': 'Your session ended. Sign in, then try linking again.',
    'no-account': 'This tracker has no account yet. Set it up first.',
    state: 'That sign-in link expired or came from somewhere else. Try again.',
    cancelled: 'Sign-in was cancelled.',
    google: "Google sign-in didn't go through. Try again.",
    anilist: "AniList sign-in didn't go through. Try again.",
  };
  return { error: messages[error] ?? 'Sign-in failed. Try again.' };
}

export interface AuthContextValue {
  info: AuthInfo;
  /** Asks the server again (after linking, signing out, ...). */
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}
