/*
 * Typed client error for every API failure (INTEGRATION_CONTRACTS §1.4/§1.5, NFR-002).
 * The API only ever answers with `{success:false,error:{code,message,details?}}` or a transport
 * failure, so the dashboard normalises both into this one class. `code` drives user-facing copy
 * (`src/copy/errors.ts`, UX_SPEC §6.2); `message` stays the server/support string and is never the
 * primary UI message. No stack trace is shown to a user.
 */

import { ERROR_CODES, type ErrorCode, type ValidationIssue } from '@focus-mode/shared';

/** HTTP statuses mapped to the frozen 13-code vocabulary when the body is not an envelope. */
const STATUS_TO_CODE: Readonly<Record<number, ErrorCode>> = Object.freeze({
  400: ERROR_CODES.VALIDATION_ERROR,
  401: ERROR_CODES.UNAUTHENTICATED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  410: ERROR_CODES.PAIRING_EXPIRED,
  429: ERROR_CODES.RATE_LIMITED,
  500: ERROR_CODES.INTERNAL,
});

/** Fallback code for an out-of-contract HTTP status (e.g. a proxy 502). */
export function errorCodeForStatus(status: number): ErrorCode {
  return STATUS_TO_CODE[status] ?? ERROR_CODES.INTERNAL;
}

/** Normalised API/transport error. Always carries a contract error code. */
export class ApiError extends Error {
  readonly code: ErrorCode;

  /** HTTP status, or `0` for a transport/configuration failure (no response). */
  readonly status: number;

  /** Field-level issues for `VALIDATION_ERROR`; empty for every other code. */
  readonly details: readonly ValidationIssue[];

  constructor(
    code: ErrorCode,
    status: number,
    message: string,
    details: readonly ValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Narrowing helper for `catch (error: unknown)` blocks and query cache callbacks. */
export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Build a typed error from an unknown value (keeps existing `ApiError`s untouched). */
export function toApiError(value: unknown): ApiError {
  if (isApiError(value)) return value;
  return new ApiError(
    ERROR_CODES.INTERNAL,
    0,
    value instanceof Error ? value.message : 'Unexpected client error',
  );
}
