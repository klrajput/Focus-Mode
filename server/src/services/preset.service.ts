// server/src/services/preset.service.ts — read-only preset listing for dashboards (T-061, FR-020).
// Why: admins publish allow-list templates (T-073 owns CRUD) and any authenticated user may read
// them. The frozen contract (§1.6) gives presets no sort/filter query schema, so the list accepts
// `page`/`limit` only and uses the fixed deterministic `createdAt desc` order.
// Invariants: `createdBy` (admin identity, audit-only) is never exposed; apps are cloned so callers
// cannot mutate shared Mongoose values; response shape matches §3.3 `preset`.

import type { AppEntry, Paginated } from '@focus-mode/shared';
import { Preset } from '../models/Preset.js';
import { cloneAppEntry } from '../models/app-entry.js';
import { buildPaginated, pageSkip, type PageLimitQuery } from '../utils/pagination.js';
import { toIsoString } from '../utils/serialize.js';

/** `preset` wire shape (INTEGRATION_CONTRACTS §3.3). */
export interface PublicPreset {
  id: string;
  name: string;
  apps: AppEntry[];
  createdAt: string | null;
}

interface PresetLike {
  _id: unknown;
  name: string;
  apps: AppEntry[];
  createdAt?: unknown;
}

/** Whitelist + serialise one preset document for users (never exposes `createdBy`). */
export function toPublicPreset(preset: PresetLike): PublicPreset {
  return {
    id: String(preset._id),
    name: preset.name,
    apps: preset.apps.map((app) => cloneAppEntry(app)),
    createdAt: toIsoString(preset.createdAt),
  };
}

/** GET /presets — paginated presets in fixed `createdAt desc` order. */
export async function listPresets(query: PageLimitQuery): Promise<Paginated<PublicPreset>> {
  const [total, presets] = await Promise.all([
    Preset.countDocuments(),
    Preset.find()
      .sort({ createdAt: -1, _id: -1 })
      .skip(pageSkip(query.page, query.limit))
      .limit(query.limit)
      .lean(),
  ]);

  return buildPaginated(
    presets.map((preset) => toPublicPreset(preset)),
    query.page,
    query.limit,
    total,
  );
}
