// shared/src/schemas/user.ts — profile, timezone and password-change payloads (FR-029).
// PATCH /users/me accepts any non-empty subset of profile fields; at least one is required so
// empty updates are a validation error instead of a silent no-op. Strict objects everywhere.

import { z } from 'zod';
import { displayNameSchema, durationMinSchema, timezoneSchema } from './common.js';
import { passwordSchema } from './auth.js';

export const profilePatchSchema = z
  .strictObject({
    name: displayNameSchema.optional(),
    timezone: timezoneSchema.optional(),
    defaultDurationMin: durationMinSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one profile field is required');

export const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1).max(72),
    newPassword: passwordSchema,
  })
  .refine(
    (value) => value.currentPassword !== value.newPassword,
    'New password must differ from the current password',
  );

export type ProfilePatchInput = z.infer<typeof profilePatchSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
