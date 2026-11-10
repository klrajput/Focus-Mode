/*
 * AgentStatusBadge — persistent status slot in the AppShell header (UX_SPEC §3, FR-021).
 * Status is always icon + text (never colour-only, NFR-008) and the copy always says "Focus Agent",
 * never bare "agent". In W1 there is no local link yet, so the badge honestly shows "not connected"
 * with a visible note that the live link lands in W2 — no fake "Connected" state is possible.
 */

import type { AgentConnectionStatus } from '@focus-mode/shared';
import { CheckCircle2, CircleSlash2, Target, type LucideIcon } from 'lucide-react';

import { useAgentConnection } from '../../agent/agent-connection';
import { StatusBadge, type BadgeTone } from '../ui/status-badge';

interface StatusView {
  tone: BadgeTone;
  icon: LucideIcon;
  label: string;
}

const STATUS_VIEWS: Readonly<Record<AgentConnectionStatus, StatusView>> = {
  DISCONNECTED: { tone: 'neutral', icon: CircleSlash2, label: 'Disconnected' },
  IDLE: { tone: 'neutral', icon: CircleSlash2, label: 'Not paired' },
  PAIRED: { tone: 'success', icon: CheckCircle2, label: 'Connected' },
  FOCUSING: { tone: 'focus', icon: Target, label: 'Focusing' },
};

export function AgentStatusBadge() {
  const agent = useAgentConnection();
  const view = STATUS_VIEWS[agent.status];

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
        role="status"
        aria-live="polite"
        aria-label={`Focus Agent status: ${view.label}`}
        className="min-w-0"
      >
        <StatusBadge tone={view.tone} icon={view.icon} title={agent.detail}>
          {view.label}
        </StatusBadge>
      </div>
      {agent.isLive ? null : (
        <span className="hidden max-w-[16rem] truncate text-[13px] text-muted md:inline">
          Focus Agent · live link lands in W2
        </span>
      )}
    </div>
  );
}
