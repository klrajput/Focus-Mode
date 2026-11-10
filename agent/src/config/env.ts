// config/env.ts — the Focus Agent's single validated environment entry point (DEC-013).
// dotenv is loaded for development only (never inside a packaged build) and every value is
// parsed by zod so a bad port, wildcard Origin or unknown driver fails fast at startup instead
// of silently weakening the loopback link (NFR-004, NFR-010, SEC-8). No other module reads
// process.env; ports and URLs are literals only inside this file.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/** Who moves the windows. `real` is the only acceptable packaged value (AGENTS §8). */
export const focusDriverNameSchema = z.enum(['real', 'fake']);
export type FocusDriverName = z.infer<typeof focusDriverNameSchema>;

export const agentLogLevelSchema = z.enum(['error', 'warn', 'info', 'verbose', 'debug', 'silly']);
export type AgentLogLevel = z.infer<typeof agentLogLevelSchema>;

const portSchema = z.coerce.number().int().min(1024).max(65535);

const booleanSchema = z
  .enum(['0', '1', 'true', 'false'])
  .default('0')
  .transform((value) => value === '1' || value === 'true');

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Parses a comma-separated Origin allow-list. Wildcards, paths, credentials and non-HTTP
 * schemes are rejected: the local link must only accept real dashboard origins (NFR-010).
 */
function parseAllowedOrigins(raw: string): readonly string[] {
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    throw new Error('AGENT_ALLOWED_ORIGINS must list at least one origin');
  }

  const normalized = parts.map((part) => {
    if (part.includes('*')) {
      throw new Error(`AGENT_ALLOWED_ORIGINS must not contain wildcards: ${part}`);
    }
    let parsed: URL;
    try {
      parsed = new URL(part);
    } catch {
      throw new Error(`AGENT_ALLOWED_ORIGINS contains an invalid origin: ${part}`);
    }
    if (!HTTP_PROTOCOLS.has(parsed.protocol)) {
      throw new Error(`AGENT_ALLOWED_ORIGINS must use http or https: ${part}`);
    }
    if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
      throw new Error(`AGENT_ALLOWED_ORIGINS must be an origin without a path: ${part}`);
    }
    if (parsed.username !== '' || parsed.password !== '') {
      throw new Error(`AGENT_ALLOWED_ORIGINS must not contain credentials: ${part}`);
    }
    return parsed.origin;
  });

  return Object.freeze([...new Set(normalized)]);
}

function parseApiBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('AGENT_API_BASE_URL must be an absolute http(s) URL');
  }
  if (!HTTP_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('AGENT_API_BASE_URL must use http or https');
  }
  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (!pathname.endsWith('/api/v1')) {
    throw new Error('AGENT_API_BASE_URL must include the /api/v1 prefix (DEC-013)');
  }
  return parsed.toString().replace(/\/+$/, '');
}

const rawEnvSchema = z.object({
  /** Loopback port; the link server falls back to +1…+4 if it is taken (TECHNICAL_DESIGN §6.1). */
  AGENT_PORT: portSchema.default(4545),
  AGENT_ALLOWED_ORIGINS: z.string().min(1).default('http://localhost:5173'),
  AGENT_FOCUS_DRIVER: focusDriverNameSchema.default('real'),
  AGENT_LOG_LEVEL: agentLogLevelSchema.default('info'),
  AGENT_HEADLESS: booleanSchema,
  /**
   * T-113 smoke hook: bind the loopback link, print `SMOKE_READY port=<n>`, answer one `hello`
   * + `getState` and exit 0. Headless by construction (no window, no tray, no cloud pairing).
   */
  AGENT_SMOKE: booleanSchema,
  /** REC-005 re-aside poll window (1–2 s). Out-of-range values fail fast instead of drifting. */
  AGENT_ENFORCE_INTERVAL_MS: z.coerce.number().int().min(1000).max(2000).default(1500),
  /**
   * DEC-021/FR-012: the cancellable scheduled-session heads-up. The contract requires **≥10 s**,
   * so a smaller value is rejected at startup rather than silently weakening the user's escape
   * window; unit tests inject a short window directly instead of going through the environment.
   */
  AGENT_SCHEDULE_HEADSUP_MS: z.coerce.number().int().min(10_000).max(120_000).default(10_000),
  AGENT_API_BASE_URL: z.string().min(1).optional(),
  /** Test/dev override for `app.getPath('userData')` — journal and logs live under it. */
  AGENT_USER_DATA_DIR: z.string().min(1).optional(),
});

