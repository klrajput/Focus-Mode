// server/src/utils/object-id.ts — safe conversion of a URL/path id into a Mongo ObjectId (W6/SEC-9).
// Why: `new Types.ObjectId(userInput)` throws a CastError for anything that is not 24 hex chars; if
// that happens after auth/authorisation the client would see a 500. A malformed id must behave
// exactly like a missing resource (404 NOT_FOUND, NFR-003) — never reveal parser internals.
// Invariants: the frozen shared `OBJECT_ID_PATTERN` is the single validity rule; the returned value
// is always a real ObjectId, so downstream queries cannot throw.

import { Types } from 'mongoose';
import { ERROR_CODES, OBJECT_ID_PATTERN } from '@focus-mode/shared';
import { AppError } from './AppError.js';

/** True when `value` is a 24-hex ObjectId string (the wire form from INTEGRATION_CONTRACTS §1.3). */
export function isObjectIdString(value: string): boolean {
  return OBJECT_ID_PATTERN.test(value);
}

/** Parse a path id; a malformed value throws `404 NOT_FOUND` with the caller's resource message. */
export function toObjectIdOrNotFound(
  value: string,
  message: string = 'Resource not found.',
): Types.ObjectId {
  if (!isObjectIdString(value)) {
    throw new AppError(ERROR_CODES.NOT_FOUND, message);
  }
  return new Types.ObjectId(value);
}
