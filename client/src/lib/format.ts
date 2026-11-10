/*
 * Presentation-only formatting helpers (UX_SPEC §1.5, §4).
 * All dates are formatted in the browser's local zone; the API stores UTC (`Z`) only. Numbers are
 * focused time (`actualMinutes`) unless a caller explicitly passes planned minutes.
 */

/** "1 h 40 m", "45 m", "0 m" — the UX_SPEC §1.5 hour/minute shape. */
export function formatMinutes(minutes: number): string {
  const safe = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;

  if (hours === 0) return `${rest} m`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} m`;
}

/** "60 min" — duration chips and session rows ("25 m"/"60 m" per UX_SPEC §4.3). */
export function formatDuration(minutes: number): string {
  return `${Math.round(minutes)} m`;
}

/** 0.833 → "83 %" (UX_SPEC shows a space before the percent sign). */
export function formatPercent(rate: number): string {
  const value = Number.isFinite(rate) ? Math.max(0, Math.min(1, rate)) : 0;
  return `${Math.round(value * 100)} %`;
}

/** Local date + time for a session row, e.g. "10 Nov 2026, 10:00". */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Local date only, e.g. "10 Nov 2026". Date-only keys (`2026-11-04`) are parsed as local days. */
export function formatDate(iso: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const date = dateOnly ? new Date(`${iso}T00:00:00`) : new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** "Good evening" — used by the dashboard greeting (UX_SPEC §4.3). */
export function greetingFor(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** First word of a display name, for a greeting; falls back to the full string. */
export function firstName(name: string): string {
  const [first] = name.trim().split(/\s+/);
  return first === undefined || first === '' ? name : first;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** `[1,2,3,4,5]` → "Mon, Tue, Wed, Thu, Fri" (readable at 360 px, no clever ranges). */
export function formatScheduleDays(days: readonly number[]): string {
  const labels = [...new Set(days)]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((day) => DAY_LABELS[day] ?? '');

  return labels.length === 0 ? 'No days selected' : labels.join(', ');
}

/** 9 → "09:00" (best-hour label). */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

/** Human label for a device OS value from the API (`macOS` | `windows` | `linux`). */
export function formatOs(os: string): string {
  if (os === 'macOS') return 'macOS';
  if (os === 'windows') return 'Windows';
  if (os === 'linux') return 'Linux';
  return os;
}
