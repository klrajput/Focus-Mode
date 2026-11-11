// server/src/utils/mongo-errors.test.ts — W7 (task-46) unit coverage for the driver-error type
// guards. Why: `utils/mongo-errors.ts` was the second-weakest server file (62.5 % lines) because
// only the happy duplicate-key shape was reached through the API: the `unknown`-safety branches
// (null/primitive inputs, a 11000 error without `keyValue`, a ValidationError whose entries are not
// objects) never ran. Those branches are the reason the guards are written over `unknown` instead of
// duck-typed driver classes — a wrong classification turns a 409 into a 500.
// Invariants asserted: every guard is total (never throws for any JSON-ish value), E11000 is matched
// by the numeric driver code only, missing/odd `keyValue` yields no field names, and
// `mongooseValidationDetails` always returns the frozen `{path, message}` shape with a readable
// fallback message so the NFR-002 envelope can never contain `undefined`.

import { describe, expect, it } from 'vitest';
import mongoose, { Types } from 'mongoose';
import {
  duplicateKeyFields,
  isDuplicateKeyError,
  isInvalidObjectIdError,
  isMongooseValidationError,
  mongooseValidationDetails,
} from './mongo-errors.js';

/** Values a `catch (error: unknown)` can realistically hand to the guards. */
const NON_ERROR_VALUES: readonly unknown[] = [
  undefined,
  null,
  'E11000 duplicate key',
  11000,
  true,
  [],
  Object.create(null),
];

/** A driver-shaped E11000 error (what `save()`/`create()` rejects with). */
function duplicateKeyError(keyValue?: unknown): Error {
  const error = Object.assign(new Error('E11000 duplicate key error collection: test.users'), {
    code: 11000,
  });
  if (keyValue !== undefined) Object.assign(error, { keyValue });
  return error;
}

/** A Mongoose ValidationError-shaped value (the real class is only produced with a document). */
function validationError(errors: unknown): Error {
  return Object.assign(new Error('User validation failed'), { name: 'ValidationError', errors });
}

describe('isDuplicateKeyError / duplicateKeyFields', () => {
  it('recognises the numeric E11000 driver code and lists the conflicting fields', () => {
    const error = duplicateKeyError({ email: 'kabir@demo.com' });

    expect(isDuplicateKeyError(error)).toBe(true);
    expect(duplicateKeyFields(error)).toEqual(['email']);
  });

  it('reports several key fields in driver order (compound unique indexes)', () => {
    const error = duplicateKeyError({ userId: 'u1', clientSessionId: 'c1' });
    expect(duplicateKeyFields(error)).toEqual(['userId', 'clientSessionId']);
  });

  it('returns no field names when the driver omitted keyValue', () => {
    const error = duplicateKeyError();

    expect(isDuplicateKeyError(error)).toBe(true);
    // The central handler then falls back to its generic CONFLICT message.
    expect(duplicateKeyFields(error)).toEqual([]);
  });

  it('returns no field names for a non-object keyValue', () => {
    expect(duplicateKeyFields(duplicateKeyError('email'))).toEqual([]);
    expect(duplicateKeyFields(duplicateKeyError(null))).toEqual([]);
  });

  it('does not treat a string "11000" as the driver code', () => {
    // A string code is not what the driver emits; accepting it would let a hand-built error
    // masquerade as a unique violation (and turn a 500 bug report into a 409).
    expect(isDuplicateKeyError(Object.assign(new Error('x'), { code: '11000' }))).toBe(false);
    expect(
      duplicateKeyFields(Object.assign(new Error('x'), { code: '11000', keyValue: {} })),
    ).toEqual([]);
  });

  it('ignores other driver codes (e.g. 121 document validation)', () => {
    expect(isDuplicateKeyError(Object.assign(new Error('x'), { code: 121 }))).toBe(false);
  });

  it('is total for non-error values', () => {
    for (const value of NON_ERROR_VALUES) {
      expect(isDuplicateKeyError(value)).toBe(false);
      expect(duplicateKeyFields(value)).toEqual([]);
    }
  });
});

