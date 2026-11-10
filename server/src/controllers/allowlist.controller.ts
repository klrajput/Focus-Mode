// server/src/controllers/allowlist.controller.ts — allow-list handlers (T-061, contract §3.1 #15–#16).
// Why: the dashboard reads the locked protected set + editable user apps, PUTs the user apps only,
// and may apply an admin preset. Protected-set enforcement (INV-3) and version bumping live in
// allowlist.service; handlers just select the authenticated user and shape the envelope.
// Invariants: no request can alter `protectedApps`; the response is always the full allow-list
// (`{protectedApps,userApps,version}`) so the client can replace its cache in one step.

import type { RequestHandler } from 'express';
import { ERROR_CODES, type AllowlistPutInput, type ApiSuccess } from '@focus-mode/shared';
import { getAuthenticatedUser } from '../middlewares/auth.js';
import { getValidatedQuery } from '../middlewares/validate.js';
import {
  applyPresetToAllowlist,
  getAllowlist,
  updateAllowlist,
  type PresetApplyMode,
  type PublicAllowlist,
} from '../services/allowlist.service.js';
import { AppError } from '../utils/AppError.js';

type RouteParams = Record<string, string>;

/** GET /api/v1/allowlist — 200 allow-list (lazily created with the canonical protected set). */
export const get: RequestHandler<RouteParams, ApiSuccess<PublicAllowlist>> = async (req, res) => {
  const user = getAuthenticatedUser(req);
  const data = await getAllowlist(user.id);
  res.status(200).json({ success: true, data });
};

/** PUT /api/v1/allowlist — 200 allow-list; 400 PROTECTED_ENTRY on any protected change. */
export const put: RequestHandler<
  RouteParams,
  ApiSuccess<PublicAllowlist>,
  AllowlistPutInput
> = async (req, res) => {
  const user = getAuthenticatedUser(req);
  const data = await updateAllowlist(user.id, req.body);
  res.status(200).json({ success: true, data });
};

/** Query contract for preset application (`?mode=merge|replace`, merge is the default). */
export interface PresetApplyQuery {
  mode: PresetApplyMode;
}

/** POST /api/v1/allowlist/preset/:id — 200 allow-list after merging/replacing preset apps. */
export const applyPreset: RequestHandler<RouteParams, ApiSuccess<PublicAllowlist>> = async (
  req,
  res,
) => {
  const user = getAuthenticatedUser(req);
  const presetId = req.params.id;
  if (presetId === undefined) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Preset not found.');
  }
  const { mode } = getValidatedQuery<PresetApplyQuery>(res);
  const data = await applyPresetToAllowlist(user.id, presetId, mode);
  res.status(200).json({ success: true, data });
};
