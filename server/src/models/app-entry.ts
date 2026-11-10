// server/src/models/app-entry.ts — embedded Mongoose schema for one allow-list app entry.
// It mirrors the frozen `appEntrySchema` from `@focus-mode/shared` (TECHNICAL_DESIGN §4): allow-lists
// and presets both embed `{key,label,win?,mac?,linux?}`. Keeping one store shape means the API can
// only persist an entry it would also accept over REST, and the Focus Agent only ever receives the
// identifiers it matches on — never window titles or paths (INV-6).

import { Schema } from 'mongoose';
import { type AppEntry } from '@focus-mode/shared';

/** REQUIREMENTS §7 / shared app-entry rules, restated for Mongoose validators. */
export const APP_KEY_PATTERN = /^[a-z0-9-]{2,40}$/;
const APP_LABEL_MIN = 2;
const APP_LABEL_MAX = 60;
const APP_IDENTIFIER_MIN = 1;
const APP_IDENTIFIER_MAX = 120;
const APP_IDENTIFIER_LIST_MAX = 10;

/** One OS identifier list is valid when non-empty and within the shared bounds. */
function isValidIdentifierList(values: string[]): boolean {
  return (
    values.length >= 1 &&
    values.length <= APP_IDENTIFIER_LIST_MAX &&
    values.every(
      (value) =>
        value.trim().length >= APP_IDENTIFIER_MIN && value.trim().length <= APP_IDENTIFIER_MAX,
    )
  );
}

const identifierListValidator = {
  validator: (values: string[]) => isValidIdentifierList(values),
  message:
    'Each identifier list needs 1-10 non-empty strings of at most 120 characters (executable ' +
    'name, bundle id or WM_CLASS)',
};

/**
 * Embedded app entry (`_id: false` — the entry key is the identity, not a generated ObjectId).
 * Optional per-OS lists use `default: undefined` so absent lists stay absent in Mongo instead of
 * becoming empty arrays, matching the strict REST contract.
 */
export const appEntrySchema = new Schema<AppEntry>(
  {
    key: { type: String, required: true, match: [APP_KEY_PATTERN, 'Invalid app key'] },
    label: {
      type: String,
      required: true,
      trim: true,
      minlength: APP_LABEL_MIN,
      maxlength: APP_LABEL_MAX,
    },
    win: {
      type: [String],
      default: undefined,
      validate: identifierListValidator,
    },
    mac: {
      type: [String],
      default: undefined,
      validate: identifierListValidator,
    },
    linux: {
      type: [String],
      default: undefined,
      validate: identifierListValidator,
    },
  },
  { _id: false, versionKey: false },
);

/** True when every key in an entry list is unique — shared by allow-lists and presets. */
export function hasDuplicateAppKeys(entries: readonly AppEntry[]): boolean {
  return new Set(entries.map((entry) => entry.key)).size !== entries.length;
}

/** Copy a shared `AppEntry` into a plain object safe to hand to Mongo / JSON. */
export function cloneAppEntry(entry: AppEntry): AppEntry {
  return {
    key: entry.key,
    label: entry.label,
    ...(entry.win ? { win: [...entry.win] } : {}),
    ...(entry.mac ? { mac: [...entry.mac] } : {}),
    ...(entry.linux ? { linux: [...entry.linux] } : {}),
  };
}
