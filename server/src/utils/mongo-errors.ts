// server/src/utils/mongo-errors.ts — recognise the two MongoDB/Mongoose failures the API maps to
// stable client errors (TECHNICAL_DESIGN §8): duplicate key (11000 → 409 CONFLICT) and schema
// validation (Mongoose ValidationError → 400 VALIDATION_ERROR with details[]).
// Why: the central error handler and the auth service both need this, and neither should depend on
// concrete driver classes (Mongoose wraps MongoDB errors differently across versions).
// Invariants: pure type guards over `unknown` — no `any`, no throwing, safe for any error value.

/** MongoDB's E11000 duplicate-key error code (also used by Mongoose `save()`/`create()`). */
const DUPLICATE_KEY_CODE = 11000;

interface DuplicateKeyErrorLike {
  code: unknown;
  keyValue?: unknown;
}

interface ValidationErrorLike {
  name: unknown;
  errors: unknown;
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as DuplicateKeyErrorLike).code === DUPLICATE_KEY_CODE
  );
}

/** Field names from the duplicate-key error's `keyValue` (e.g. `['email']`); empty when unknown. */
export function duplicateKeyFields(error: unknown): string[] {
  if (!isDuplicateKeyError(error)) return [];
  const keyValue = (error as DuplicateKeyErrorLike).keyValue;
  if (typeof keyValue !== 'object' || keyValue === null) return [];
  return Object.keys(keyValue as Record<string, unknown>);
}

/**
 * Mongoose cast errors (`CastError`) and raw BSON parse errors are caused by an unparseable
 * 24-hex id in a URL path. That is a *missing resource* (404), never an internal 5xx — see the
 * central error handler, which maps these before the generic 500.
 */
export function isInvalidObjectIdError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'CastError' || name === 'BSONError' || name === 'BSONTypeError';
}

export function isMongooseValidationError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as ValidationErrorLike).name === 'ValidationError' &&
    typeof (error as ValidationErrorLike).errors === 'object'
  );
}

/** Flatten a Mongoose ValidationError into `{path, message}` details (NFR-002 shape). */
export function mongooseValidationDetails(error: unknown): { path: string; message: string }[] {
  if (!isMongooseValidationError(error)) return [];
  const errors = (error as ValidationErrorLike).errors;
  if (typeof errors !== 'object' || errors === null) return [];
  return Object.entries(errors as Record<string, unknown>).map(([path, value]) => {
    const message =
      typeof value === 'object' && value !== null && 'message' in value
        ? String((value as { message: unknown }).message)
        : 'Invalid value';
    return { path, message };
  });
}
