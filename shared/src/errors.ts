// shared/src/errors.ts — the stable error-code vocabulary (REQUIREMENTS §8) and HTTP mapping.
// Every API error and every local-channel rejection uses these codes, so the dashboard maps
// code → message once (UX_SPEC §6) and tests can assert exact codes. Pure zod — no Express import;
// the server wraps these in its own AppError, the Focus Agent reuses them verbatim.

import { z } from 'zod';

/** UPPER_SNAKE constants so code never compares raw strings. */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_PAIRING_CODE: 'INVALID_PAIRING_CODE',
  PAIRING_EXPIRED: 'PAIRING_EXPIRED',
  PROTECTED_ENTRY: 'PROTECTED_ENTRY',
  ALREADY_FOCUSING: 'ALREADY_FOCUSING',
  NO_DEVICE_CONNECTED: 'NO_DEVICE_CONNECTED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Runtime list of every code, in REQUIREMENTS §8 order (the zod enum is the validator). */
export const ERROR_CODE_VALUES = Object.values(ERROR_CODES) as [ErrorCode, ...ErrorCode[]];

export const errorCodeSchema = z.enum(ERROR_CODE_VALUES);

/**
 * HTTP status per code (NFR-002 / NFR-009).
 * - 410 for PAIRING_EXPIRED: the code existed and is permanently gone (FR-026).
 * - 409 for NO_DEVICE_CONNECTED / ALREADY_FOCUSING: the request conflicts with current state.
 */
export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = Object.freeze({
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INVALID_PAIRING_CODE: 400,
  PAIRING_EXPIRED: 410,
  PROTECTED_ENTRY: 400,
  ALREADY_FOCUSING: 409,
  NO_DEVICE_CONNECTED: 409,
  ACCOUNT_DISABLED: 403,
  INTERNAL: 500,
});

export function httpStatusForErrorCode(code: ErrorCode): number {
  return ERROR_HTTP_STATUS[code];
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return errorCodeSchema.safeParse(value).success;
}
