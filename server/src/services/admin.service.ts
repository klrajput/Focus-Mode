// server/src/services/admin.service.ts — admin user management, preset/agent-link publishing and
// aggregate-only platform stats (T-073, FR-019; INTEGRATION_CONTRACTS §3.1 #26–#36).
// Why: FR-019 is the only place an ADMIN can change another account's `role`/`isActive`, publish
// allow-list presets or agent installer links, and read platform-wide numbers. PDF §6 makes the
// stats endpoint deliberately non-invasive: counts and focus minutes only, never a per-user row.
// Invariants:
//   • `passwordHash` can never leak — every user response goes through `toSafeUser` (select:false).
//   • An admin cannot lock themselves out: self-deactivation and self-demotion answer 409 CONFLICT
//     (documented W5 decision, see DECISIONS W5 note) instead of silently removing admin access.
//   • Presets may never carry a protected app (INV-3), by key or per-OS identifier → PROTECTED_ENTRY.
//   • Agent installer links are https-only on the GitHub hosts that serve release artifacts;
//     `javascript:`/`data:`/http/foreign hosts → 400 VALIDATION_ERROR (model would accept http).
//   • Unknown/invalid ids behave exactly like missing ones (404 NOT_FOUND, NFR-003) — never a cast 500.

import { Types, type QueryFilter } from 'mongoose';
import {
  ERROR_CODES,
  OBJECT_ID_PATTERN,
  isProtectedEntry,
  isProtectedKey,
  type AdminUserPatchInput,
  type AdminUserListQuery,
  type AgentLinkCreateInput,
  type AgentLinkUpdateInput,
  type AppEntry,
  type Paginated,
  type PresetCreateInput,
  type PresetUpdateInput,
  type Role,
} from '@focus-mode/shared';
import { AgentLink } from '../models/AgentLink.js';
import { revokeAllDevicesForUser } from './device-revocation.service.js';
import { Device } from '../models/Device.js';
import { OS_NAMES } from '../models/enums.js';
import { Preset } from '../models/Preset.js';
import { Session } from '../models/Session.js';
import { User, type IUser } from '../models/User.js';
import { cloneAppEntry } from '../models/app-entry.js';
import { AppError } from '../utils/AppError.js';
import { isDuplicateKeyError } from '../utils/mongo-errors.js';
import { buildPaginated, pageSkip, type PageLimitQuery } from '../utils/pagination.js';
import { escapeRegex } from '../utils/search.js';
import { toIsoString } from '../utils/serialize.js';
import { listPresets, toPublicPreset, type PublicPreset } from './preset.service.js';
import { toSafeUser, type PublicUser } from './user.service.js';

const USER_NOT_FOUND_MESSAGE = 'User not found.';
const PRESET_NOT_FOUND_MESSAGE = 'Preset not found.';
const AGENT_LINK_NOT_FOUND_MESSAGE = 'Agent link not found.';
const DUPLICATE_PRESET_MESSAGE = 'A preset with this name already exists.';
const SELF_DEACTIVATION_MESSAGE = 'You cannot deactivate your own admin account.';
const SELF_DEMOTION_MESSAGE = 'You cannot remove your own admin role.';
const PROTECTED_PRESET_APP_MESSAGE = 'is a protected app and cannot be part of a preset.';
const AGENT_LINK_URL_MESSAGE =
  'Download URL must be an absolute https URL on github.com or objects.githubusercontent.com.';

/** Hosts allowed to serve Focus Agent installers (GitHub releases + its asset CDN). */
const ALLOWED_AGENT_LINK_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'objects.githubusercontent.com',
]);

/** Optional filters added by W5 on top of the frozen `adminUserListQuerySchema` (#26). */
export interface AdminUsersQuery extends AdminUserListQuery {
  role?: Role;
  isActive?: boolean;
}

/** `agent link` wire shape (INTEGRATION_CONTRACTS §3.3) — `publishedBy` stays internal. */
export interface PublicAgentLink {
  id: string;
  os: AgentLinkCreateInput['os'];
  arch: AgentLinkCreateInput['arch'];
  label: string;
  url: string;
  version: string;
  publishedAt: string | null;
}

/**
 * `admin stats` wire shape. The seven canonical fields are §3.3/§4 (`AdminStats` in the dashboard
 * API types); the four `total*`/`devicesConnected` keys are the additive aliases requested by the
 * W5 admin brief — same aggregates, no per-user data whatsoever (PDF §6).
 */
