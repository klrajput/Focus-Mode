/*
 * HONEST PLACEHOLDER for the local Focus Agent connection (T-045 / W2).
 * The `AgentLink` WebSocket client, handshake and attestation are explicitly out of scope for
 * T-020, so this hook opens no socket and reports `DISCONNECTED` with `isLive: false`. It exists so
 * `AgentStatusBadge` and `FocusIndicator` already have one typed source and nothing can render a
 * fake "Connected" state in W1. Replace the body with `AgentLinkProvider` in W2; the snapshot shape
 * is intentionally the one TECHNICAL_DESIGN §3 defines for the real provider.
 */

import type { AgentConnectionStatus, FocusSource } from '@focus-mode/shared';

export interface AgentSessionSummary {
  sessionId: string;
  startedAt: string;
  endsAt: string;
  plannedMinutes: number;
  source: FocusSource;
}

export interface AgentConnectionSnapshot {
  status: AgentConnectionStatus;
  session: AgentSessionSummary | null;
  /** `false` until the real link lands; the UI must not claim a live connection. */
  isLive: boolean;
  /** Why the badge shows what it shows (also used as the badge tooltip). */
  detail: string;
}

const NOT_CONNECTED: AgentConnectionSnapshot = Object.freeze({
  status: 'DISCONNECTED',
  session: null,
  isLive: false,
  detail: 'The live Focus Agent link lands in W2 (T-045). No socket is open yet.',
});

/** Current Focus Agent snapshot. W1 always returns the honest disconnected placeholder. */
export function useAgentConnection(): AgentConnectionSnapshot {
  return NOT_CONNECTED;
}
