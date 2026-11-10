// ui/preload.cts — the only bridge between the sandboxed renderer and the main process (SEC-8).
// Compiled to CommonJS (`preload.cjs`) because Electron sandboxed preloads are CJS-only.
// It exposes exactly {getState, endFocus, quit}: no Node, no ipcRenderer passthrough, no
// arbitrary channel names, so a compromised renderer cannot reach the OS or the file system.

import { contextBridge, ipcRenderer } from 'electron';
import type { AgentViewState, EndFocusResult, QuitResult } from './view-state.js';

export interface FocusAgentBridge {
  getState(): Promise<AgentViewState>;
  endFocus(): Promise<EndFocusResult>;
  quit(): Promise<QuitResult>;
}

const bridge: FocusAgentBridge = {
  getState: () => ipcRenderer.invoke('agent:get-state') as Promise<AgentViewState>,
  endFocus: () => ipcRenderer.invoke('agent:end-focus') as Promise<EndFocusResult>,
  quit: () => ipcRenderer.invoke('agent:quit') as Promise<QuitResult>,
};

contextBridge.exposeInMainWorld('focusAgent', Object.freeze(bridge));
