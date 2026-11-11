// e2e/helpers/agent.ts — launch the real Focus Agent (Electron) and read its pairing code
// (T-047 prep, owner A8).
// Why: pairing is the one flow where the dashboard and the desktop agent must cooperate, so the E2E
// test has to attach to the *real* Electron main process — a mocked agent would prove nothing and the
// exam forbids fake components. Playwright's `_electron` driver gives the test the agent's own
// sandboxed renderer window, which is the only place the 6-digit code exists (DEC-003).
// Invariants: FakeDriver only (`AGENT_FOCUS_DRIVER=fake`, never the default in packaged builds), a
// throwaway `userData` dir so journal/consent never leak between runs, the real API as the cloud, and
// the pairing code is never logged — only asserted on in the test process.
// Environment quirks handled here (see docs/KNOWN_ISSUES.md KI-008/KI-009):
//   · `ELECTRON_RUN_AS_NODE` must be REMOVED from the child env, otherwise Electron stays a plain
//     Node process and never opens a window ("Process failed to launch!").
//   · `--no-sandbox` + `--user-data-dir=<temp>` are TEST-ONLY Chromium switches this sandboxed dev
//     machine needs (Chromium sandbox init and HOME writes are denied). The shipped app's Electron
//     hardening is unchanged.
//   · `AGENT_HEADLESS=1` currently creates no renderer window at all, so the code cannot be read in
//     headless mode (KI-009) — the helper therefore launches with a window (`AGENT_HEADLESS=0`).

import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

import { API_BASE_URL, CLIENT_ORIGIN, E2E_AGENT_PORT, E2E_TIMEOUTS } from './config';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);

/** The Focus Agent app directory passed to Electron (`electron <path>`). */
export const AGENT_APP_PATH = path.join(REPO_ROOT, 'agent');
/** The compiled main entry; the harness requires `npm run build -w @focus-mode/agent` first. */
export const AGENT_BUILD_ENTRY = path.join(AGENT_APP_PATH, 'dist', 'main.js');

export interface LaunchAgentOptions {
  /**
   * Launch the window-less variant (`AGENT_HEADLESS=1`). Only useful once the agent exposes its
   * pairing code without a window (KI-009); the pairing flow needs the window today.
   */
  headless?: boolean;
  /** Extra environment variables for the agent process (test seams only). */
  env?: Record<string, string>;
  /**
   * Reuse an existing `app.getPath('userData')` directory (reconnect/relaunch tests). The helper
   * then does NOT delete it on close — the caller owns the directory lifecycle.
   */
  userDataDir?: string;
}

export interface LaunchedAgent {
  /** The Electron application handle (main process); close it via `close()`. */
  app: ElectronApplication;
  /** The agent's own renderer window — the only place the pairing code is visible. */
  window: Page;
  /** The 6-digit pairing code read from `#pairing-code`, digits only. */
  pairingCode: string;
  /** `app.getPath('userData')` directory used for this run (temp unless `userDataDir` was given). */
  userDataDir: string;
  /** Read the code again (e.g. after the agent rotates it on a failed pairing). */
  readPairingCode(): Promise<string>;
  /** Read the agent's visible state line (`#state-line`). */
  readStateLine(): Promise<string>;
  /** Hard-kill the Electron process (SIGKILL) — simulates a real crash (T-080). */
  killProcess(): void;
  /**
   * Relaunch the agent with the SAME userData directory (device token / journal state survive),
   * e.g. after `killProcess()`. Resolves to a fresh handle; the returned agent owns the dir.
   */
  relaunch(): Promise<LaunchedAgent>;
  /** Quit the agent and remove the temp user-data directory (only when the helper created it). */
  close(): Promise<void>;
}

/** Build a child env that never inherits `ELECTRON_RUN_AS_NODE` (KI-008) and is string-valued. */
function buildAgentEnv(userDataDir: string, options: LaunchAgentOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }

  return {
    ...env,
    AGENT_PORT: String(E2E_AGENT_PORT),
    AGENT_FOCUS_DRIVER: 'fake', // AGENTS §8: fake only for dev/test, never packaged.
    AGENT_HEADLESS: options.headless === true ? '1' : '0',
    AGENT_LOG_LEVEL: process.env.AGENT_E2E_LOG_LEVEL ?? 'warn',
    AGENT_ALLOWED_ORIGINS: CLIENT_ORIGIN,
    AGENT_API_BASE_URL: API_BASE_URL,
    AGENT_USER_DATA_DIR: userDataDir,
    ...options.env,
  };
}

