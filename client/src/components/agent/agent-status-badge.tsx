/*
 * AgentStatusBadge — persistent status slot in the AppShell header (UX_SPEC §3, FR-021/FR-004).
 * The badge reads the real `AgentLinkProvider` state: icon + text always (never colour-only,
 * NFR-008), `aria-live="polite"` so a reconnect is announced once, and a tooltip that explains the
 * current state. While the first attempt is still running it says "Connecting…" (no fake
 * "Connected"); a Disconnected badge is a button that reveals the LNA help card (UX_SPEC §6.3).
 */

import type { AgentConnectionStatus } from '@focus-mode/shared';
import { CheckCircle2, CircleSlash2, Loader2, Target, type LucideIcon } from 'lucide-react';

import { useAgentLink } from '../../agent/agent-link-provider';
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

const CONNECTING_VIEW: StatusView = { tone: 'neutral', icon: Loader2, label: 'Connecting…' };

export function AgentStatusBadge() {
  const agent = useAgentLink();
  const view =
    agent.connecting && agent.status === 'DISCONNECTED'
      ? CONNECTING_VIEW
      : STATUS_VIEWS[agent.status];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Focus Agent status: ${view.label}`}
      className="flex min-w-0 items-center gap-2"
    >
      {/* F-113 / F-08: the wrapper's aria-label is the single announcement source. Hiding the
          visual icon+text from assistive tech keeps the E2E-visible name
          `Focus Agent status: …` stable without announcing the label a second time as content.
          The Disconnected button keeps its own aria-label; only its visual badge is hidden. */}
      {agent.status === 'DISCONNECTED' && !agent.connecting ? (
        <button
          type="button"
          onClick={agent.showHelpCard}
          aria-label={`Focus Agent status: ${view.label}. Show connection help`}
          className="rounded-[var(--radius-pill)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
        >
          <span aria-hidden="true" className="contents">
            <StatusBadge tone={view.tone} icon={view.icon} title={agent.detail}>
              {view.label}
            </StatusBadge>
          </span>
        </button>
      ) : (
        <span aria-hidden="true" className="contents">
          <StatusBadge tone={view.tone} icon={view.icon} title={agent.detail}>
            {view.label}
          </StatusBadge>
        </span>
      )}
    </div>
  );
}
