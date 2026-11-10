// shared/src/schemas/app.ts — allow-list app entry (FR-020, TECHNICAL_DESIGN §4).
// The `key` is a stable lowercase slug; `win`/`mac`/`linux` hold exe names, bundle ids and
// WM_CLASS values. Matching uses only these identifiers, never window titles (INV-6).
// Strict object so unknown fields are rejected (NFR-013); protected checking lives in protected.ts.

import { z } from 'zod';

/** REQUIREMENTS §7 — keys are `[a-z0-9-]`, 2–40 chars. */
export const APP_KEY_PATTERN = /^[a-z0-9-]{2,40}$/;

export const appKeySchema = z
  .string()
  .regex(APP_KEY_PATTERN, 'App key must be 2-40 characters of a-z, 0-9 or "-"');

export const appLabelSchema = z.string().trim().min(2).max(60);

/** One executable name / bundle id / WM_CLASS value; owned by the Focus Agent matcher. */
export const appIdentifierSchema = z.string().trim().min(1).max(120);

export const appEntrySchema = z.strictObject({
  key: appKeySchema,
  label: appLabelSchema,
  win: z.array(appIdentifierSchema).min(1).max(10).optional(),
  mac: z.array(appIdentifierSchema).min(1).max(10).optional(),
  linux: z.array(appIdentifierSchema).min(1).max(10).optional(),
});

/** True when two entries share a key — allow-lists and presets must stay key-unique. */
export function hasDuplicateAppKeys(apps: readonly AppEntry[]): boolean {
  return new Set(apps.map((app) => app.key)).size !== apps.length;
}

export const UNIQUE_APP_KEYS_MESSAGE = 'App keys must be unique';

export type AppEntry = z.infer<typeof appEntrySchema>;
