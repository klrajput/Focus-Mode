#!/usr/bin/env node
// scripts/smoke/launch.mjs — AGENT_SMOKE launcher (T-113, TECHNICAL_DESIGN §16).
// Spawns the BUILT Focus Agent (`agent/dist/main.js`) with AGENT_SMOKE=1 and drives the real
// loopback link with a real `ws` client. Success requires exactly:
//   • the agent prints one `SMOKE_READY port=<n>` line on stdout,
//   • `hello.paired === false` (unpaired is honest: the smoke run has no cloud pairing),
//   • `getState` answers `state === 'IDLE'` (no focus was faked or left applied),
//   • the agent exits 0 by itself within 20 s.
// Exit codes: 0 = PASS, 1 = assertion/launch failure, 2 = build missing. Never prints PASS
// unless every check above actually ran. This is the local equivalent of the release smoke job;
// real window/tray visuals are a human check (NEEDS-HUMAN).

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
export const AGENT_DIR = path.join(REPO_ROOT, 'agent');
export const DEFAULT_ORIGIN = 'http://localhost:5173';
/** The agent's own failsafe is 20 s; give the launcher a little more so it can report a code. */
export const LAUNCH_TIMEOUT_MS = 25_000;
export const SMOKE_READY_PATTERN = /^SMOKE_READY port=(\d{4,5})$/;

/** Parses the agent's single machine-readable line; returns the port or null. */
export function parseSmokeReady(line) {
  const match = SMOKE_READY_PATTERN.exec(line.trim());
  if (match === null) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
}

/**
 * The acceptance checks for the two frames the smoke hook must produce. Exported so the unit
 * test proves the assertion logic itself (separately from the real Electron run).
 */
export function verifySmokeFrames(hello, state) {
  if (typeof hello !== 'object' || hello === null) {
    throw new Error('no hello frame was received');
  }
  if (hello.type !== 'hello') {
    throw new Error(`expected hello first, got ${String(hello.type)}`);
  }
  if (hello.paired !== false) {
    throw new Error(`hello.paired must be false in a smoke run, got ${String(hello.paired)}`);
  }
  if (hello.state !== 'IDLE') {
    throw new Error(`hello.state must be IDLE in a smoke run, got ${String(hello.state)}`);
  }
  if (typeof state !== 'object' || state === null || state.type !== 'state') {
    throw new Error('getState did not answer with a state frame');
  }
  if (state.state !== 'IDLE') {
    throw new Error(`getState.state must be IDLE, got ${String(state.state)}`);
  }
  if (state.session !== undefined) {
    throw new Error('getState must not report a session in a smoke run');
  }
}

/** Binds an ephemeral loopback port and releases it again (the agent retries +1…+4 anyway). */
export function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('could not allocate a free loopback port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/** Resolves the Electron executable that belongs to this checkout (no global install needed). */
export function resolveElectronBinary() {
  const require = createRequire(path.join(REPO_ROOT, 'package.json'));
  const binary = require('electron');
  if (typeof binary !== 'string' || !existsSync(binary)) {
    throw new Error('the Electron binary is not installed (run npm install at the repo root)');
  }
  return binary;
}

function readFrames(socket, expected) {
  const frames = [];
  const waiters = [];
  let failure;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`expected ${expected} frame(s) within ${LAUNCH_TIMEOUT_MS} ms`));
    }, LAUNCH_TIMEOUT_MS);
    const settle = () => {
      clearTimeout(timer);
      resolve(frames);
    };
    socket.on('message', (data) => {
      let frame;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        failure = new Error('the agent sent a non-JSON frame');
        clearTimeout(timer);
        reject(failure);
        return;
      }
      frames.push(frame);
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter(frame);
      if (frames.length >= expected && waiters.length === 0) settle();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once('close', () => {
      if (frames.length < expected) {
        clearTimeout(timer);
        reject(failure ?? new Error('the agent closed the link before answering'));
      }
    });
  });
  return { frames, waiters, promise };
}

function waitForChildExit(child, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ code: null, timedOut: true }), timeoutMs);
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, timedOut: false });
    });
  });
}

