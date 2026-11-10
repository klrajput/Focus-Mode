/*
 * Countdown arithmetic for the FocusIndicator and the `/focus` ring (T-057/T-058).
 *
 * Everything is derived from the agent's `endsAt` timestamp and the current clock, never from a
 * local "started x seconds ago" counter, so a slow tab or a re-render can never accumulate drift:
 * after N seconds the displayed value is exactly `endsAt - now`, whatever the interval did.
 */

/** Whole seconds until `endsAt`, floored at 0. `NaN`/missing timestamps read as 0. */
export function remainingSeconds(endsAt: string | null, nowMs: number): number {
  if (endsAt === null) return 0;
  const ends = new Date(endsAt).getTime();
  if (!Number.isFinite(ends)) return 0;
  return Math.max(0, Math.ceil((ends - nowMs) / 1000));
}

/** "42:10" — minutes are not capped at 60 so a 480-minute session stays readable. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.trunc(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** "42 minutes 10 seconds remaining" — the ring's accessible name (UX_SPEC §10.4). */
export function spokenRemaining(totalSeconds: number): string {
  const safe = Math.max(0, Math.trunc(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  const minutesText = minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const secondsText = seconds === 1 ? '1 second' : `${seconds} seconds`;
  return `${minutesText} ${secondsText} remaining`;
}

/**
 * What the polite live region should say, or `null` when nothing new should be announced.
 * Minute granularity above a minute, plus the 30 s / 10 s marks and the end (UX_SPEC §10.4).
 */
export function announcementFor(totalSeconds: number): string | null {
  if (totalSeconds <= 0) return 'Focus session ended.';
  if (totalSeconds === 30) return '30 seconds remaining';
  if (totalSeconds === 10) return '10 seconds remaining';
  if (totalSeconds > 60) {
    const minutes = Math.ceil(totalSeconds / 60);
    return minutes === 1 ? '1 minute remaining' : `${minutes} minutes remaining`;
  }
  return null;
}