export interface AdminStats {
  users: number;
  activeUsers: number;
  devices: number;
  connectedDevices: number;
  sessions: number;
  activeSessions: number;
  focusMinutes: number;
  totalUsers: number;
  totalSessions: number;
  totalFocusMinutes: number;
  devicesConnected: number;
}

interface AgentLinkLike {
  _id: unknown;
  os: AgentLinkCreateInput['os'];
  arch: AgentLinkCreateInput['arch'];
  label: string;
  url: string;
  version: string;
  publishedAt?: unknown;
}

/** Guard every id from a path param: a non-ObjectId is a missing resource, never a cast error. */
function toObjectIdOrNotFound(id: string, message: string): Types.ObjectId {
  if (!OBJECT_ID_PATTERN.test(id)) {
    throw new AppError(ERROR_CODES.NOT_FOUND, message);
  }
  return new Types.ObjectId(id);
}

/** Mongo sort spec for the whitelisted admin-user sort (`field` or `-field`, id tiebreaker). */
function adminUserSort(sort: AdminUserListQuery['sort']): Record<string, 1 | -1> {
  const descending = sort.startsWith('-');
  const field = descending ? sort.slice(1) : sort;
  const direction: 1 | -1 = descending ? -1 : 1;
  return { [field]: direction, _id: direction };
}

// ---------------------------------------------------------------------------
// Users (#26–#27)
// ---------------------------------------------------------------------------

/**
 * GET /admin/users — paginated public users with literal (regex-escaped) name/email search.
 * Sorting is restricted to the frozen `adminUsersSortSchema` whitelist; `role`/`isActive` are
 * optional additive filters (strict schema still rejects anything else).
 */
export async function listAdminUsers(query: AdminUsersQuery): Promise<Paginated<PublicUser>> {
  const filter: QueryFilter<IUser> = {};
  if (query.role !== undefined) filter.role = query.role;
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.search !== undefined) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ name: pattern }, { email: pattern }];
  }

  const [total, users] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter)
      .sort(adminUserSort(query.sort))
      .skip(pageSkip(query.page, query.limit))
      .limit(query.limit)
      .lean(),
  ]);

  return buildPaginated(
    users.map((user) => toSafeUser(user)),
    query.page,
    query.limit,
    total,
  );
}

/**
 * PATCH /admin/users/:id — admin-only role/isActive/name update.
 * Self-deactivation and self-demotion are refused with 409 CONFLICT so an admin cannot lock
 * themselves out of the panel by accident (another admin can still deactivate/demote them).
 */
export async function updateAdminUser(
  adminId: string,
  userId: string,
  input: AdminUserPatchInput,
): Promise<PublicUser> {
  const objectId = toObjectIdOrNotFound(userId, USER_NOT_FOUND_MESSAGE);

  if (objectId.equals(adminId)) {
    if (input.isActive === false) {
      throw new AppError(ERROR_CODES.CONFLICT, SELF_DEACTIVATION_MESSAGE);
    }
    if (input.role === 'USER') {
      throw new AppError(ERROR_CODES.CONFLICT, SELF_DEMOTION_MESSAGE);
    }
  }

  const updated = await User.findByIdAndUpdate(
    objectId,
    { $set: input },
    { new: true, runValidators: true },
  ).lean();
  if (updated === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, USER_NOT_FOUND_MESSAGE);
  }

  if (input.isActive === false) {
    // W6 follow-up F-03d (A9): deactivation must invalidate live device credentials immediately
    // (device tokens would otherwise keep working until the agent re-authenticates). The helper
    // is best-effort per device, so one failed hub push cannot fail the admin action.
    await revokeAllDevicesForUser(String(updated._id));
  }

  return toSafeUser(updated);
}

// ---------------------------------------------------------------------------
// Presets (#28–#31)
// ---------------------------------------------------------------------------

/** INV-3: a preset may not grant (or impersonate by identifier) a protected app on any OS. */
function assertNoProtectedPresetApps(apps: readonly AppEntry[]): void {
  const protectedApp = apps.find(
    (app) => isProtectedKey(app.key) || OS_NAMES.some((os) => isProtectedEntry(app, os)),
  );
  if (protectedApp !== undefined) {
    throw new AppError(
      ERROR_CODES.PROTECTED_ENTRY,
      `"${protectedApp.key}" ${PROTECTED_PRESET_APP_MESSAGE}`,
    );
  }
}

