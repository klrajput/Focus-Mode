// ui/preload.cts — the only bridge between the sandboxed renderer and the main process (SEC-8).
// Compiled to CommonJS (`preload.cjs`) because Electron sandboxed preloads are CJS-only.
// It exposes exactly {getState, endFocus, quit, showConsentStatus}: no Node, no ipcRenderer
// passthrough, no arbitrary channel names, so a compromised renderer cannot reach the OS or the
// file system. `showConsentStatus` is derived from the state main already sends, so the consent
// read costs no extra IPC channel. Channel strings mirror AGENT_IPC_CHANNELS in `view-state.ts`
// (asserted by a test) because a sandboxed preload cannot import that ESM module at runtime.

import { contextBridge, ipcRenderer } from 'electron';
import type {
  AgentViewState,
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
  quit(): Promise<QuitResult>;
  /** Read-only: the first-run permission stored on this computer (REC-004). */
  showConsentStatus(): Promise<ConsentStatusView>;
}

const bridge: FocusAgentBridge = {
  getState: () => ipcRenderer.invoke('agent:get-state') as Promise<AgentViewState>,
  endFocus: () => ipcRenderer.invoke('agent:end-focus') as Promise<EndFocusResult>,
  quit: () => ipcRenderer.invoke('agent:quit') as Promise<QuitResult>,
  showConsentStatus: async () => {
    const state = (await ipcRenderer.invoke('agent:get-state')) as AgentViewState;
    return state.consent ?? UNKNOWN_CONSENT;
  },
};

contextBridge.exposeInMainWorld('focusAgent', Object.freeze(bridge));