async function main() {
  if (!existsSync(path.join(AGENT_DIR, 'dist', 'main.js'))) {
    process.stderr.write('FAIL build the Focus Agent first: npm run build -w @focus-mode/agent\n');
    process.exit(2);
  }

  const electronBinary = resolveElectronBinary();
  const port = process.env.AGENT_PORT ? Number(process.env.AGENT_PORT) : await pickFreePort();
  const origin = process.env.AGENT_ALLOWED_ORIGINS?.split(',')[0]?.trim() || DEFAULT_ORIGIN;
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'focus-agent-smoke-'));
  mkdirSync(userDataDir, { recursive: true });

  const env = {
    ...process.env,
    AGENT_SMOKE: '1',
    AGENT_HEADLESS: '1',
    AGENT_FOCUS_DRIVER: process.env.AGENT_FOCUS_DRIVER ?? 'fake',
    AGENT_ALLOWED_ORIGINS: origin,
    AGENT_LOG_LEVEL: process.env.AGENT_LOG_LEVEL ?? 'warn',
    AGENT_USER_DATA_DIR: userDataDir,
    AGENT_PORT: String(port),
  };
  // The smoke run must be unpaired; an inherited API base would start a cloud flow.
  delete env.AGENT_API_BASE_URL;
  // KI-008: an inherited ELECTRON_RUN_AS_NODE turns the Electron binary into plain Node, which
  // cannot import `electron` (this session's own env sets it).
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;

  // Headless CI/container reality: Chromium's sandbox helper needs unprivileged user namespaces,
  // which many CI containers (and this workspace sandbox) deny, producing "sandbox initialization
  // failed"/"GPU process isn't usable" within a few hundred ms. A smoke run loads no window and
  // no remote content, so these smoke-only switches are safe and are not passed to a normal tray
  // run (SEC-8 hardening is unchanged there).
  const electronArgs = [
    AGENT_DIR,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-software-rasterizer',
  ];
  const child = spawn(electronBinary, electronArgs, {
    cwd: AGENT_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const cleanup = () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (process.env.KEEP_SMOKE_DATA !== '1') {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  };
  const fail = (reason) => {
    process.stderr.write(`FAIL ${reason}\n`);
    const tail = stderr.trim().split('\n').slice(-15).join('\n');
    if (tail.length > 0) process.stderr.write(`--- agent stderr ---\n${tail}\n`);
    const out = stdout.trim().split('\n').slice(-15).join('\n');
    if (out.length > 0) process.stderr.write(`--- agent stdout ---\n${out}\n`);
    cleanup();
    process.exit(1);
  };

  const overall = setTimeout(
    () => fail(`no PASS within ${LAUNCH_TIMEOUT_MS} ms`),
    LAUNCH_TIMEOUT_MS,
  );
  overall.unref();

  // 1. Wait for the one machine-readable line on stdout.
  const ready = await new Promise((resolve) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const readyPort = parseSmokeReady(line);
        if (readyPort !== null) {
          child.stdout.off('data', onData);
          resolve({ port: readyPort, raw: line });
          return;
        }
      }
    };
    child.stdout.on('data', onData);
    const exit = setTimeout(() => resolve(null), LAUNCH_TIMEOUT_MS);
    exit.unref();
    child.once('exit', () => {
      clearTimeout(exit);
      resolve(null);
    });
  });
  if (ready === null) {
    fail('the agent never printed "SMOKE_READY port=<n>" (see output)');
    return;
  }

  // 2. Connect a real ws client to the real loopback link and do the two-message check.
  let WebSocket;
  try {
    ({ WebSocket } = await import('ws'));
  } catch {
    fail('the ws package is not installed (run npm install at the repo root)');
    return;
  }

  const socket = new WebSocket(`ws://127.0.0.1:${ready.port}/link`, ['focus.v1'], {
    origin,
  });
  const frames = readFrames(socket, 2);
  try {
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    socket.send(JSON.stringify({ v: 1, id: 'smoke-get-state', type: 'getState' }));
    await frames.promise;
    verifySmokeFrames(frames.frames[0], frames.frames[1]);
  } catch (error) {
    socket.terminate();
    fail(`smoke assertion failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  socket.close();

  // 3. The agent must exit 0 by itself (its own 20 s failsafe exits 1).
  const exit = await waitForChildExit(child, LAUNCH_TIMEOUT_MS);
  clearTimeout(overall);
  if (exit.timedOut) {
    fail('the agent did not exit after answering getState');
    return;
  }
  if (exit.code !== 0) {
    fail(`the agent exited with code ${String(exit.code)} signal ${String(exit.signal)}`);
    return;
  }

  cleanup();
  process.stdout.write(
    `PASS AGENT_SMOKE port=${ready.port} hello.paired=false getState.state=IDLE exit=0\n`,
  );
  process.exit(0);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`FAIL ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