/** GET /admin/presets — same data/order as the public list (fixed `createdAt desc`). */
export async function listAdminPresets(query: PageLimitQuery): Promise<Paginated<PublicPreset>> {
  return listPresets(query);
}

/** POST /admin/presets — 201; duplicate name → 409 CONFLICT; protected app → 400 PROTECTED_ENTRY. */
export async function createAdminPreset(
  adminId: string,
  input: PresetCreateInput,
): Promise<PublicPreset> {
  assertNoProtectedPresetApps(input.apps);
  if (await Preset.exists({ name: input.name })) {
    throw new AppError(ERROR_CODES.CONFLICT, DUPLICATE_PRESET_MESSAGE);
  }

  try {
    const preset = await Preset.create({
      name: input.name,
      apps: input.apps.map(cloneAppEntry),
      createdBy: new Types.ObjectId(adminId),
    });
    return toPublicPreset(preset);
  } catch (error) {
    // Two concurrent creates can both pass the exists() check; the unique index decides.
    if (isDuplicateKeyError(error)) {
      throw new AppError(ERROR_CODES.CONFLICT, DUPLICATE_PRESET_MESSAGE);
    }
    throw error;
  }
}

/** PATCH /admin/presets/:id — partial update; unknown id → 404, duplicate name → 409. */
export async function updateAdminPreset(
  presetId: string,
  input: PresetUpdateInput,
): Promise<PublicPreset> {
  const objectId = toObjectIdOrNotFound(presetId, PRESET_NOT_FOUND_MESSAGE);
  if (input.apps !== undefined) {
    assertNoProtectedPresetApps(input.apps);
  }

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.apps !== undefined) update.apps = input.apps.map(cloneAppEntry);

  try {
    const updated = await Preset.findByIdAndUpdate(
      objectId,
      { $set: update },
      { new: true, runValidators: true },
    );
    if (updated === null) {
      throw new AppError(ERROR_CODES.NOT_FOUND, PRESET_NOT_FOUND_MESSAGE);
    }
    return toPublicPreset(updated);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError(ERROR_CODES.CONFLICT, DUPLICATE_PRESET_MESSAGE);
    }
    throw error;
  }
}

/** DELETE /admin/presets/:id — returns the frozen `{id}` payload; unknown id → 404. */
export async function deleteAdminPreset(presetId: string): Promise<{ id: string }> {
  const objectId = toObjectIdOrNotFound(presetId, PRESET_NOT_FOUND_MESSAGE);
  const deleted = await Preset.findByIdAndDelete(objectId);
  if (deleted === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, PRESET_NOT_FOUND_MESSAGE);
  }
  return { id: String(deleted._id) };
}

// ---------------------------------------------------------------------------
// Agent download links (#32–#35)
// ---------------------------------------------------------------------------

/** Whitelist serialisation: `publishedBy` (admin identity, audit-only) is never exposed. */
export function toPublicAgentLink(link: AgentLinkLike): PublicAgentLink {
  return {
    id: String(link._id),
    os: link.os,
    arch: link.arch,
    label: link.label,
    url: link.url,
    version: link.version,
    publishedAt: toIsoString(link.publishedAt),
  };
}

/**
 * Only https installer URLs on GitHub are publishable. `z.url()` accepts `javascript:`/`data:`
 * and the model validator accepts http, so this check is the security boundary (FR-019/SEC).
 */
function assertAgentLinkUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalidAgentLinkUrl();
  }
  const host = parsed.hostname.toLowerCase();
  const hasCredentials = parsed.username.length > 0 || parsed.password.length > 0;
  if (parsed.protocol !== 'https:' || hasCredentials || !ALLOWED_AGENT_LINK_HOSTS.has(host)) {
    throw invalidAgentLinkUrl();
  }
}

function invalidAgentLinkUrl(): AppError {
  return new AppError(ERROR_CODES.VALIDATION_ERROR, AGENT_LINK_URL_MESSAGE, [
    { path: 'url', message: AGENT_LINK_URL_MESSAGE },
  ]);
}

