// shared/src/schemas/schedule.ts — recurring schedule CRUD payloads (FR-012).
// Days are a non-empty unique subset of 0–6 (0 = Sunday) and startTime is 24h `HH:mm`
// interpreted in the user's IANA timezone (REQUIREMENTS §7). Strict objects (NFR-013).

import { z } from 'zod';
import { displayNameSchema, durationMinSchema } from './common.js';

export const scheduleDaysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1, 'Pick at least one day')
  .max(7)
  .refine((days) => new Set(days).size === days.length, 'Days must be unique');

export const scheduleStartTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'startTime must be 24-hour HH:mm, e.g. 09:00');

export const scheduleCreateSchema = z.strictObject({
  name: displayNameSchema,
  days: scheduleDaysSchema,
  startTime: scheduleStartTimeSchema,
  durationMin: durationMinSchema,
  enabled: z.boolean().default(true),
});

export const scheduleUpdateSchema = z
  .strictObject({
    name: displayNameSchema.optional(),
    days: scheduleDaysSchema.optional(),
    startTime: scheduleStartTimeSchema.optional(),
    durationMin: durationMinSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one schedule field is required');

export type ScheduleCreateInput = z.infer<typeof scheduleCreateSchema>;
export type ScheduleUpdateInput = z.infer<typeof scheduleUpdateSchema>;
