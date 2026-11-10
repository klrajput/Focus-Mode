// server/src/controllers/presets.controller.ts — shared preset listing (T-061, contract §3.1 #24).
// Why: any authenticated user may read the allow-list templates admins publish (CRUD is T-073);
// the list is paginated with the NFR-009 shape and the fixed `createdAt desc` order.
// Invariants: read-only; never exposes the publishing admin (`createdBy`), see preset.service.

import type { RequestHandler } from 'express';
import type { ApiSuccess, Paginated } from '@focus-mode/shared';
import { getValidatedQuery } from '../middlewares/validate.js';
import { listPresets, type PublicPreset } from '../services/preset.service.js';
import type { PageLimitQuery } from '../utils/pagination.js';

type RouteParams = Record<string, string>;

/** GET /api/v1/presets — 200 paginated presets (page/limit only). */
export const list: RequestHandler<RouteParams, ApiSuccess<Paginated<PublicPreset>>> = async (
  _req,
  res,
) => {
  const query = getValidatedQuery<PageLimitQuery>(res);
  const data = await listPresets(query);
  res.status(200).json({ success: true, data });
};
