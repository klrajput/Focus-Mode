// log-process.ts — stderr-only logger for headless runs (AGENT_SMOKE, T-113).
// electron-log's console transport writes to stdout, where the smoke hook must print exactly
// one machine-readable line (`SMOKE_READY port=<n>`), so headless runs get this tiny adapter
// instead. It writes events only — never window titles, URLs, tokens or the pairing code
// (INV-6/NFR-016).

import type { AgentLogLevel } from './config/env.js';
import type { Logger } from './log.js';

const LEVEL_PRIORITY: Readonly<Record<AgentLogLevel, number>> = Object.freeze({
  error: 0,
  warn: 1,
  info: 2,
  verbose: 3,
  debug: 4,
  silly: 5,
});

function describeMeta(meta: readonly unknown[]): string {
  if (meta.length === 0) return '';
  const parts = meta.map((value) => {
    if (value instanceof Error) return value.message;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return '[unserialisable]';
    }
  });
  return ` ${parts.join(' ')}`;
}

/** Returns a `Logger` that never touches stdout and honours the configured level. */
export function createStderrLogger(level: AgentLogLevel): Logger {
  const threshold = LEVEL_PRIORITY[level];
  const write =
    (severity: AgentLogLevel) =>
    (message: string, ...meta: readonly unknown[]): void => {
      if (LEVEL_PRIORITY[severity] > threshold) return;
      process.stderr.write(`[focus-agent] ${severity}: ${message}${describeMeta(meta)}\n`);
    };
  return Object.freeze({
    error: write('error'),
    warn: write('warn'),
    info: write('info'),
    debug: write('debug'),
  });
}
