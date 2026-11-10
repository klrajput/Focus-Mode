/*
 * AuthProvider — access token in memory + sessionStorage rehydration (INTEGRATION_CONTRACTS §1.2).
 * On mount it asks `/auth/me` only when a token exists, so an anonymous visitor never triggers a
 * pointless 401. A 401 anywhere (subscribed via `onUnauthorized`) clears the token, removes the
 * cached user, toasts the UX_SPEC §6.2 message and redirects to /login. Login/register responses
 * include the public user, so signing in does not need a second round-trip.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { LoginInput, RegisterInput } from '@focus-mode/shared';

import { authApi } from '../api/endpoints/auth';
import { isApiError } from '../api/errors';
import { clearAccessToken, getAccessToken, setAccessToken } from '../api/token-storage';
import type { AuthResult, PublicUser } from '../api/types';
import { onUnauthorized } from '../api/unauthorized';
import { copyForCode } from '../copy/errors';
import { useMe } from '../hooks/use-me';
import { queryKeys } from '../hooks/query-keys';
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context';

export interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [hasToken, setHasToken] = useState<boolean>(() => getAccessToken() !== null);
  const meQuery = useMe({ enabled: hasToken });

  // Session expiry (401) fan-out from the HTTP client.
  useEffect(() => {
    return onUnauthorized((error) => {
      clearAccessToken();
      setHasToken(false);
      queryClient.removeQueries({ queryKey: queryKeys.me });
      toast.error(copyForCode(error.code));
      navigate('/login', { replace: true });
    });
  }, [navigate, queryClient]);

  const adoptSession = useCallback(
    (result: AuthResult): PublicUser => {
      setAccessToken(result.accessToken);
      queryClient.setQueryData<PublicUser>(queryKeys.me, result.user);
      setHasToken(true);
      return result.user;
    },
    [queryClient],
  );

  const login = useCallback(
    async (input: LoginInput): Promise<PublicUser> => adoptSession(await authApi.login(input)),
    [adoptSession],
  );

  const register = useCallback(
    async (input: RegisterInput): Promise<PublicUser> =>
      adoptSession(await authApi.register(input)),
    [adoptSession],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await authApi.logout();
    } catch {
      // A dead token must not block local logout; the client state is cleared either way.
    }
    clearAccessToken();
    setHasToken(false);
    queryClient.removeQueries({ queryKey: queryKeys.me });
    navigate('/login', { replace: true });
  }, [navigate, queryClient]);

  const retry = useCallback((): void => {
    void meQuery.refetch();
  }, [meQuery]);

  const status: AuthStatus = useMemo(() => {
    if (!hasToken) return 'anonymous';
    if (meQuery.isPending) return 'loading';
    if (meQuery.isError) {
      return isApiError(meQuery.error) && meQuery.error.code === 'UNAUTHENTICATED'
        ? 'anonymous'
        : 'error';
    }
    return meQuery.data === undefined ? 'loading' : 'authenticated';
  }, [hasToken, meQuery.data, meQuery.error, meQuery.isError, meQuery.isPending]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: status === 'authenticated' ? (meQuery.data ?? null) : null,
      login,
      register,
      logout,
      retry,
    }),
    [status, meQuery.data, login, register, logout, retry],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
