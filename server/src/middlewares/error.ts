// server/src/middlewares/error.ts — the one place that converts any failure into the NFR-002 error
// envelope (T-010). Why: clients switch on `error.code`, so every 4xx/5xx response must carry one of
// the 13 frozen codes (REQUIREMENTS §8) with `{success:false,error:{code,message,details?}}`.
// Invariants: an unexpected error becomes a generic 500 INTERNAL — its message/stack never reach the
// client (NFR-002), only the server log; mongoose duplicate key → 409 CONFLICT; zod → 400
// VALIDATION_ERROR with `details[]`; body-parser failures (malformed JSON, >100 kb) → 400.

import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  ERROR_CODES,
  type ApiErrorBody,
  type ErrorCode,
  type ValidationIssue,
} from '@focus-mode/shared';
import { logger } from '../config/logger.js';
import { AppError } from '../utils/AppError.js';
import {
  duplicateKeyFields,
  isDuplicateKeyError,
  isInvalidObjectIdError,
  isMongooseValidationError,
  mongooseValidationDetails,
} from '../utils/mongo-errors.js';
import { toValidationDetails } from './validate.js';

const INTERNAL_MESSAGE = 'An unexpected error occurred.';

interface NormalizedError {
  code: ErrorCode;
  message: string;
  status: number;
  details?: ValidationIssue[];
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // If the response already started, let Express close the connection instead of corrupting it.
  if (res.headersSent) {
    next(error);
    return;
  }

  const normalized = normalizeError(error);
  const log = req.log ?? logger;
  const context = { err: error, method: req.method, url: req.originalUrl, requestId: req.id };
  if (normalized.status >= 500) {
    log.error(context, 'request failed');
  } else {
    log.warn(context, 'request rejected');
  }

  const body: ApiErrorBody =
    normalized.details !== undefined && normalized.details.length > 0
      ? {
          success: false,
          error: {
            code: normalized.code,
            message: normalized.message,
            details: normalized.details,
          },
        }
      : { success: false, error: { code: normalized.code, message: normalized.message } };

  res.status(normalized.status).json(body);
}

function normalizeError(error: unknown): NormalizedError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.details,
    };
  }
  if (error instanceof ZodError) {
    return {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Request validation failed',
      status: 400,
      details: toValidationDetails(error),
    };
  }
  if (isDuplicateKeyError(error)) {
    const fields = duplicateKeyFields(error);
    return {
      code: ERROR_CODES.CONFLICT,
      message:
        fields.length > 0
          ? `A record with this ${fields.join(', ')} already exists.`
          : 'A record with the same unique value already exists.',
      status: 409,
    };
  }
  if (isMongooseValidationError(error)) {
    return {
      code: ERROR_CODES.VALIDATION_ERROR,
      message: 'Data validation failed',
      status: 400,
      details: mongooseValidationDetails(error),
    };
  }
  // W6/SEC-9: a malformed ObjectId in a URL path is a missing resource, never a cast 500.
  if (isInvalidObjectIdError(error)) {
    return { code: ERROR_CODES.NOT_FOUND, message: 'Resource not found.', status: 404 };
  }
  const bodyError = normalizeBodyParserError(error);
  if (bodyError) return bodyError;
  return { code: ERROR_CODES.INTERNAL, message: INTERNAL_MESSAGE, status: 500 };
}

/** Map `express.json` / body-parser failures onto the frozen envelope (no 413/422 codes exist). */
function normalizeBodyParserError(error: unknown): NormalizedError | null {
  if (typeof error !== 'object' || error === null) return null;
  const type = (error as { type?: unknown }).type;
  if (typeof type !== 'string') return null;
  const messages: Record<string, string> = {
    'entity.parse.failed': 'Malformed JSON body.',
    'entity.too.large': 'Request body is too large (limit 100kb).',
    'encoding.unsupported': 'Unsupported request encoding.',
    'request.aborted': 'Request body was aborted.',
  };
  const message = messages[type];
  if (message === undefined) return null;
  return { code: ERROR_CODES.VALIDATION_ERROR, message, status: 400 };
}
