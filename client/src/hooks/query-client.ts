/*
 * TanStack Query client defaults (TECHNICAL_DESIGN §3, NFR-007).
 * Queries never retry client errors (401/403/404/422/429 are not transient) so an honest error
 * state appears immediately; server/transport failures get two retries. Window-focus refetch is
 * off because focus state comes from the local Focus Agent channel (W2), not from polling REST.
 */

import { QueryClient } from '@tanstack/react-query';

import { isApiError } from '../api/errors';

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error)) {
    // 4xx (and the status-0 transport/configuration error) are deterministic — show the error.
    if (error.status >= 400 && error.status < 500) return false;
    if (error.status === 0) return false;
  }
  return failureCount < 2;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 15_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
