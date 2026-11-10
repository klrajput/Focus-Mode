// ui/view-state.ts — the exact shape the main process sends to its own renderer.
// The renderer is a sandboxed plain-DOM page (no Node, no bundler), so it re-declares the same
// shape in its own `<script>` with a comment; this module stays the typed source for main and
// preload. No pairing code ever travels beyond this local IPC channel (DEC-003).

import type {
  AgentCapabilities,
  AgentState,
  AppEntry,
  OsName,
  SessionInfo,
} from '@focus-mode/shared';

export interface AgentViewState {
  readonly agentVersion: string;
  readonly os: OsName;
  readonly state: AgentState;
  readonly paired: boolean;
  /** Present only when unpaired; displayed in the agent window, never logged or sent. */
  readonly pairingCode: string | null;
  readonly capabilities: AgentCapabilities;
  readonly session: SessionInfo | null;
  readonly protected: readonly AppEntry[];
  readonly allowList: readonly AppEntry[];
}

export interface EndFocusResult {
  readonly ok: boolean;
  readonly message?: string;
}

export interface QuitResult {
  readonly ok: boolean;
}
