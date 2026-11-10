// server/src/controllers/agent-links.controller.ts — public installer links (T-072, FR-019/FR-029).
// Why: the landing page and `/settings` show download links for the Focus Agent; anonymous visitors
// must be able to read them, so this handler is mounted without auth (contract §3.1 #25).
// Invariants: public data only (never `publishedBy`); paginated NFR-009 envelope.

import type { RequestHandler } from 'express';
import type { ApiSuccess, Paginated } from '@focus-mode/shared';
import { getValidatedQuery } from '../middlewares/validate.js';
import { listAgentLinks, type PublicAgentLink } from '../services/agent-link.service.js';
import type { PageLimitQuery } from '../utils/pagination.js';

type RouteParams = Record<string, string>;

/** GET /api/v1/agent-links — 200 paginated public installer links (#25). */
export const list: RequestHandler<RouteParams, ApiSuccess<Paginated<PublicAgentLink>>> = async (
  _req,
  res,
) => {
  const query = getValidatedQuery<PageLimitQuery>(res);
  const data = await listAgentLinks(query);
  res.status(200).json({ success: true, data });
};
