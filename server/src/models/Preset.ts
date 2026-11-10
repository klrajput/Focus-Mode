// server/src/models/Preset.ts — Mongo `presets` collection (TECHNICAL_DESIGN §4, FR-019).
// An admin-published, read-only allow-list template ("Coding", "Study"…): users apply its apps
// into their own allow-list. `name` is unique so the admin UI cannot publish two presets with the
// same label; `createdBy` records the publishing admin (audit only, never exposed to users).

import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import { type AppEntry } from '@focus-mode/shared';
import { appEntrySchema, hasDuplicateAppKeys } from './app-entry.js';

/** Persisted preset. */
export interface IPreset {
  name: string;
  /** Apps the preset grants; key-unique and non-empty (shared presetCreateSchema bounds). */
  apps: AppEntry[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type PresetDocument = HydratedDocument<IPreset>;

const presetSchema = new Schema<IPreset>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    apps: {
      type: [appEntrySchema],
      required: true,
      validate: [
        {
          validator: (apps: AppEntry[]) =>
            apps.length >= 1 && apps.length <= 50 && !hasDuplicateAppKeys(apps),
          message: 'apps must contain 1-50 entries with unique keys',
        },
      ],
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'presets', timestamps: true },
);

// TECHNICAL_DESIGN §4: preset names are unique (admin create returns 409 CONFLICT on 11000).
presetSchema.index({ name: 1 }, { unique: true });

export const Preset: Model<IPreset> = model<IPreset>('Preset', presetSchema);
