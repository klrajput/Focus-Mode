// `GET /auth/me` (INTEGRATION_CONTRACTS §3.1 #5). Owned by AuthProvider for session rehydration and
// re-exported for components that need the freshest public user (e.g. profile read-only view).

import { useQuery } from '@tanstack/react-query';

import { authApi } from '../api/endpoints/auth';
import { queryKeys } from './query-keys';

export interface UseMeOptions {
  /** `false` while no access token exists, so the app never calls an anonymous `/auth/me`. */
  enabled?: boolean;
}

export function useMe({ enabled = true }: UseMeOptions = {}) {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: authApi.me,
    enabled,
    // A 401 here is handled by the HTTP client + AuthProvider, not by query retries.
    retry: false,
  });
}
