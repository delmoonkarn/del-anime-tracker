// Client side of sign-in (server/auth.ts). AuthGate (components/AuthGate.tsx)
// asks /api/auth/me on load and shows the sign-in page until you're in.

import { createContext, useContext } from 'react';

export interface AuthInfo {
  /** false on the local app: no sign-in at all. */
  required: boolean;
  signedIn?: boolean;
  /** No account yet: first-run setup. */
  needsSetup?: boolean;
  /** Setup is possible (SETUP_CODE is set on the server). */
  canSetup?: boolean;
  account?: { username: string };
}

/** storage.ts fires this when the server answers 401 mid-session. */
export const SIGNED_OUT_EVENT = 'auth:signed-out';

export async function fetchAuth(): Promise<AuthInfo> {
  const res = await fetch('/api/auth/me', { cache: 'no-store' });
  if (!res.ok) throw new Error(`auth/me: HTTP ${res.status}`);
  return (await res.json()) as AuthInfo;
}

/** Calls an auth endpoint; resolves to the server's error message, or null when it worked. */
export async function authCall(
  method: 'POST' | 'PUT',
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

export interface AuthContextValue {
  info: AuthInfo;
  /** Asks the server again (after signing out, ...). */
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}
