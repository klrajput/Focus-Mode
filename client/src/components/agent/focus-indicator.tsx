/*
 * FocusIndicator — the always-visible "Focusing" bar slot (FR-009, UX_SPEC §3).
 * Mounted by the AppShell on every authenticated route; it renders nothing while no session is
 * running, which is the only truthful state until the local Focus Agent link lands (W2/T-045).
 * The visual follows the spec: teal mark + "Focusing" + remaining minutes + End Focus. Ending from
 * the dashboard needs the link, so the button is disabled here with an explicit reason — a dead
 * control that pretends to work would be worse than an honest disabled one.
 */

import { Target } from 'lucide-react';

import type { AgentSessionSummary } from '../../agent/agent-connection';
import { Button } from '../ui/button';

export interface FocusIndicatorProps {
  /** `null` while no focus session is running (or while the link is unavailable). */
  session: AgentSessionSummary | null;
}

function remainingMinutes(endsAt: string): number {
  const ends = new Date(endsAt).getTime();
  if (Number.isNaN(ends)) return 0;
  return Math.max(0, Math.round((ends - Date.now()) / 60_000));
}

export function FocusIndicator({ session }: FocusIndicatorProps) {
  if (session === null) return null;

  const minutes = remainingMinutes(session.endsAt);

  return (
    <div
      role="region"
      aria-label="Focus session"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-base px-4 py-2 text-white"
    >
      <p className="flex min-w-0 items-center gap-2 text-[15px] font-medium">
        <Target aria-hidden="true" className="h-4 w-4 shrink-0 text-focus-on-base" />
        <span>Focusing</span>
        <span className="text-text-on-base-muted">— {minutes} min left</span>
      </p>
      <Button
        variant="on-base"
        size="sm"
        disabled
        title="Ending from the dashboard needs the live Focus Agent link — it lands in W2 (T-045)."
      >
        End Focus
      </Button>
    </div>
  );
}
