/*
 * The dashboard's single HTTP transport (INTEGRATION_CONTRACTS §1.1/§1.4, NFR-002/NFR-004).
 * NOTE: `axios` is not in the W1 dependency set, so this is an equivalent typed `fetch` client:
 * base URL from `VITE_API_BASE_URL` (full base incl. `/api/v1`), Bearer auth, query serialisation,
 * `{success,data}` unwrapping, `{success:false,error}` → `ApiError`, and 401 → clear token + notify.
 * Endpoint modules (`src/api/endpoints/*`) are the only callers; hooks/components never call fetch.
 */

import {
  ERROR_CODES,
  isErrorCode,
  type ApiSuccess,
  type ErrorCode,
  type ValidationIssue,
} from '@focus-mode/shared';

import { getApiBaseUrl } from './config';
import { ApiError, errorCodeForStatus } from './errors';
import { clearAccessToken, getAccessToken } from './token-storage';
import { notifyUnauthorized } from './unauthorized';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Values accepted in a query object; `undefined`/`null`/`''` entries are dropped. */
export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Readonly<Record<string, QueryValue>>;

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: QueryParams;
  signal?: AbortSignal;
  /** `false` for public endpoints (login/register) so no stale token is sent. */
  auth?: boolean;
}

/** Generic English fallback when the API answers outside the documented envelope. */
const STATUS_MESSAGE: Readonly<Record<number, string>> = Object.freeze({
  400: 'Request validation failed',
  401: 'Authentication required',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  410: 'Gone',
  429: 'Too many requests',
  500: 'Internal server error',
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDetails(value: unknown): ValidationIssue[] {
  if (!Array.isArray(value)) return [];
  const details: ValidationIssue[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) continue;
    if (typeof entry.path !== 'string' || typeof entry.message !== 'string') continue;
    details.push({ path: entry.path, message: entry.message });
  }

  return details;
}

function parseSuccess<T>(payload: unknown): ApiSuccess<T> | null {
  if (!isRecord(payload) || payload.success !== true) return null;
  if (!('data' in payload)) return null;
  return { success: true, data: payload.data as T };
}

function parseFailure(
  payload: unknown,
): { code: ErrorCode; message: string; details: ValidationIssue[] } | null {
  if (!isRecord(payload) || payload.success !== false || !isRecord(payload.error)) return null;

  const rawCode = payload.error.code;
  const rawMessage = payload.error.message;
  return {
    code: isErrorCode(rawCode) ? rawCode : ERROR_CODES.INTERNAL,
    message:
      typeof rawMessage === 'string' && rawMessage.trim() !== ''
        ? rawMessage
        : 'The API returned an error without a message.',
    details: parseDetails(payload.error.details),
  };
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (text === '') return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function buildSearch(query: QueryParams | undefined): string {
  if (query === undefined) return '';

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }

  const search = params.toString();
  return search === '' ? '' : `?${search}`;
}

/** 401 means the token is dead: clear it and let `AuthProvider` redirect + toast (UX_SPEC §6.2). */
function raise(error: ApiError, notifySessionExpiry: boolean): never {
  if (notifySessionExpiry && error.code === ERROR_CODES.UNAUTHENTICATED) {
    clearAccessToken();
    notifyUnauthorized(error);
  }
  throw error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Perform one API call and resolve with the unwrapped `data`.
 * Throws `ApiError` for envelope failures, transport failures and configuration failures.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${path}${buildSearch(options.query)}`;

  const headers = new Headers({ Accept: 'application/json' });
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');

  const isAuthenticatedRequest = options.auth !== false;
  const token = isAuthenticatedRequest ? getAccessToken() : null;
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      credentials: 'omit',
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    raise(
      new ApiError(ERROR_CODES.INTERNAL, 0, `The request to ${path} could not reach the API.`),
      false,
    );
  }

  const payload = await readPayload(response);

  if (response.ok) {
    const success = parseSuccess<T>(payload);
    if (success === null) {
      raise(
        new ApiError(
          ERROR_CODES.INTERNAL,
          response.status,
          `The API returned an unexpected body for ${path}.`,
        ),
        isAuthenticatedRequest,
      );
    }
    return success.data;
  }

  const failure = parseFailure(payload);
  if (failure !== null) {
    raise(
      new ApiError(failure.code, response.status, failure.message, failure.details),
      isAuthenticatedRequest,
    );
  }

  raise(
    new ApiError(
      errorCodeForStatus(response.status),
      response.status,
      STATUS_MESSAGE[response.status] ?? 'The API request failed.',
    ),
    isAuthenticatedRequest,
  );
}
