// server/src/utils/timezone.ts — local-calendar helpers for analytics (T-070, REQUIREMENTS §6).
// Why: "day with focus", "best focus hours" and streaks are defined in the USER's IANA timezone and
// must be DST-correct. The only reliable primitive is `Intl.DateTimeFormat` over the runtime's
// timezone database; calendar-day arithmetic is then done on the *date components* themselves (via
// UTC date math), never by adding fixed offsets — so a 23/25-hour DST day cannot shift a bucket.
// Invariants: no hand-rolled UTC offsets; `YYYY-MM-DD` strings sort lexicographically; hour is 0–23
// (h23) so midnight is `00`, never `24`; an invalid stored zone falls back to UTC instead of throwing.

const FALLBACK_TIME_ZONE = 'UTC';

/** One instant seen through a timezone's wall clock. */
export interface LocalDayHour {
  /** `YYYY-MM-DD` local calendar date. */
  dateKey: string;
  /** 0–23 local hour. */
  hour: number;
  /** 0–59 local minute. */
  minute: number;
}

/** Resolve an IANA timezone, falling back to UTC for a corrupt/unknown stored value. */
export function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return timeZone;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((entry) => entry.type === type)?.value ?? '';
}

/** The local date + hour + minute of an instant in an IANA timezone (Intl only, DST-correct). */
export function localDayHour(instant: Date, timeZone: string): LocalDayHour {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  return {
    dateKey: `${part(parts, 'year')}-${part(parts, 'month')}-${part(parts, 'day')}`,
    hour: Number(part(parts, 'hour')),
    minute: Number(part(parts, 'minute')),
  };
}

/** `YYYY-MM-DD` local date of an instant. */
export function localDateKey(instant: Date, timeZone: string): string {
  return localDayHour(instant, timeZone).dateKey;
}

/** Parse a `YYYY-MM-DD` key into its calendar components (throws on malformed input). */
function parseDateKey(dateKey: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (match === null) {
    throw new RangeError(`Invalid date key: ${dateKey}`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Shift a calendar date by whole days (pure date math — no timezone conversion involved). */
export function addLocalDays(dateKey: string, deltaDays: number): string {
  const { year, month, day } = parseDateKey(dateKey);
  const shifted = new Date(Date.UTC(year, month - 1, day) + deltaDays * 86_400_000);
  const shiftedYear = shifted.getUTCFullYear();
  const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const shiftedDay = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shiftedYear}-${shiftedMonth}-${shiftedDay}`;
}

/** Inclusive ascending list of the `count` calendar dates ending at `endDateKey`. */
export function listLocalDateKeys(endDateKey: string, count: number): string[] {
  const dates: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    dates.push(addLocalDays(endDateKey, -offset));
  }
  return dates;
}

/** 0 = Sunday … 6 = Saturday of a calendar date key. */
export function weekdayOf(dateKey: string): number {
  const { year, month, day } = parseDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Monday of the ISO week containing `dateKey` (weekly analytics buckets start on Monday). */
export function weekStartOf(dateKey: string): string {
  const weekdayIndex = (weekdayOf(dateKey) + 6) % 7; // Monday = 0 … Sunday = 6
  return addLocalDays(dateKey, -weekdayIndex);
}
