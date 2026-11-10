/*
 * Session-expiry signal (INTEGRATION_CONTRACTS §1.5, UX_SPEC §6.2 `UNAUTHENTICATED`).
 * The HTTP client is a plain module, so it cannot call `useNavigate`/`useAuth` directly.
 * `AuthProvider` subscribes here once and performs the user-visible consequences: clear the
 * cached user, toast "Your session has expired. Please log in again." and redirect to `/login`.
 */

import type { ApiError } from './errors';

export type UnauthorizedListener = (error: ApiError) => void;

const listeners = new Set<UnauthorizedListener>();

/** Register a listener; returns the unsubscribe function (called on provider unmount). */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Fan out a 401 to the registered auth provider(s). Multiple listeners are supported for tests. */
export function notifyUnauthorized(error: ApiError): void {
  for (const listener of [...listeners]) {
    listener(error);
  }
}
