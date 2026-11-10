// playwright.config.ts — E2E harness for Focus Mode (T-047 prep, owner A8).
// What runs: the real Vite dashboard dev server + the real Express/MongoDB API (in-memory mongod,
// seeded with the DEC-013 demo data) + real Electron Focus Agent tests via `_electron` helpers.
// Why this shape: the exam forbids faked backend/DB/auth, so every layer under test is the production
// implementation; the harness only owns lifecycle (start/stop, ports, timeouts, artifacts).
// Browsers: this file NEVER hard-codes a browser path. Playwright reads `PLAYWRIGHT_BROWSERS_PATH`
// from the environment; on this sandboxed dev machine the cache lives in the workspace (KI-007), so
// run locally with:
//   PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright-browsers npx playwright test
// CI installs browsers into the default cache and needs no variable.
// Prerequisites: `npm run build -w @focus-mode/shared` (API + client import its dist) and
// `npm run build -w @focus-mode/agent` (the Electron pairing spec launches the compiled app) —
// both are wired into the proposed root `pretest:e2e` script.

import { defineConfig, devices } from '@playwright/test';

import {
  API_HEALTH_URL,
  API_BASE_URL,
  CLIENT_ORIGIN,
  E2E_AGENT_PORT,
  E2E_CLIENT_PORT,
  E2E_TIMEOUTS,
} from './e2e/helpers/config';

/** Inherited env with `undefined` values removed, then `extra` on top (Playwright needs strings). */
function serverEnv(extra: Record<string, string>): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) inherited[key] = value;
  }
  return { ...inherited, ...extra };
}

const isCI = process.env.CI !== undefined && process.env.CI !== '';

export default defineConfig({
  testDir: './e2e',
  // The API process and its in-memory database are shared by the whole run, and the pairing flow is
  // stateful: one worker keeps runs deterministic (the product is a single-user desktop tool).
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: E2E_TIMEOUTS.expectMs },
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: CLIENT_ORIGIN,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Real API + in-memory MongoDB + DEC-013 seed (see e2e/helpers/start-api.ts).
      command: 'npx tsx e2e/helpers/start-api.ts',
      url: API_HEALTH_URL,
      timeout: E2E_TIMEOUTS.webServerStartMs,
      reuseExistingServer: !isCI,
      stdout: 'pipe',
      stderr: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 20_000 },
    },
    {
      // Real dashboard dev server, pointed at the E2E API (Vite inlines VITE_* at startup).
      // The agent-link port is pinned to the E2E agent's port with a 1-port range, so the dashboard's
      // port scan can only find the agent this harness launched — never a developer's 4545 agent.
      command: `npm run dev --workspace @focus-mode/client -- --host 127.0.0.1 --port ${E2E_CLIENT_PORT} --strictPort`,
      url: `${CLIENT_ORIGIN}/login`,
      timeout: E2E_TIMEOUTS.webServerStartMs,
      reuseExistingServer: !isCI,
      env: serverEnv({
        VITE_API_BASE_URL: API_BASE_URL,
        VITE_AGENT_PORT: String(E2E_AGENT_PORT),
        VITE_AGENT_PORT_RANGE: '1',
      }),
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
