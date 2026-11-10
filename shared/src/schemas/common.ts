// shared/src/schemas/common.ts — primitive REST field schemas used by dashboard AND API.
// One definition of ids, ISO timestamps, IANA time zones, enums, pagination and durations so
// client and server cannot drift (NFR-001); every object built from these stays strict so
// unknown/operator-style fields are rejected (NFR-013, SEC-9). Pure zod: no Express/Mongoose.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Identifiers and timestamps
// ---------------------------------------------------------------------------

/** MongoDB ObjectId serialised as 24 hex characters over the wire. */
export const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
export const objectIdSchema = z
  .string()
  .regex(OBJECT_ID_PATTERN, 'Expected a 24-character hex MongoDB ObjectId');

/** RFC-9562 UUID; used for `clientSessionId` idempotency keys (REC-006). */
export const uuidSchema = z.uuid('Expected a UUID');

/** ISO-8601 UTC timestamp with a `Z` designator (e.g. `2026-11-10T10:00:00.000Z`). */
export const isoDateTimeSchema = z.iso.datetime({
  offset: false,
  message: 'Expected an ISO-8601 UTC timestamp',
});

// ---------------------------------------------------------------------------
// User-facing strings
// ---------------------------------------------------------------------------

/** REQUIREMENTS §7 — display names are 2–60 chars and trimmed. */
export const displayNameSchema = z.string().trim().min(2).max(60);

/** IANA-like shape; the `Intl` check below is the authoritative validity test. */
const IANA_TIME_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/**
 * True when the runtime `Intl` database accepts the zone. Requires an IANA-looking name
 * first so numeric offsets such as `+05:30` (accepted by Intl) are still rejected.
 */
export function isValidIanaTimeZone(value: string): boolean {
  if (!IANA_TIME_ZONE_PATTERN.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidIanaTimeZone, 'Expected a valid IANA time zone name');

// ---------------------------------------------------------------------------
// Numeric bounds
// ---------------------------------------------------------------------------

/** REQUIREMENTS §7 — focus duration is an integer number of minutes in [1, 480]. */
export const durationMinSchema = z.number().int().min(1).max(480);

/** Elapsed minutes are fractional (rounded to 0.1 by the server) and never negative. */
export const actualMinutesSchema = z.number().min(0).max(1440);

// ---------------------------------------------------------------------------
// Enumerations shared by REST payloads (the local channel imports them too)
// ---------------------------------------------------------------------------

export const roleSchema = z.enum(['USER', 'ADMIN']);

/** DB spelling from TECHNICAL_DESIGN §4 (`macOS`, `windows`, `linux`). */
export const osSchema = z.enum(['macOS', 'windows', 'linux']);

/** Device presence as shown on `/devices` (FOCUSING means the agent is running focus). */
export const deviceStatusSchema = z.enum(['CONNECTED', 'DISCONNECTED', 'FOCUSING']);

export const sessionStatusSchema = z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']);
export const terminalSessionStatusSchema = z.enum(['COMPLETED', 'CANCELLED']);

/** FR-010 — who started the session. */
export const focusSourceSchema = z.enum(['MANUAL', 'SCHEDULE']);

/** TECHNICAL_DESIGN §6.2 — why a session ended (shared by REST and the local channel). */
export const endReasonSchema = z.enum([
  'COMPLETED',
  'USER',
  'AGENT',
  'SLEEP',
  'CRASH_RECOVERY',
  'UNPAIRED',
  'QUIT',
]);

/** Installer architecture for admin-published agent download links. */
export const agentArchSchema = z.enum(['x64', 'arm64', 'universal']);

/** Simple semver shape (build tags allowed) for agent version strings. */
export const agentVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'Expected a semver version such as 1.4.0');

/** Attestation nonce (REC-003): opaque, unguessable, URL-safe. */
export const nonceSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Nonce must be 16-128 URL-safe characters');

// ---------------------------------------------------------------------------
// Pagination, sorting and date ranges (NFR-009 list conventions)
// ---------------------------------------------------------------------------

/** Query-string friendly because `z.coerce` turns `"2"` into `2`. */
export const pageSchema = z.coerce.number().int().min(1).default(1);
export const limitSchema = z.coerce.number().int().min(1).max(100).default(20);
export const searchSchema = z.string().trim().min(1).max(100);

/** `from`/`to` filters; ISO-UTC strings compare lexicographically when both are present. */
export function isOrderedDateRange(value: { from?: string; to?: string }): boolean {
  if (!value.from || !value.to) return true;
  return value.from <= value.to;
}

export const DATE_RANGE_MESSAGE = '`from` must be earlier than or equal to `to`';

// ---------------------------------------------------------------------------
// Inferred types (single import point for server/client code)
// ---------------------------------------------------------------------------

export type OsName = z.infer<typeof osSchema>;
export type Role = z.infer<typeof roleSchema>;
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type TerminalSessionStatus = z.infer<typeof terminalSessionStatusSchema>;
export type FocusSource = z.infer<typeof focusSourceSchema>;
export type EndReason = z.infer<typeof endReasonSchema>;
export type AgentArch = z.infer<typeof agentArchSchema>;
