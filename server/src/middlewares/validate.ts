// server/src/middlewares/validate.ts — validates a request body with a FROZEN shared zod schema
// (T-014, NFR-001). Why: client forms and API handlers import the same schema from
// `@focus-mode/shared`, so validation rules cannot drift; a failure becomes 400 VALIDATION_ERROR
// with `details[] = [{path,message}]` (the exact envelope shape in INTEGRATION_CONTRACTS §1.4).
// Invariants: unknown fields are rejected by the strict shared schemas (SEC-9); the parsed value is
// written back to `req.body`, so controllers work on trimmed/lower-cased data and never re-parse;
// Express 5 makes `req.query` read-only, so query validation stores its result on `res.locals`.

import type { RequestHandler, Response } from 'express';
import { type z, ZodError } from 'zod';
import { ERROR_CODES, type ValidationIssue } from '@focus-mode/shared';
import { AppError } from '../utils/AppError.js';

const VALIDATION_MESSAGE = 'Request validation failed';

/**
 * Flatten a ZodError into the frozen `ValidationIssue[]` shape (dotted paths).
 * Strict objects report unknown fields as a single `unrecognized_keys` issue with an empty path, so
 * each key is expanded into its own detail (`{path:"role"}`) — that is what inline form errors and
 * `details[]` consumers expect (NFR-001, contract §1.4).
 */
export function toValidationDetails(error: ZodError): ValidationIssue[] {
  return error.issues.flatMap((issue): ValidationIssue[] => {
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        path: key,
        message: `Unknown field "${key}" is not allowed`,
      }));
    }
    return [{ path: issue.path.map((part) => String(part)).join('.'), message: issue.message }];
  });
}

/** Validate `req.body` against a shared schema and replace it with the parsed output. */
export function validate(schema: z.ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(
        new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          VALIDATION_MESSAGE,
          toValidationDetails(result.error),
        ),
      );
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Validate the query string and store the parsed result in `res.locals.validatedQuery`.
 * Express 5 exposes `req.query` as a getter, so it cannot be replaced in place.
 */
export function validateQuery(schema: z.ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(
        new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          VALIDATION_MESSAGE,
          toValidationDetails(result.error),
        ),
      );
      return;
    }
    res.locals.validatedQuery = result.data;
    next();
  };
}

/** Read the parsed query written by `validateQuery` (typed at the call site). */
export function getValidatedQuery<T>(res: Response): T {
  return res.locals.validatedQuery as T;
}
