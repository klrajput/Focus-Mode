// server/src/controllers/sessions.controller.ts — session handlers (T-060, contract §3.1 #12–#14).
// Why: thin HTTP layer over session.service; validation already happened in middleware, ownership
// and idempotency rules live in the service. The create handler distinguishes a real creation (201)
// from an idempotent REC-006 replay (200) without changing the body shape the client consumed.
// Invariants: responses are the frozen `{success,data}` envelope; `clientSessionId` is never used as
// the resource id (the Mongo `_id` is); only the authenticated owner's sessions are reachable.

import type { RequestHandler } from 'express';
import {
  ERROR_CODES,
  type ApiSuccess,
  type Paginated,
  type SessionCreateInput,
  type SessionListQuery,
  type SessionPatchInput,
} from '@focus-mode/shared';
import { getAuthenticatedUser } from '../middlewares/auth.js';
import { getValidatedQuery } from '../middlewares/validate.js';
import {
  createSession,
  finaliseSession,
  getActiveSession,
  listSessions,
  type PublicSession,
} from '../services/session.service.js';
import { AppError } from '../utils/AppError.js';

type RouteParams = Record<string, string>;

/** POST /api/v1/sessions — 201 on create, 200 on an identical REC-006 replay. */
export const create: RequestHandler<
  RouteParams,
  ApiSuccess<PublicSession>,
  SessionCreateInput
> = async (req, res) => {
  const user = getAuthenticatedUser(req);
  const result = await createSession(user.id, req.body);
  res.status(result.created ? 201 : 200).json({ success: true, data: result.session });
};

/** PATCH /api/v1/sessions/:id — finalise once; identical repeats stay 200 (idempotent). */
export const finalise: RequestHandler<
  RouteParams,
  ApiSuccess<PublicSession>,
  SessionPatchInput
> = async (req, res) => {
  const user = getAuthenticatedUser(req);
  const sessionId = req.params.id;
  if (sessionId === undefined) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Session not found.');
  }
  const session = await finaliseSession(user.id, sessionId, req.body);
  res.status(200).json({ success: true, data: session });
};

/** GET /api/v1/sessions — owner-scoped paginated list with filters (§3.1 #14). */
export const list: RequestHandler<RouteParams, ApiSuccess<Paginated<PublicSession>>> = async (
  req,
  res,
) => {
  const user = getAuthenticatedUser(req);
  const query = getValidatedQuery<SessionListQuery>(res);
  const data = await listSessions(user.id, query);
  res.status(200).json({ success: true, data });
};

/** GET /api/v1/sessions/active — current ACTIVE session for dashboard refresh, or null. */
export const active: RequestHandler<
  RouteParams,
  ApiSuccess<{ session: PublicSession | null }>
> = async (req, res) => {
  const user = getAuthenticatedUser(req);
  const session = await getActiveSession(user.id);
  res.status(200).json({ success: true, data: { session } });
};
