// server/src/utils/pagination.ts — the NFR-009 list convention used by the W3 endpoints (T-060/062).
// Why: schedules and presets have no resource-specific query schema in `shared` (INTEGRATION
// CONTRACTS §1.6: "lists without a shared sort schema accept page/limit only"), so the page/limit
// schema below is composed from the FROZEN shared primitives instead of duplicating bounds; one
// `buildPaginated` helper keeps `{items,page,limit,total,totalPages}` identical everywhere.
// Invariants: page >= 1, 1 <= limit <= 100 (shared schemas); totalPages = 0 for an empty list.

import { z } from 'zod';
import { limitSchema, pageSchema, type Paginated } from '@focus-mode/shared';

/** Query schema for lists with no shared sort schema (page/limit only, strict). */
export const pageLimitQuerySchema = z.strictObject({
  page: pageSchema,
  limit: limitSchema,
});

export type PageLimitQuery = z.infer<typeof pageLimitQuerySchema>;

/** MongoDB skip value for a 1-based page. */
export function pageSkip(page: number, limit: number): number {
  return (page - 1) * limit;
}

/** Build the frozen paginated envelope. */
export function buildPaginated<T>(
  items: T[],
  page: number,
  limit: number,
  total: number,
): Paginated<T> {
  return {
    items,
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}
