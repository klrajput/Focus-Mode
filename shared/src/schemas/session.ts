// shared/src/schemas/session.ts — session create/finalise/list payloads (FR-010, FR-024, REC-006).
// `clientSessionId` is the idempotency key shared with the agent's cloud reports; a second ACTIVE
// session for one device is a 409 ALREADY_FOCUSING. Strict objects, whitelisted sort fields.

import { z } from 'zod';
import {
  actualMinutesSchema,
  DATE_RANGE_MESSAGE,
  durationMinSchema,
  endReasonSchema,
  focusSourceSchema,
  isOrderedDateRange,
  isoDateTimeSchema,
  objectIdSchema,
  sessionStatusSchema,
  terminalSessionStatusSchema,
  uuidSchema,
} from './common.js';

export const sessionCreateSchema = z.strictObject({
  deviceId: objectIdSchema,
  durationMin: durationMinSchema,
  startedAt: isoDateTimeSchema,
  clientSessionId: uuidSchema,
  source: focusSourceSchema.default('MANUAL'),
});

/** PATCH /sessions/:id — finalise exactly once; repeated identical bodies stay idempotent. */
export const sessionPatchSchema = z.strictObject({
  status: terminalSessionStatusSchema,
  endedAt: isoDateTimeSchema,
  actualMinutes: actualMinutesSchema,
  endReason: endReasonSchema,
});

export const sessionsSortSchema = z.enum([
  'startedAt',
  '-startedAt',
  'endedAt',
  '-endedAt',
  'plannedMinutes',
  '-plannedMinutes',
  'actualMinutes',
  '-actualMinutes',
]);

/** GET /sessions?from&to&status&source&page&limit&sort&search (NFR-009). */
export const sessionListQuerySchema = z
  .strictObject({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: sessionsSortSchema.default('-startedAt'),
    search: z.string().trim().min(1).max(100).optional(),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    status: sessionStatusSchema.optional(),
    source: focusSourceSchema.optional(),
  })
  .refine(isOrderedDateRange, DATE_RANGE_MESSAGE);

export type SessionCreateInput = z.infer<typeof sessionCreateSchema>;
export type SessionPatchInput = z.infer<typeof sessionPatchSchema>;
export type SessionListQuery = z.infer<typeof sessionListQuerySchema>;
