// server/src/middlewares/not-found.ts — turns any unmatched route into the frozen 404 envelope
// (T-010). Why: without it Express 5 would send an HTML 404, breaking the NFR-002 contract that
// every response is `{success:false,error:{code,message}}`.
// Invariants: mounted after all routes and before the error handler; message never reveals routes.

import type { RequestHandler } from 'express';
import { ERROR_CODES } from '@focus-mode/shared';
import { AppError } from '../utils/AppError.js';

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError(ERROR_CODES.NOT_FOUND, 'Route not found.'));
};
