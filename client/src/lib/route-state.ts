/*
 * Small, typed helpers around router state and query errors used by the auth pages.
 * `fromRouteState` only accepts same-origin absolute paths so a crafted `state.from` can never
 * turn the login redirect into an open redirect.
 */

import { isApiError } from '../api/errors';

/** Read the attempted path stored by `RequireAuth` (`state.from`); `null` when absent/unsafe. */
export function fromRouteState(state: unknown): string | null {
  if (typeof state !== 'object' || state === null) return null;

  const from = (state as { from?: unknown }).from;
  if (typeof from !== 'string') return null;
  if (!from.startsWith('/') || from.startsWith('//')) return null;

  return from;
}

/** Muted `(Ref: CODE)` value for an `ErrorState`; undefined for non-API failures. */
export function errorCodeOf(error: unknown): string | undefined {
  return isApiError(error) ? error.code : undefined;
}
