// server/src/controllers/insights.controller.ts — GET /api/v1/insights (T-070, FR-013).
// Why: thin HTTP layer over insights.service; the analytics definitions (REQUIREMENTS §6) live in
// the service so they are unit-testable with a pinned clock. The handler only extracts the
// authenticated user and the validated `{range, timezone?}` query.
// Invariants: USER-only (mounted with requireRole('USER')); range is the frozen `7d|30d|90d`; the
// response echoes the timezone actually used so the dashboard can label the chart correctly.

import type { RequestHandler } from 'express';
import { type ApiSuccess, type InsightsQuery } from '@focus-mode/shared';
import { getAuthenticatedUser } from '../middlewares/auth.js';
import { getValidatedQuery } from '../middlewares/validate.js';
import { getInsights, type Insights } from '../services/insights.service.js';

type RouteParams = Record<string, string>;

/** GET /api/v1/insights — 200 insights for the authenticated user's session history (#21). */
export const get: RequestHandler<RouteParams, ApiSuccess<Insights>> = async (req, res) => {
  const user = getAuthenticatedUser(req);
  const query = getValidatedQuery<InsightsQuery>(res);
  const data = await getInsights(user.id, query);
  res.status(200).json({ success: true, data });
};