/** Extract the six digits from `#pairing-code` (`"4 8 2 9 1 6"` is rendered with spaces). */
async function extractPairingCode(window: Page): Promise<string> {
  await window.waitForSelector('#pairing-code', {
    state: 'visible',
    timeout: E2E_TIMEOUTS.expectMs,
  });
  await window.waitForFunction(
    () => /[0-9]/.test(document.querySelector('#pairing-code')?.textContent ?? ''),
    undefined,
    { timeout: E2E_TIMEOUTS.expectMs },
  );

  const rendered = (await window.locator('#pairing-code').textContent()) ?? '';
  const code = rendered.replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) {
    throw new Error(
      `Focus Agent pairing code must be 6 digits, got ${code.length} (rendered as "${rendered}")`,
    );
  }
  return code;
}

/** Wait at most `ms` for `promise`, then reject (used for a wedged Electron close). */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Launch the Focus Agent with the FakeDriver against the E2E API and return its window + code.
 * Requires a compiled agent: `npm run build -w @focus-mode/agent` (root `pretest:e2e` does this).
 */
export async function launchAgent(options: LaunchAgentOptions = {}): Promise<LaunchedAgent> {
  const ownedUserDataDir = options.userDataDir === undefined;
  const userDataDir = options.userDataDir ?? mkdtempSync(path.join(tmpdir(), 'focus-agent-e2e-'));
  // Resolved through Node (not hard-coded) so a local/CI Electron version bump keeps working.
  const electronExecutable = require('electron') as string;

  const app = await electron.launch({
    executablePath: electronExecutable,
    // Chromium switches MUST precede the app path (Electron treats the first positional as the app).
    args: ['--no-sandbox', `--user-data-dir=${userDataDir}`, AGENT_APP_PATH],
    env: buildAgentEnv(userDataDir, options),
    timeout: E2E_TIMEOUTS.electronLaunchMs,
  });

  try {
    if (options.headless === true) {
      // KI-009: no window exists in headless mode, so the pairing code is unreadable — fail clearly.
      throw new Error(
        'AGENT_HEADLESS=1 creates no renderer window; the pairing code cannot be read (KI-009).',
      );
    }

    const window = await app.firstWindow({ timeout: E2E_TIMEOUTS.firstWindowMs });
    await window.waitForSelector('#state-line', { timeout: E2E_TIMEOUTS.expectMs });
    const pairingCode = await extractPairingCode(window);

    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      try {
        await withTimeout(app.close(), 15_000, 'Focus Agent close');
      } catch {
        // A wedged renderer must not mask the actual test failure: kill and clean up.
        app.process().kill('SIGKILL');
      } finally {
        if (ownedUserDataDir) rmSync(userDataDir, { recursive: true, force: true });
      }
    };

    // NOTE: the profile is deliberately NOT removed on an unexpected process exit — the
    // kill/relaunch reconnect test needs the journal (and stored token) to survive a SIGKILL.
    // Only an explicit `close()` cleans up a helper-owned directory.

    const killProcess = (): void => {
      const child = app.process();
      if (child === undefined || child.killed || child.exitCode !== null) return;
      // A real crash: SIGKILL, no graceful shutdown, no cleanup — the userData dir must stay.
      child.kill('SIGKILL');
    };

    const relaunch = async (): Promise<LaunchedAgent> => launchAgent({ ...options, userDataDir });

    return {
      app,
      window,
      pairingCode,
      userDataDir,
      readPairingCode: () => extractPairingCode(window),
      readStateLine: async () => (await window.locator('#state-line').textContent()) ?? '',
      killProcess,
      relaunch,
      close,
    };
  } catch (error) {
    // Never leak an Electron process or a temp profile when the launch bootstrap fails.
    try {
      app.process().kill('SIGKILL');
    } finally {
      if (ownedUserDataDir) rmSync(userDataDir, { recursive: true, force: true });
    }
    throw error;
  }
}

/** Assert the Focus Agent window is the real W1 agent UI (used by the harness smoke spec). */
export async function expectAgentWindow(agent: LaunchedAgent): Promise<void> {
  await expect(agent.window).toHaveTitle('Focus Mode — Focus Agent');
  await expect(agent.window.locator('#agent-title')).toHaveText('Focus Agent');
}
