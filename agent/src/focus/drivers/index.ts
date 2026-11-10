// focus/drivers/index.ts — driver selection for the Focus Agent (AGENTS §8, FR-011).
// `AGENT_FOCUS_DRIVER=real` (the default) resolves to the driver for the current platform:
// darwin → JXA, win32 → koffi/user32, linux → wmctrl/xdotool, anything else → Unavailable.
// `fake` is a development/test driver and is a fatal configuration error in a packaged build.
// Selection is injectable (`platform`, `env`, `isPackaged`) so tests cover every branch on any
// OS, and this module never imports Electron (no top-level `app`), so it stays unit-testable.
//
// `detectCapabilities()` is the single place `hello` should read capabilities from: it never
// throws and re-validates against the frozen shared schema, so a broken driver degrades to an
// honest `unsupported` instead of crashing the agent. `resolveRuntimeProtectedApps()` is the
// DEC-006 seam: `main.ts` merges its result into `resolveProtectedEntries(os, additions)` at
// startup, so the OS default browser is protected even when it is not in the static list.

import { agentCapabilitiesSchema, type AgentCapabilities, type AppEntry } from '@focus-mode/shared';
import type { AgentConfig } from '../../config/env.js';
import { noopLogger, type Logger } from '../../log.js';
import type { FocusDriver } from '../driver.js';
import { DarwinDriver } from './darwin.js';
import { FakeDriver } from './fake.js';
import { LinuxX11Driver } from './linux-x11.js';
import { UnavailableDriver } from './unavailable.js';
import { Win32Driver } from './win32.js';

/** Name of a real (OS-backed) driver. */
export type RealFocusDriverName = 'darwin' | 'win32' | 'linux-x11';

/** What `AGENT_FOCUS_DRIVER` accepts; mirrors `config/env.ts` without importing zod here. */
export type FocusDriverName = AgentConfig['driver'];

export class FakeDriverNotAllowedError extends Error {
  constructor() {
    super('AGENT_FOCUS_DRIVER=fake is not allowed in a packaged Focus Agent build');
    this.name = 'FakeDriverNotAllowedError';
  }
}

export class UnknownFocusDriverError extends Error {
  readonly value: string;

  constructor(value: string) {
    super(`Unknown AGENT_FOCUS_DRIVER: "${value}" (expected "real" or "fake")`);
    this.name = 'UnknownFocusDriverError';
    this.value = value;
  }
}

/** Reads `AGENT_FOCUS_DRIVER` with the documented default (`real`) and fails loudly on typos. */
export function resolveConfiguredDriver(env: NodeJS.ProcessEnv = process.env): FocusDriverName {
  const raw = env.AGENT_FOCUS_DRIVER?.trim().toLowerCase();
  if (raw === undefined || raw.length === 0) return 'real';
  if (raw === 'real' || raw === 'fake') return raw;
  throw new UnknownFocusDriverError(raw);
}

/** The real driver that owns `platform`, or `unavailable` for a platform we do not support. */
export function driverNameForPlatform(
  platform: NodeJS.Platform,
): RealFocusDriverName | 'unavailable' {
  if (platform === 'darwin') return 'darwin';
  if (platform === 'win32') return 'win32';
  if (platform === 'linux') return 'linux-x11';
  return 'unavailable';
}

export interface CreateFocusDriverOptions {
  /** Defaults to `AGENT_FOCUS_DRIVER` from `env` (then `process.env`), default `real`. */
  readonly configured?: FocusDriverName;
  readonly isPackaged: boolean;
  readonly logger: Logger;
  /** Defaults to `process.platform`; injected by tests. */
  readonly platform?: NodeJS.Platform;
  /** Injected environment for selection (never used to bypass packaging rules). */
  readonly env?: NodeJS.ProcessEnv;
}

/** Resolves the driver for this process. Throws when a packaged build asks for `fake`. */
export function createFocusDriver(options: CreateFocusDriverOptions): FocusDriver {
  const configured = options.configured ?? resolveConfiguredDriver(options.env);
  if (configured === 'fake') {
    if (options.isPackaged) throw new FakeDriverNotAllowedError();
    options.logger.warn('FakeDriver active — development/test only, never packaged');
    return new FakeDriver();
  }

  const platform = options.platform ?? process.platform;
  let driver: FocusDriver;
  switch (driverNameForPlatform(platform)) {
    case 'darwin':
      driver = new DarwinDriver({ logger: options.logger });
      break;
    case 'win32':
      driver = new Win32Driver({ logger: options.logger });
      break;
    case 'linux-x11':
      driver = new LinuxX11Driver({
        logger: options.logger,
        ...(options.env === undefined ? {} : { env: options.env }),
      });
      break;
    default:
      driver = new UnavailableDriver(
        `No focus driver exists for platform "${platform}"; focus control is unsupported`,
      );
      break;
  }
  options.logger.info('Focus driver selected', { driver: driver.name, platform });
  return driver;
}

/**
 * Capabilities for `hello`/`getState`: calls the driver, never lets a throw escape, and brings
 * the value back through the frozen strict schema (≤10 reasons, ≤200 chars each).
 */
export function detectCapabilities(
  driver: Pick<FocusDriver, 'capabilities'> | (() => AgentCapabilities),
): AgentCapabilities {
  let reported: AgentCapabilities;
  try {
    reported = typeof driver === 'function' ? driver() : driver.capabilities();
  } catch {
    return {
      focus: 'unsupported',
      reasons: ['The focus driver failed to report capabilities'],
    };
  }

  // A driver could be buggy or malicious beyond its type: guard the runtime shape as well.
  if (typeof reported !== 'object' || reported === null) {
    return {
      focus: 'unsupported',
      reasons: ['The focus driver reported invalid capabilities'],
    };
  }
  const record: Record<string, unknown> = reported as unknown as Record<string, unknown>;
  const rawReasons: unknown = record.reasons;
  const reasons = (Array.isArray(rawReasons) ? rawReasons : [])
    .filter((reason): reason is string => typeof reason === 'string')
    .map((reason) => reason.trim().slice(0, 200))
    .filter((reason) => reason.length > 0)
    .slice(0, 10);
  const candidate: unknown = {
    focus: record.focus,
    ...(reasons.length === 0 ? {} : { reasons }),
  };
  const parsed = agentCapabilitiesSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  return {
    focus: 'unsupported',
    reasons: ['The focus driver reported invalid capabilities'],
  };
}

/**
 * Runtime protected additions resolved at agent start (DEC-006). macOS resolves the default
 * browser through `NSWorkspace.URLForApplicationToOpenURL`; Windows/Linux keep the static list
 * (spike S-1 has no ProgId evidence, and the browser set is already hard-coded). Never throws:
 * a failed lookup must not stop the agent from starting.
 */
export interface RuntimeProtectionOptions {
  readonly platform?: NodeJS.Platform;
  readonly logger?: Logger;
  /** Test seam: resolved driver to use for darwin instead of constructing one. */
  readonly darwin?: Pick<DarwinDriver, 'resolveDefaultBrowser'>;
}

export async function resolveRuntimeProtectedApps(
  options: RuntimeProtectionOptions = {},
): Promise<readonly AppEntry[]> {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') return [];
  const logger = options.logger ?? noopLogger;
  try {
    const darwin = options.darwin ?? new DarwinDriver({ logger });
    const entry = await darwin.resolveDefaultBrowser();
    return entry === undefined ? [] : [entry];
  } catch (error) {
    logger.warn('Could not resolve runtime protected apps; static protection stands', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
