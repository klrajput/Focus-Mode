/*
 * FocusIndicator — the always-visible "Focusing" bar (FR-009, UX_SPEC §3).
 * Mounted by the AppShell on every authenticated route and rendered only while the Focus Agent
 * reports `FOCUSING`; the countdown is derived from the agent's `endsAt` (never from local start
 * time) and advances once per second with no transition (UX_SPEC §9). End Focus sends the local
 * `exitFocus` control message — the agent restores windows before it emits `focusEnded`.
 */

import { useEffect, useState } from 'react';
import { Target } from 'lucide-react';

import { useAgentLink } from '../../agent/agent-link-provider';
import { Button } from '../ui/button';

function remainingSeconds(endsAt: string, nowMs: number): number {
  const ends = new Date(endsAt).getTime();
  if (!Number.isFinite(ends)) return 0;
  return Math.max(0, Math.ceil((ends - nowMs) / 1000));
}

/** 42:10 — minutes are not capped at 60 so a custom 480-minute session stays readable. */
function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function spokenRemaining(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const minutesText = minutes === 1 ? '1 minute' : `${minutes} minutes`;
  const secondsText = seconds === 1 ? '1 second' : `${seconds} seconds`;
  return `${minutesText} ${secondsText} remaining`;
}

export function FocusIndicator() {
  const agent = useAgentLink();
  const session = agent.session;
  const visible = agent.status === 'FOCUSING' && session !== null;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!visible) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible || session === null) return null;

  const secondsLeft = remainingSeconds(session.endsAt, nowMs);

  return (
    <div
      role="region"
      aria-label={`Focus session: ${spokenRemaining(secondsLeft)}`}
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-base px-4 py-2 text-white"
    >
      <p className="flex min-w-0 items-center gap-2 text-[15px] font-medium">
        <Target aria-hidden="true" className="h-4 w-4 shrink-0 text-focus-on-base" />
        <span>Focusing</span>
        <span className="text-text-on-base-muted">— {formatClock(secondsLeft)} left</span>
      </p>
      <Button variant="on-base" size="sm" onClick={agent.endFocus}>
        End Focus
      </Button>
    </div>
  );
}
