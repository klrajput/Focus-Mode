// server/src/models/Allowlist.ts — Mongo `allowlists` collection (TECHNICAL_DESIGN §4, FR-008).
// One row per user. `protectedApps` is a server-owned copy of the shared protected set and can
// never be removed or altered by a user (INV-3); `userApps` is user-controlled (≤50, unique keys).
// `version` is bumped by the API on change and shipped to the Focus Agent (scheduleDue /
// GET /agent/allowlist) so the agent knows when its cached list is stale.

import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import { type AppEntry } from '@focus-mode/shared';
import { appEntrySchema, hasDuplicateAppKeys } from './app-entry.js';

/** Maximum user apps per allow-list (REQUIREMENTS §7 / shared `MAX_USER_APPS`). */
export const MAX_USER_APPS = 50;
/** Maximum protected apps stored (union of every OS in the shared protected set). */
export const MAX_PROTECTED_APPS = 200;

/** Persisted allow-list. */
export interface IAllowlist {
  userId: Types.ObjectId;
  /** Locked system/browser/Focus Agent entries copied from `shared/src/protected.ts` (INV-3). */
  protectedApps: AppEntry[];
  /** User-chosen apps the Focus Agent must keep visible. */
  userApps: AppEntry[];
  /** Incremented on every change; consumed by the agent to refresh its cache. */
  version: number;
}

export type AllowlistDocument = HydratedDocument<IAllowlist>;

const appListValidator = (max: number) => ({
  validator: (entries: AppEntry[]) => entries.length <= max && !hasDuplicateAppKeys(entries),
  message: `At most ${max} apps with unique keys are allowed`,
});

const allowlistSchema = new Schema<IAllowlist>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    protectedApps: {
      type: [appEntrySchema],
      required: true,
      validate: [
        {
          validator: (entries: AppEntry[]) => entries.length > 0,
          message: 'protectedApps must contain the locked protected set (INV-3)',
        },
        appListValidator(MAX_PROTECTED_APPS),
      ],
    },
    userApps: {
      type: [appEntrySchema],
      required: true,
      default: [],
      validate: appListValidator(MAX_USER_APPS),
    },
    version: { type: Number, required: true, default: 1, min: 1 },
  },
  { collection: 'allowlists' },
);

// TECHNICAL_DESIGN §4: exactly one allow-list per user (FR-008, GET/PUT /allowlist).
allowlistSchema.index({ userId: 1 }, { unique: true });

export const Allowlist: Model<IAllowlist> = model<IAllowlist>('Allowlist', allowlistSchema);