/** GET /admin/agent-links — fixed `publishedAt desc` order (no shared sort schema). */
export async function listAdminAgentLinks(
  query: PageLimitQuery,
): Promise<Paginated<PublicAgentLink>> {
  const [total, links] = await Promise.all([
    AgentLink.countDocuments(),
    AgentLink.find()
      .sort({ publishedAt: -1, _id: -1 })
      .skip(pageSkip(query.page, query.limit))
      .limit(query.limit)
      .lean(),
  ]);

  return buildPaginated(
    links.map((link) => toPublicAgentLink(link)),
    query.page,
    query.limit,
    total,
  );
}

/** POST /admin/agent-links — 201; `publishedBy` is the calling admin (never client-supplied). */
export async function createAdminAgentLink(
  adminId: string,
  input: AgentLinkCreateInput,
): Promise<PublicAgentLink> {
  assertAgentLinkUrl(input.url);
  const link = await AgentLink.create({
    os: input.os,
    arch: input.arch,
    label: input.label,
    url: input.url,
    version: input.version,
    publishedBy: new Types.ObjectId(adminId),
    publishedAt: new Date(),
  });
  return toPublicAgentLink(link);
}

/** PATCH /admin/agent-links/:id — partial update; a new `url` must pass the same guard. */
export async function updateAdminAgentLink(
  linkId: string,
  input: AgentLinkUpdateInput,
): Promise<PublicAgentLink> {
  const objectId = toObjectIdOrNotFound(linkId, AGENT_LINK_NOT_FOUND_MESSAGE);
  if (input.url !== undefined) {
    assertAgentLinkUrl(input.url);
  }

  const update: Record<string, unknown> = {};
  if (input.os !== undefined) update.os = input.os;
  if (input.arch !== undefined) update.arch = input.arch;
  if (input.label !== undefined) update.label = input.label;
  if (input.url !== undefined) update.url = input.url;
  if (input.version !== undefined) update.version = input.version;

  const updated = await AgentLink.findByIdAndUpdate(
    objectId,
    { $set: update },
    { new: true, runValidators: true },
  ).lean();
  if (updated === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, AGENT_LINK_NOT_FOUND_MESSAGE);
  }
  return toPublicAgentLink(updated);
}

/** DELETE /admin/agent-links/:id — returns the frozen `{id}` payload; unknown id → 404. */
export async function deleteAdminAgentLink(linkId: string): Promise<{ id: string }> {
  const objectId = toObjectIdOrNotFound(linkId, AGENT_LINK_NOT_FOUND_MESSAGE);
  const deleted = await AgentLink.findByIdAndDelete(objectId);
  if (deleted === null) {
    throw new AppError(ERROR_CODES.NOT_FOUND, AGENT_LINK_NOT_FOUND_MESSAGE);
  }
  return { id: String(deleted._id) };
}

// ---------------------------------------------------------------------------
// Aggregate stats (#36, PDF §6)
// ---------------------------------------------------------------------------

/** 0.1-minute precision, matching the session `actualMinutes` wire rule (§1.3). */
function roundFocusMinutes(value: number): number {
  return Math.round(value * 10) / 10;
}

async function totalFocusMinutes(): Promise<number> {
  const [row] = await Session.aggregate<{ total: number }>([
    { $group: { _id: null, total: { $sum: '$actualMinutes' } } },
  ]);
  return row?.total ?? 0;
}

/**
 * GET /admin/stats — platform aggregates only (PDF §6): no user id, name, email or session row.
 * `connectedDevices` counts an online agent, i.e. `CONNECTED` **or** `FOCUSING` (a focusing device
 * is by definition connected); `focusMinutes` sums `actualMinutes` rounded to 0.1.
 */
export async function getAdminStats(): Promise<AdminStats> {
  const [users, activeUsers, devices, connectedDevices, sessions, activeSessions, focus] =
    await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isActive: true }),
      Device.countDocuments({}),
      Device.countDocuments({ status: { $in: ['CONNECTED', 'FOCUSING'] } }),
      Session.countDocuments({}),
      Session.countDocuments({ status: 'ACTIVE' }),
      totalFocusMinutes(),
    ]);

  const focusMinutes = roundFocusMinutes(focus);
  return {
    users,
    activeUsers,
    devices,
    connectedDevices,
    sessions,
    activeSessions,
    focusMinutes,
    // Additive W5 aliases (see the AdminStats doc comment) — same aggregates, no new data.
    totalUsers: users,
    totalSessions: sessions,
    totalFocusMinutes: focusMinutes,
    devicesConnected: connectedDevices,
  };
}
