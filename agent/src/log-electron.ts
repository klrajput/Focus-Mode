// log-electron.ts — electron-log adapter for the main process (NFR-016).
// Only this module imports electron-log, so every other agent module can be tested in plain
// Node. Levels are validated in `config/env.ts`; the file transport never receives secrets,
// window titles, URLs or the pairing code by contract (INV-6).

import path from 'node:path';
import { app } from 'electron';
import electronLog from 'electron-log/main';
import type { AgentLogLevel } from './config/env.js';
import type { Logger } from './log.js';

/** Wires electron-log once and returns a `Logger` the rest of the main process can share. */
export function createElectronLogger(level: AgentLogLevel): Logger {
  // Keep logs under the same userData directory as the journal, so an
  // AGENT_USER_DATA_DIR override (tests/dev) is self-contained and nothing is written to an
  // unexpected location. A blocked/unwritable path degrades to the console transport.
  electronLog.transports.file.resolvePathFn = () =>
    path.join(app.getPath('userData'), 'focus-agent.log');
  electronLog.initialize();
  electronLog.transports.file.level = level;
  electronLog.transports.console.level = level;
  return {
    error: (message, ...meta) => electronLog.error(message, ...meta),
    warn: (message, ...meta) => electronLog.warn(message, ...meta),
    info: (message, ...meta) => electronLog.info(message, ...meta),
    debug: (message, ...meta) => electronLog.debug(message, ...meta),
  };
}
