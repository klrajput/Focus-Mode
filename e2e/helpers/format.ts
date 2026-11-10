// e2e/helpers/format.ts — the dashboard's display formatters, mirrored for value-for-value assertions
// (W5 gate, owner A8).
// Why: "the UI matches the API" is only meaningful if the copied formatting is exact; these mirror
// `client/src/lib/format.ts` (`formatMinutes`, `formatPercent`) so a mismatch in either the data or
// the presentation fails the spec. Keep them in sync with the client helpers.

/** Mirror of `client/src/lib/format.ts` `formatMinutes` — "1 h 40 m", "45 m", "0 m". */
export function formatMinutes(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours === 0) return `${rest} m`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} m`;
}

/** Mirror of `client/src/lib/format.ts` `formatPercent` — "83 %". */
export function formatPercent(rate: number): string {
  const value = Number.isFinite(rate) ? Math.max(0, Math.min(1, rate)) : 0;
  return `${Math.round(value * 100)} %`;
}
