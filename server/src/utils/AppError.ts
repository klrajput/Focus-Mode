// server/src/utils/AppError.ts — the one typed error every server module throws (T-010).
// Why: the error codes are frozen in `@focus-mode/shared`, so an error carries a code instead of
// an HTTP status invented ad hoc; the central error middleware turns it into the NFR-002 envelope.
// Invariants: `status` defaults to the frozen `ERROR_HTTP_STATUS[code]` mapping (overridable only
// for endpoints outside the business contract, e.g. readiness probes); `details[]` is only used by
// VALIDATION_ERROR; the message must be safe to show a client (no internals, no stack).

import { httpStatusForErrorCode, type ErrorCode, type ValidationIssue } from '@focus-mode/shared';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: ValidationIssue[];

  constructor(
    code: ErrorCode,
    message: string,
    details?: ValidationIssue[],
    status: number = httpStatusForErrorCode(code),
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Narrow an unknown failure so callers can re-throw operational errors unchanged. */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
