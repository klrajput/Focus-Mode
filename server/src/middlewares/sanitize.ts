// server/src/middlewares/sanitize.ts — rejects MongoDB operator / prototype-pollution keys in
// request data before validation runs (NFR-003, SEC-9; T-014).
// Why: `{"email":{"$ne":null}}` must not reach a mongoose query. zod strict schemas would usually
// reject it, but this middleware makes the defence explicit and keeps the 400 VALIDATION_ERROR
// `details[]` path exact (`email.$ne`) — see utils/operators.ts for why we reject, not strip.
// Invariants: runs on the raw body/query/params right after `express.json`; never mutates the
// request; a forbidden key short-circuits with the standard error envelope.

import type { RequestHandler } from 'express';
import { ERROR_CODES, type ValidationIssue } from '@focus-mode/shared';
import { AppError } from '../utils/AppError.js';
import { findForbiddenKeys } from '../utils/operators.js';

const FORBIDDEN_KEY_MESSAGE = 'MongoDB operator keys ($, .) and prototype names are not allowed';

/** Collect forbidden keys from every user-controlled request surface. */
export function collectOperatorIssues(req: {
  body: unknown;
  query: unknown;
  params: unknown;
}): ValidationIssue[] {
  return [
    ...findForbiddenKeys(req.body).map((path) => ({ path, message: FORBIDDEN_KEY_MESSAGE })),
    ...findForbiddenKeys(req.query).map((path) => ({
      path: `query.${path}`,
      message: FORBIDDEN_KEY_MESSAGE,
    })),
    ...findForbiddenKeys(req.params).map((path) => ({
      path: `params.${path}`,
      message: FORBIDDEN_KEY_MESSAGE,
    })),
  ];
}

export const sanitizeRequest: RequestHandler = (req, _res, next) => {
  const issues = collectOperatorIssues(req);
  if (issues.length > 0) {
    next(new AppError(ERROR_CODES.VALIDATION_ERROR, 'Request contains forbidden keys', issues));
    return;
  }
  next();
};
