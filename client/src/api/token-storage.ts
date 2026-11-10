/*
 * Access-token storage for the dashboard (INTEGRATION_CONTRACTS §1.2, TECHNICAL_DESIGN §5.2).
 * The JWT lives in memory and is mirrored to `sessionStorage` so a reload keeps the session; it is
 * deliberately NOT localStorage (30-minute token, no long-lived credential on disk). sessionStorage
 * can throw in private/blocked contexts, so every access degrades to memory-only.
 */

const ACCESS_TOKEN_KEY = 'focus-mode.access-token';

let accessToken: string | null = null;
let hydrated = false;

function getSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    // Storage disabled (privacy mode / sandboxed frame): memory-only session.
    return null;
  }
}

function hydrate(): void {
  hydrated = true;
  const storage = getSessionStorage();
  if (storage === null) return;

  try {
    accessToken = storage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    accessToken = null;
  }
}

/** Current access token (rehydrated from sessionStorage once per page load). */
export function getAccessToken(): string | null {
  if (!hydrated) hydrate();
  return accessToken;
}

/** Store a freshly issued access token (memory first, then best-effort persistence). */
export function setAccessToken(token: string): void {
  accessToken = token;
  hydrated = true;
  const storage = getSessionStorage();
  if (storage === null) return;

  try {
    storage.setItem(ACCESS_TOKEN_KEY, token);
  } catch {
    // Quota/denied: the in-memory token still covers this tab's lifetime.
  }
}

/** Drop the token (logout, 401, or a rejected session rehydrate). */
export function clearAccessToken(): void {
  accessToken = null;
  hydrated = true;
  const storage = getSessionStorage();
  if (storage === null) return;

  try {
    storage.removeItem(ACCESS_TOKEN_KEY);
  } catch {
    // Nothing else to clear — memory is already empty.
  }
}
