/*
 * Copy that belongs to the focus session itself (UX_SPEC §4.4/§10.7, ratified by the W1/W2 review).
 * Kept in one module so the indicator, the `/focus` page and the tests can never drift apart.
 */

/** Ratified §4.4 error state for a dropped local link mid-session (F-02). */
export const LINK_LOST_COPY =
  'Lost contact with your Focus Agent. Your session keeps running — the agent ends it on time. Reconnect to End from here.';

/** Compact warning for the sticky indicator (same state, less space). */
export const LINK_LOST_SHORT_COPY = 'Lost contact with your Focus Agent — the session keeps running.';

/** Shown when `exitFocus` could not be sent because no usable socket is open. */
export const END_UNREACHABLE_COPY =
  "We couldn't reach your Focus Agent. Reconnect, or end the session from its tray menu.";

/** Document-title cue while a session runs (UX_SPEC §10.7). */
export function focusingDocumentTitle(minutesLeft: number): string {
  return `Focusing — ${Math.max(0, minutesLeft)} min left — Focus Mode`;
}