/** Validated, immutable agent configuration handed to the rest of the main process. */
export interface AgentConfig {
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  readonly driver: FocusDriverName;
  readonly logLevel: AgentLogLevel;
  readonly headless: boolean;
  readonly smoke: boolean;
  readonly enforceIntervalMs: number;
  readonly scheduleHeadsUpMs: number;
  readonly apiBaseUrl?: string;
  readonly userDataDir?: string;
}

export class AgentEnvError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid Focus Agent environment: ${issues.join('; ')}`);
    this.name = 'AgentEnvError';
    this.issues = [...issues];
  }
}

/** Pure parser: `process.env` shape in, validated config out. Throws `AgentEnvError`. */
export function parseAgentEnv(source: NodeJS.ProcessEnv): AgentConfig {
  const parsed = rawEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new AgentEnvError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`),
    );
  }

  const value = parsed.data;
  const issues: string[] = [];

  let allowedOrigins: readonly string[] = [];
  try {
    allowedOrigins = parseAllowedOrigins(value.AGENT_ALLOWED_ORIGINS);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  let apiBaseUrl: string | undefined;
  if (value.AGENT_API_BASE_URL !== undefined) {
    try {
      apiBaseUrl = parseApiBaseUrl(value.AGENT_API_BASE_URL);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (value.AGENT_USER_DATA_DIR !== undefined && !path.isAbsolute(value.AGENT_USER_DATA_DIR)) {
    issues.push('AGENT_USER_DATA_DIR must be an absolute path');
  }

  if (issues.length > 0) {
    throw new AgentEnvError(issues);
  }

  return Object.freeze({
    port: value.AGENT_PORT,
    allowedOrigins,
    driver: value.AGENT_FOCUS_DRIVER,
    logLevel: value.AGENT_LOG_LEVEL,
    headless: value.AGENT_HEADLESS,
    smoke: value.AGENT_SMOKE,
    enforceIntervalMs: value.AGENT_ENFORCE_INTERVAL_MS,
    scheduleHeadsUpMs: value.AGENT_SCHEDULE_HEADSUP_MS,
    ...(apiBaseUrl === undefined ? {} : { apiBaseUrl }),
    ...(value.AGENT_USER_DATA_DIR === undefined ? {} : { userDataDir: value.AGENT_USER_DATA_DIR }),
  });
}

export interface LoadAgentEnvOptions {
  /** Dev only: call `app.isPackaged ? false : true` from main. */
  readonly loadDotenv?: boolean;
  readonly envFilePath?: string;
  /** Tests inject a fake environment instead of reading the process. */
  readonly source?: NodeJS.ProcessEnv;
}

/** Path to `agent/.env` from either `src/config` (tests) or `dist/config` (runtime). */
export function defaultAgentEnvPath(): string {
  return fileURLToPath(new URL('../../.env', import.meta.url));
}

/** Loads (optionally) the dev `.env`, then validates the process environment. */
export function loadAgentEnv(options: LoadAgentEnvOptions = {}): AgentConfig {
  let fileValues: Record<string, string> = {};
  if (options.loadDotenv === true) {
    const result = loadDotenv({
      path: options.envFilePath ?? defaultAgentEnvPath(),
      processEnv: {},
      override: false,
    });
    if (result.parsed !== undefined) fileValues = result.parsed;
  }

  const source = options.source ?? { ...fileValues, ...process.env };
  return parseAgentEnv(source);
}
