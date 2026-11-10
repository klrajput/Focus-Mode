// server/src/utils/serialize.ts — tiny wire-serialisation helpers shared by the W3 read models.
// Why: Mongo dates must reach clients as ISO-8601 UTC strings (or null), never as Date objects or
// epoch numbers (INTEGRATION_CONTRACTS §1.3), and every service mapper must agree on that rule.
// Invariants: ISO strings keep milliseconds + `Z`; null/undefined/other input becomes null.

/** ISO-8601 UTC string for a Date (or an existing ISO string), else null. */
export function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}
