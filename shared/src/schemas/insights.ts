// shared/src/schemas/insights.ts — analytics range selector (FR-013).
// Only the three documented ranges are allowed; the timezone override is optional because the
// server prefers the user's stored IANA timezone (REQUIREMENTS §6 day definitions).

import { z } from 'zod';
import { timezoneSchema } from './common.js';

export const insightsRangeSchema = z.enum(['7d', '30d', '90d']);

export const insightsQuerySchema = z.strictObject({
  range: insightsRangeSchema.default('7d'),
  timezone: timezoneSchema.optional(),
});

export type InsightsRange = z.infer<typeof insightsRangeSchema>;
export type InsightsQuery = z.infer<typeof insightsQuerySchema>;
