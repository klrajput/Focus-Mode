/*
 * Auth context contract (INTEGRATION_CONTRACTS §1.2, UX_SPEC §3).
 * Separated from the provider component so route guards, tests and the AppShell can consume the
 * exact same typed value without importing the provider's API calls. `status` makes every gate
 * render an honest loading/error/redirect state instead of guessing from a nullable user.
 */

import { createContext, useContext } from 'react';
import type { LoginInput, RegisterInput } from '@focus-mode/shared';

import type { PublicUser } from '../api/types';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

export interface AuthContextValue {
  status: AuthStatus;
  user: PublicUser | null;
  /** Authenticate, persist the access token and cache the public user. */
  login: (input: LoginInput) => Promise<PublicUser>;
  /** Create an account (always role USER server-side) and treat it as signed in. */
  register: (input: RegisterInput) => Promise<PublicUser>;
  /** Best-effort server logout, then always drop the local session and land on /login. */
  logout: () => Promise<void>;
  /** Retry `/auth/me` rehydration after a transient failure. */
  retry: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error('useAuth must be used inside <AuthProvider> (or a test AuthContext.Provider)');
  }
  return value;
}