describe('isMongooseValidationError / mongooseValidationDetails', () => {
  it('recognises a ValidationError and flattens it to {path, message} details', () => {
    const error = validationError({
      email: { message: 'Email is invalid' },
      plannedMinutes: { message: 'plannedMinutes must be >= 1' },
    });

    expect(isMongooseValidationError(error)).toBe(true);
    expect(mongooseValidationDetails(error)).toEqual([
      { path: 'email', message: 'Email is invalid' },
      { path: 'plannedMinutes', message: 'plannedMinutes must be >= 1' },
    ]);
  });

  it('falls back to a readable message when a validation entry carries none', () => {
    expect(mongooseValidationDetails(validationError({ email: {} }))).toEqual([
      { path: 'email', message: 'Invalid value' },
    ]);
    expect(mongooseValidationDetails(validationError({ email: 'boom' }))).toEqual([
      { path: 'email', message: 'Invalid value' },
    ]);
  });

  it('requires both the name and an errors container', () => {
    expect(
      isMongooseValidationError(Object.assign(new Error('x'), { name: 'ValidationError' })),
    ).toBe(false);
    // `typeof null === 'object'`, so a null container passes the guard but yields no details: the
    // handler still emits 400 VALIDATION_ERROR, just without a `details[]` array.
    expect(isMongooseValidationError(validationError(null))).toBe(true);
    expect(mongooseValidationDetails(validationError(null))).toEqual([]);
    expect(isMongooseValidationError(validationError('boom'))).toBe(false);
  });

  it('does not confuse a duplicate-key error with a validation error', () => {
    expect(isMongooseValidationError(duplicateKeyError({ email: 'x' }))).toBe(false);
    expect(mongooseValidationDetails(duplicateKeyError({ email: 'x' }))).toEqual([]);
  });

  it('is total for non-error values', () => {
    for (const value of NON_ERROR_VALUES) {
      expect(isMongooseValidationError(value)).toBe(false);
      expect(mongooseValidationDetails(value)).toEqual([]);
    }
  });
});

describe('isInvalidObjectIdError', () => {
  it('classifies a real Mongoose CastError from an unparseable id', () => {
    // The exact class Mongoose throws when a query filter cannot cast a path id.
    const castError = new mongoose.Error.CastError('ObjectId', 'not-an-object-id', '_id');

    expect(castError.name).toBe('CastError');
    expect(isInvalidObjectIdError(castError)).toBe(true);
  });

  it('classifies a real BSON parse error by name', () => {
    let thrown: unknown;
    try {
      // `new Types.ObjectId(...)` is the public BSON parser; an invalid hex string is rejected.
      const invalid = new Types.ObjectId('not-an-object-id');
      expect(invalid).toBeInstanceOf(Types.ObjectId);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(['BSONError', 'BSONTypeError']).toContain((thrown as Error).name);
    expect(isInvalidObjectIdError(thrown)).toBe(true);
  });

  it('classifies the BSONTypeError spelling for older driver error names', () => {
    // Name-based on purpose: the guard must survive driver version differences (see module comment).
    expect(isInvalidObjectIdError({ name: 'BSONTypeError' })).toBe(true);
    expect(isInvalidObjectIdError({ name: 'BSONError' })).toBe(true);
    expect(isInvalidObjectIdError({ name: 'CastError' })).toBe(true);
  });

  it('does not classify unrelated error names (no accidental 404 for real bugs)', () => {
    for (const name of ['Error', 'ValidationError', 'MongoServerError', 'TypeError', '']) {
      expect(isInvalidObjectIdError({ name })).toBe(false);
    }
  });

  it('is total for non-error values', () => {
    for (const value of NON_ERROR_VALUES) expect(isInvalidObjectIdError(value)).toBe(false);
  });
});
