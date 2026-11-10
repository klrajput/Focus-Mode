/*
 * FocusIndicator — the always-visible "Focusing" bar (FR-009, UX_SPEC §3, T-058).
 * Mounted by the AppShell on every authenticated route and rendered only while a focus session
 * exists; the countdown is derived from the agent's `endsAt` (never from a local start time) and
 * advances once per second with no transition (UX_SPEC §9). End Focus sends the local `exitFocus`
 * control message — the agent restores windows before it emits `focusEnded`.
 *
 * Two states keep the promise "focus must stay visible and cancellable":
 *   · connected  → teal mark + "Focusing" + remaining time + End Focus
 *   · link lost  → amber warning that keeps the remaining time, plus Reconnect (fix F-02)
 * The bar never disappears while a session is running, and `document.title` carries the same cue.
 */

import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Target, WifiOff } from 'lucide-react';

import { useAgentLink } from '../../agent/agent-link-provider';
import { END_UNREACHABLE_COPY, LINK_LOST_SHORT_COPY, focusingDocumentTitle } from '../../focus/copy';
import { formatClock, remainingSeconds, spokenRemaining } from '../../focus/countdown';
import { Button } from '../ui/button';

const TITLE_PREFIX = 'Focusing —';

export function FocusIndicator() {
  const agent = useAgentLink();
  const session = agent.session;
  const visible = session !== null && (agent.status === 'FOCUSING' || agent.linkLost);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!visible) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible]);

  const secondsLeft = remainingSeconds(session?.endsAt ?? null, nowMs);
  const minutesLeft = Math.ceil(secondsLeft / 60);

  // Document-title cue (UX_SPEC §10.7): set while focusing, restore when the session ends.
  useEffect(() => {
    if (!visible) return;
    const previous = document.title;

    return () => {
      // Only restore our own cue; a newly mounted page may already have set its own title.
      if (document.title.startsWith(TITLE_PREFIX)) document.title = previous;
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    document.title = focusingDocumentTitle(minutesLeft);
  }, [visible, minutesLeft]);

  if (!visible || session === null) return null;

  function endFocus(): void {
    if (!agent.endFocus()) toast.error(END_UNREACHABLE_COPY);
  }

  if (agent.linkLost) {
    return (
      <div
        role="timer"
        aria-label={`Focus session: ${spokenRemaining(secondsLeft)}. ${LINK_LOST_SHORT_COPY}`}
        className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-strong bg-amber-subtle px-4 py-2"
      >
        <p className="flex min-w-0 items-center gap-2 text-[15px] font-medium text-amber-text">
          <WifiOff aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>Focusing</span>
          <span className="text-amber-text">— {formatClock(secondsLeft)} left</span>
          <span className="min-w-0 text-[13px] leading-[1.45] break-words">
            · {LINK_LOST_SHORT_COPY}
          </span>
        </p>
        <Button variant="secondary" size="sm" onClick={agent.refresh}>
          Reconnect
        </Button>
      </div>
    );
  }

  return (
    <div
      role="timer"
      aria-label={`Focus session: ${spokenRemaining(secondsLeft)}`}
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-base px-4 py-2 text-white"
    >
      <p className="flex min-w-0 items-center gap-2 text-[15px] font-medium">
        <Target aria-hidden="true" className="h-4 w-4 shrink-0 text-focus-on-base" />
        <span>Focusing</span>
        <span className="text-text-on-base-muted">— {formatClock(secondsLeft)} left</span>
      </p>
      <Button variant="on-base" size="sm" onClick={endFocus}>
        End Focus
      </Button>
    </div>
  );
}
