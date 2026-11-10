// Timezone options for the profile form (FR-029). The IANA database in the user's own browser is
// the source of truth: `Intl.supportedValuesOf('timeZone')` when available, a small honest fallback
// otherwise, plus the user's stored zone so an old value is never dropped from the select.

const FALLBACK_TIME_ZONES = [
  'UTC',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
] as const;

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: string) => string[];
};

/** Sorted IANA zone list; always includes `current` when it is a non-empty string. */
export function listTimeZones(current?: string): string[] {
  let supported: string[] = [];
  try {
    supported = (Intl as IntlWithSupportedValues).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    supported = [];
  }

  const zones = new Set<string>(supported.length > 0 ? supported : FALLBACK_TIME_ZONES);
  if (current !== undefined && current !== '') zones.add(current);

  return [...zones].sort((a, b) => a.localeCompare(b));
}
