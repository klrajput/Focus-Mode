// server/src/controllers/admin.controller.ts — admin HTTP handlers (T-073, contract §3.1 #26–#36).
// Why: the router validates bodies/queries with the frozen shared schemas and the service owns the
// admin rules (self-guards, protected presets, https-only download links, aggregate stats); these
// handlers only select the authenticated admin, forward the parsed input and shape the NFR-002
// success envelope. No handler ever reads a raw request field for authorisation.
// Invariants: 201 for creates, 200 for reads/updates/deletes, `{id}` payload for deletes; `data`
// shapes are §3.3 `public user` / `preset` / `agent link` / `admin stats` (never `passwordHash`).

import type { RequestHandler } from 'express';
import {
  ERROR_CODES,
  type AdminUserPatchInput,
  type AgentLinkCreateInput,
  type AgentLinkUpdateInput,
  type ApiSuccess,
  type Paginated,
  type PresetCreateInput,
  type PresetUpdateInput,
} from '@focus-mode/shared';
import { getAuthenticatedUser } from '../middlewares/auth.js';
import { getValidatedQuery } from '../middlewares/validate.js';
import {
  createAdminAgentLink,
  createAdminPreset,
  deleteAdminAgentLink,
  deleteAdminPreset,
  getAdminStats,
  listAdminAgentLinks,
  listAdminPresets,
  listAdminUsers,
  updateAdminAgentLink,
  updateAdminPreset,
  updateAdminUser,
  type AdminStats,
  type AdminUsersQuery,
  type PublicAgentLink,
} from '../services/admin.service.js';
import type { PublicPreset } from '../services/preset.service.js';
import type { PublicUser } from '../services/user.service.js';
import { AppError } from '../utils/AppError.js';
import type { PageLimitQuery } from '../utils/pagination.js';

type RouteParams = Record<string, string>;

// ---------------------------------------------------------------------------
// Users (#26–#27)
// ---------------------------------------------------------------------------

/** GET /api/v1/admin/users — 200 paginated public users (search + optional role/isActive). */
export const listUsers: RequestHandler<RouteParams, ApiSuccess<Paginated<PublicUser>>> = async (
  _req,
  res,
) => {
  const query = getValidatedQuery<AdminUsersQuery>(res);
  const data = await listAdminUsers(query);
  res.status(200).json({ success: true, data });
};

/** PATCH /api/v1/admin/users/:id — 200 updated public user; self-guard violations → 409. */
export const patchUser: RequestHandler<
  RouteParams,
  ApiSuccess<PublicUser>,
  AdminUserPatchInput
> = async (req, res) => {
  const admin = getAuthenticatedUser(req);
  const userId = req.params.id;
  if (userId === undefined) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'User not found.');
  }
  const data = await updateAdminUser(admin.id, userId, req.body);
  res.status(200).json({ success: true, data });
};

// ---------------------------------------------------------------------------
// Presets (#28–#31)
// ---------------------------------------------------------------------------

/** GET /api/v1/admin/presets — 200 paginated presets (page/limit only). */
export const listPresetsHandler: RequestHandler<
  RouteParams,
  ApiSuccess<Paginated<PublicPreset>>
> = async (_req, res) => {
  const query = getValidatedQuery<PageLimitQuery>(res);
  const data = await listAdminPresets(query);
  res.status(200).json({ success: true, data });
};

/** POST /api/v1/admin/presets — 201 created preset. */
export const createPresetHandler: RequestHandler<
  RouteParams,
  ApiSuccess<PublicPreset>,
  PresetCreateInput
> = async (req, res) => {
  const admin = getAuthenticatedUser(req);
  const data = await createAdminPreset(admin.id, req.body);
  res.status(201).json({ success: true, data });
};

/** PATCH /api/v1/admin/presets/:id — 200 updated preset. */
export const patchPreset: RequestHandler<
  RouteParams,
  ApiSuccess<PublicPreset>,
  PresetUpdateInput
> = async (req, res) => {
  const presetId = req.params.id;
  if (presetId === undefined) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Preset not found.');
  }
  const data = await updateAdminPreset(presetId, req.body);
  res.status(200).json({ success: true, data });
};

/** DELETE /api/v1/admin/presets/:id — 200 `{id}`. */
export const removePreset: RequestHandler<RouteParams, ApiSuccess<{ id: string }>> = async (
  req,
  res,
) => {
  const presetId = req.params.id;
  if (presetId === undefined) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Preset not found.');
  }
  const data = await deleteAdminPreset(presetId);
  res.status(200).json({ success: true, data });
};

// ---------------------------------------------------------------------------
// Agent download links (#32–#35)
// ---------------------------------------------------------------------------

/** GET /api/v1/admin/agent-links — 200 paginated agent links (`publishedAt desc`). */
export const listAgentLinks: RequestHandler<
  RouteParams,
  ApiSuccess<Paginated<PublicAgentLink>>
> = async (_req, res) => {
  const query = getValidatedQuery<PageLimitQuery>(res);
  const data = await listAdminAgentLinks(query);
  res.status(200).json({ success: true, data });
};

/** POST /api/v1/admin/agent-links — 201 published link; `publishedBy` is the caller. */
export const createAgentLink: RequestHandler<
  RouteParams,
  ApiSuccess<PublicAgentLink>,
  AgentLinkCreateInput
> = async (req, res) => {
  const admin = getAuthenticatedUser(req);
  const data = await createAdminAgentLink(admin.id, req.body);
  res.status(201).json({ success: true, data });
};

/** PATCH /api/v1/admin/agent-links/:id — 200 updated link (url re-validated). */
export const patchAgentLink: RequestHandler<
  RouteParams,
  ApiSuccess<PublicAgentLink>,
  AgentLinkUpdateInput
> = async (req, res) => {
  const linkId = req.params.id;
  if (linkId === undefined) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Agent link not found.');
  }
  const data = await updateAdminAgentLink(linkId, req.body);
  res.status(200).json({ success: true, data });
};

/** DELETE /api/v1/admin/agent-links/:id — 200 `{id}`. */
export const removeAgentLink: RequestHandler<RouteParams, ApiSuccess<{ id: string }>> = async (
  req,
  res,
) => {
  const linkId = req.params.id;
  if (linkId === undefined) {
    throw new AppError(ERROR_CODES.NOT_FOUND, 'Agent link not found.');
  }
  const data = await deleteAdminAgentLink(linkId);
  res.status(200).json({ success: true, data });
};

// ---------------------------------------------------------------------------
// Stats (#36)
// ---------------------------------------------------------------------------

/** GET /api/v1/admin/stats — 200 aggregate-only platform stats (never per-user detail). */
export const stats: RequestHandler<RouteParams, ApiSuccess<AdminStats>> = async (_req, res) => {
  const data = await getAdminStats();
  res.status(200).json({ success: true, data });
};
