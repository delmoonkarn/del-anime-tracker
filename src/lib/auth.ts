// Client side of sign-in (server/auth.ts). AuthGate (components/AuthGate.tsx)
// asks /api/auth/me on load and shows the sign-in page until you're in.

import { createContext, useContext } from 'react';

export interface AuthInfo {
  /** false on the local app: no sign-in at all. */
  required: boolean;
  signedIn?: boolean;
  /** No account yet: first-run setup. */
  needsSetup?: boolean;
  /** Setup asks for the server's SETUP_CODE. */
  needsCode?: boolean;
  /** "Forgot password?" works (backup email is set up). */
  canReset?: boolean;
  account?: { username: string };
}

/** storage.ts fires this when the server answers 401 mid-session. */
export const SIGNED_OUT_EVENT = 'auth:signed-out';

export async function fetchAuth(): Promise<AuthInfo> {
  const res = await fetch('/api/auth/me', { cache: 'no-store' });
  if (!res.ok) throw new Error(`auth/me: HTTP ${res.status}`);
  return (await res.json()) as AuthInfo;
}

/**
 * Calls one of the app's own JSON endpoints. Resolves to { data } when it
 * worked, or { error } with the server's message.
 */
export async function apiCall<T = Record<string, unknown>>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  body?: Record<string, unknown>,
): Promise<{ data?: T; error?: string }> {
  try {
    const res = await fetch(url, {
      method,
      cache: 'no-store',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (res.ok) return { data: data ?? undefined };
    return { error: data?.error ?? `Something went wrong (HTTP ${res.status}).` };
  } catch {
    return { error: "Couldn't reach the server." };
  }
}

/** An /api/auth call; resolves to the server's error message, or null when it worked. */
export async function authCall(
  method: 'POST' | 'PUT',
  path: string,
  body?: Record<string, unknown>,
): Promise<string | null> {
  return (await apiCall(method, `/api/auth/${path}`, body)).error ?? null;
}

/** The token from a reset link (?reset=...), if this page was opened from one. */
export function resetTokenFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('reset');
}

/** Drops ?reset=... from the address bar once it's been used. */
export function clearResetToken(): void {
  const params = new URLSearchParams(window.location.search);
  params.delete('reset');
  const query = params.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

export interface AuthContextValue {
  info: AuthInfo;
  /** Asks the server again (after signing out, ...). */
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}
