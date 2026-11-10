// shared/src/schemas/allowlist.ts — PUT /allowlist body (FR-008, FR-020).
// `userApps` is user-controlled (≤50). `protectedApps` is accepted only for symmetry: the server
// compares it with its canonical protected set and answers 400 PROTECTED_ENTRY on any change,
// while an identical echo is ignored (INV-3). Strict object (NFR-013).

import { z } from 'zod';
import { appEntrySchema, hasDuplicateAppKeys, UNIQUE_APP_KEYS_MESSAGE } from './app.js';

export const MAX_USER_APPS = 50;

export const allowlistPutSchema = z.strictObject({
  userApps: z
    .array(appEntrySchema)
    .max(MAX_USER_APPS, `At most ${MAX_USER_APPS} user apps are allowed`)
    .refine((apps) => !hasDuplicateAppKeys(apps), UNIQUE_APP_KEYS_MESSAGE),
  protectedApps: z.array(appEntrySchema).max(200).optional(),
});

export type AllowlistPutInput = z.infer<typeof allowlistPutSchema>;
