/*
 * Single source of the dashboard's API base URL (DEC-013, NFR-004).
 * `VITE_API_BASE_URL` is the FULL base including `/api/v1`, so no other client file may hard-code
 * that prefix. Reading happens lazily per request: a build without the env var fails with a clear
 * typed error instead of silently calling the wrong origin.
 */

import { ERROR_CODES } from '@focus-mode/shared';

import { ApiError } from './errors';

export const API_BASE_URL_ENV_VAR = 'VITE_API_BASE_URL';

/**
 * Returns the configured base without a trailing slash, e.g. `http://localhost:5000/api/v1`.
 * `client/.env.example` documents the dev and production values (A8 owns the env files).
 */
export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL;

  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ApiError(
      ERROR_CODES.INTERNAL,
      0,
      `${API_BASE_URL_ENV_VAR} is not configured for this dashboard build.`,
    );
  }

  return raw.trim().replace(/\/+$/, '');
}
