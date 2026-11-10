// ui/preload.cts — the only bridge between the sandboxed renderer and the main process (SEC-8).
// Compiled to CommonJS (`preload.cjs`) because Electron sandboxed preloads are CJS-only.
// It exposes exactly {getState, endFocus, cancelSchedule, quit, showConsentStatus}: no Node, no
// ipcRenderer passthrough, no arbitrary channel names, so a compromised renderer cannot reach the
// OS or the file system. `showConsentStatus` is derived from the state main already sends, so the
// consent read costs no extra IPC channel. `cancelSchedule` only cancels the scheduled-session
// heads-up (DEC-021); it can never start anything. Channel strings mirror AGENT_IPC_CHANNELS in
// `view-state.ts` (asserted by a test) because a sandboxed preload cannot import that ESM module
// at runtime.

import { contextBridge, ipcRenderer } from 'electron';
import type {
  AgentViewState,
  CancelScheduleResult,
  ConsentStatusView,
  EndFocusResult,
  QuitResult,
} from './view-state.js';

/** Honest fallback when the main process has not reported a first-run decision yet (REC-004). */
const UNKNOWN_CONSENT: ConsentStatusView = Object.freeze({
  status: 'unknown',
  grantedAt: null,
  revocable: false,
});

export interface FocusAgentBridge {
  getState(): Promise<AgentViewState>;
  endFocus(): Promise<EndFocusResult>;
  /** DEC-021: cancel the scheduled run in its ≥10 s heads-up; starts nothing. */
  cancelSchedule(): Promise<CancelScheduleResult>;
  quit(): Promise<QuitResult>;
  /** Read-only: the first-run permission stored on this computer (REC-004). */
  showConsentStatus(): Promise<ConsentStatusView>;
}

const bridge: FocusAgentBridge = {
  getState: () => ipcRenderer.invoke('agent:get-state') as Promise<AgentViewState>,
  endFocus: () => ipcRenderer.invoke('agent:end-focus') as Promise<EndFocusResult>,
  cancelSchedule: () => ipcRenderer.invoke('agent:cancel-schedule') as Promise<CancelScheduleResult>,
  quit: () => ipcRenderer.invoke('agent:quit') as Promise<QuitResult>,
  showConsentStatus: async () => {
    const state = (await ipcRenderer.invoke('agent:get-state')) as AgentViewState;
    return state.consent ?? UNKNOWN_CONSENT;
  },
};

contextBridge.exposeInMainWorld('focusAgent', Object.freeze(bridge));
