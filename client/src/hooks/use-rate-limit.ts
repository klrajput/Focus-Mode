/*
 * 60-second rate-limit countdown for the auth forms (UX_SPEC §6.2 `RATE_LIMITED`: "disable 60 s").
 * One hook shared by /login and /signup so both forms behave identically; the visible seconds come
 * from a one-second interval that exists only while a limit is active.
 */

import { useCallback, useEffect, useState } from 'react';

const DEFAULT_RATE_LIMIT_MS = 60_000;

export interface RateLimitState {
  secondsRemaining: number;
  isLimited: boolean;
  start: (durationMs?: number) => void;
}

export function useRateLimit(): RateLimitState {
  const [until, setUntil] = useState<number | null>(null);
  const [clock, setClock] = useState<number>(() => Date.now());

  useEffect(() => {
    if (until === null) return;

    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [until]);

  const start = useCallback((durationMs: number = DEFAULT_RATE_LIMIT_MS): void => {
    setClock(Date.now());
    setUntil(Date.now() + durationMs);
  }, []);

  const secondsRemaining = until === null ? 0 : Math.max(0, Math.ceil((until - clock) / 1000));

  return { secondsRemaining, isLimited: secondsRemaining > 0, start };
}
