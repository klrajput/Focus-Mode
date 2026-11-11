// e2e/helpers/spawn-api.ts — boot a SECOND, purpose-configured E2E API instance (W6 verification).
// Why: some security behaviours are configuration-driven (a rate-limit ceiling of 1/min is the
// deterministic way to observe 429 without sleeping or hammering). The shared Playwright `webServer`
// runs with test-friendly high limits, so the security spec spawns its own API with explicit env
// overrides, drives it over real HTTP, and stops it afterwards. No source is modified: the same
// `e2e/helpers/start-api.ts` runner is used, only its env differs.
// Invariants: bound to loopback, throwaway MongoDB, killed in `finally`; the caller must always
// await `stop()`.

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const READY_TIMEOUT_MS = 90_000;

export interface SpawnedApi {
  /** e.g. `http://127.0.0.1:5109/api/v1`. */
  readonly baseUrl: string;
  readonly origin: string;
  /** SIGTERM the child (and its process group), wait, then SIGKILL if needed. */
  stop(): Promise<void>;
}

/** Resolve when `url` answers with any HTTP status (ready), or reject after the timeout. */
async function waitForHealth(
  url: string,
  child: ChildProcess,
  output: () => string,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`spawned API exited early (code ${String(child.exitCode)}):\n${output()}`);
    }
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`spawned API did not become ready within ${READY_TIMEOUT_MS} ms:\n${output()}`);
}

/**
 * Start a second API on `port` with extra env overrides (e.g. `{ RATE_LIMIT_PUBLIC_MAX: '1' }`).
 * Always `await api.stop()` in a `finally`.
 */
export async function spawnApi(
  overrides: Record<string, string>,
  port: number,
): Promise<SpawnedApi> {
  const chunks: string[] = [];
  const child = spawn('npx', ['tsx', 'e2e/helpers/start-api.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      E2E_API_PORT: String(port),
      E2E_CLIENT_PORT: process.env.E2E_CLIENT_PORT ?? '5273',
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const collect = (chunk: Buffer): void => {
    chunks.push(chunk.toString('utf8'));
    if (chunks.length > 200) chunks.shift();
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  const output = (): string => chunks.join('');

  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(`${origin}/health`, child, output);
  } catch (error) {
    try {
      process.kill(-child.pid ?? 0, 'SIGKILL');
    } catch {
      // already gone
    }
    throw error;
  }

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    const pid = child.pid;
    try {
      if (pid !== undefined) process.kill(-pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      return;
    }
    const start = Date.now();
    while (child.exitCode === null && Date.now() - start < 15_000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (child.exitCode === null && pid !== undefined) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  };

  return { baseUrl: `${origin}/api/v1`, origin, stop };
}
