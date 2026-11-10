/*
 * Local hooks that keep the countdown honest. `useNow` ticks once per second while enabled, and
 * `useCountdown` returns seconds remaining derived from the agent's `endsAt` (no cumulative drift).
 */

import { useEffect, useState } from 'react';

import { remainingSeconds } from './countdown';

/** Wall clock that re-renders once per second while `enabled` (discrete, no animation). */
export function useNow(enabled: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [enabled]);

  return nowMs;
}

/** Seconds until `endsAt`; recomputed from the absolute timestamp on every tick. */
export function useCountdown(endsAt: string | null): number {
  const nowMs = useNow(endsAt !== null);
  return remainingSeconds(endsAt, nowMs);
}
