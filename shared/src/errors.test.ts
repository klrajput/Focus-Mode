// shared/src/errors.test.ts — locks the REQUIREMENTS §8 error vocabulary and its HTTP mapping.
// A silently added/renamed code would break the dashboard code→message map and the contract doc,
// so the exact list and statuses are asserted here.

import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  ERROR_CODE_VALUES,
  ERROR_HTTP_STATUS,
  errorCodeSchema,
  httpStatusForErrorCode,
  isErrorCode,
} from './errors.js';

/** REQUIREMENTS §8, in the documented order. */
const DOCUMENTED_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INVALID_PAIRING_CODE',
  'PAIRING_EXPIRED',
  'PROTECTED_ENTRY',
  'ALREADY_FOCUSING',
  'NO_DEVICE_CONNECTED',
  'ACCOUNT_DISABLED',
  'INTERNAL',
];

const ALLOWED_HTTP_STATUSES = [400, 401, 403, 404, 409, 410, 429, 500];

describe('ERROR_CODES', () => {
  it('contains exactly the 13 codes from REQUIREMENTS §8, in order', () => {
    expect(ERROR_CODE_VALUES).toHaveLength(13);
    expect([...ERROR_CODE_VALUES]).toEqual(DOCUMENTED_CODES);
    expect(Object.keys(ERROR_CODES)).toEqual(DOCUMENTED_CODES);
  });

  it('maps every code to itself so string comparisons stay safe', () => {
    for (const [key, value] of Object.entries(ERROR_CODES)) {
      expect(value).toBe(key);
    }
  });
});

describe('ERROR_HTTP_STATUS', () => {
  it('covers every code exactly once', () => {
    expect(Object.keys(ERROR_HTTP_STATUS).sort()).toEqual([...ERROR_CODE_VALUES].sort());
  });

  it('uses only documented HTTP statuses (NFR-009)', () => {
    for (const status of Object.values(ERROR_HTTP_STATUS)) {
      expect(ALLOWED_HTTP_STATUSES).toContain(status);
    }
  });

  it('maps the important codes correctly', () => {
    expect(ERROR_HTTP_STATUS.VALIDATION_ERROR).toBe(400);
    expect(ERROR_HTTP_STATUS.UNAUTHENTICATED).toBe(401);
    expect(ERROR_HTTP_STATUS.FORBIDDEN).toBe(403);
    expect(ERROR_HTTP_STATUS.NOT_FOUND).toBe(404);
    expect(ERROR_HTTP_STATUS.CONFLICT).toBe(409);
    expect(ERROR_HTTP_STATUS.RATE_LIMITED).toBe(429);
    expect(ERROR_HTTP_STATUS.INVALID_PAIRING_CODE).toBe(400);
    expect(ERROR_HTTP_STATUS.PAIRING_EXPIRED).toBe(410);
    expect(ERROR_HTTP_STATUS.PROTECTED_ENTRY).toBe(400);
    expect(ERROR_HTTP_STATUS.ALREADY_FOCUSING).toBe(409);
    expect(ERROR_HTTP_STATUS.NO_DEVICE_CONNECTED).toBe(409);
    expect(ERROR_HTTP_STATUS.ACCOUNT_DISABLED).toBe(403);
    expect(ERROR_HTTP_STATUS.INTERNAL).toBe(500);
  });

  it('is frozen so runtime code cannot rewrite the contract', () => {
    expect(Object.isFrozen(ERROR_HTTP_STATUS)).toBe(true);
  });

  it('exposes httpStatusForErrorCode for every code', () => {
    for (const code of ERROR_CODE_VALUES) {
      expect(httpStatusForErrorCode(code)).toBe(ERROR_HTTP_STATUS[code]);
    }
  });
});

describe('errorCodeSchema / isErrorCode', () => {
  it('accepts every documented code', () => {
    for (const code of DOCUMENTED_CODES) {
      expect(errorCodeSchema.safeParse(code).success).toBe(true);
      expect(isErrorCode(code)).toBe(true);
    }
  });

  it('rejects unknown, wrong-case and non-string values', () => {
    for (const value of [
      'validation_error',
      'UNKNOWN',
      '',
      null,
      undefined,
      400,
      {},
      'INTERNAL ',
    ]) {
      expect(errorCodeSchema.safeParse(value).success).toBe(false);
      expect(isErrorCode(value)).toBe(false);
    }
  });
});
