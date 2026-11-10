#!/usr/bin/env node
// scripts/verify/smoke-packaged.mjs — boot the PACKAGED Focus Agent and prove it really works.
//
// This is the release-artifact counterpart of `scripts/smoke/launch.mjs` (which runs the built
// `agent/dist/main.js` through the Electron dev binary). It launches the executable inside the
// packaged app with AGENT_SMOKE=1, waits for `SMOKE_READY port=<n>`, performs the real loopback
// handshake, asserts `hello.paired === false` / `state === 'IDLE'`, and requires the process to
// exit 0 by itself. A fuse mistake (`OnlyLoadAppFromAsar` without app.asar, broken embedded ASAR
// integrity, disabled RunAsNode expected) or a broken preload/asar layout fails this probe.
//
//   node scripts/verify/smoke-packaged.mjs "agent/release/mac-arm64/Focus Mode Agent.app"
//
// Exit codes: 0 = PASS, 1 = failure, 2 = bad usage / app missing.

import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const READY_PATTERN = /^SMOKE_READY port=(\d{4,5})$/;
const TIMEOUT_MS = 25_000;

function resolveExecutable(input) {
  const resolved = path.resolve(input);
  const stat = statSync(resolved);
  if (stat.isFile()) return resolved;
  if (resolved.endsWith('.app')) {
    const macos = path.join(resolved, 'Contents', 'MacOS');
    const entries = readdirSync(macos).filter((entry) => {
      try {
        return statSync(path.join(macos, entry)).isFile();
      } catch {
        return false;
      }
    });
    if (entries.length !== 1) {
      throw new Error(`expected exactly one executable in ${macos}, found ${entries.length}`);
    }
    return path.join(macos, entries[0]);
  }
  // An electron-builder appOutDir contains the .app bundle (mac) or the executable directly.
  const bundles = readdirSync(resolved).filter((entry) => entry.endsWith('.app'));
  if (bundles.length === 1) return resolveExecutable(path.join(resolved, bundles[0]));
  if (bundles.length > 1) {
    throw new Error(`more than one .app in ${resolved}; pass the bundle explicitly`);
  }
  for (const name of ['focus-mode-agent', 'focus-mode-agent.exe', 'Focus Mode Agent.exe']) {
    const candidate = path.join(resolved, name);
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next name
    }
  }
  throw new Error(`no packaged executable found in ${resolved}`);
}

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('could not allocate a loopback port'));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function readFrames(socket, count) {
  const frames = [];
  const waiters = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`expected ${count} frames in time`)),
      TIMEOUT_MS,
    );
    const settle = () => {
      if (frames.length >= count && waiters.length === 0) {
        clearTimeout(timer);
        resolve(frames);
      }
    };
    socket.on('message', (data) => {
      try {
        frames.push(JSON.parse(data.toString()));
      } catch {
        clearTimeout(timer);
        reject(new Error('the packaged agent sent a non-JSON frame'));
        return;
      }
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter(frames.at(-1));
      settle();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once('close', () => {
      if (frames.length < count) {
        clearTimeout(timer);
        reject(new Error('the packaged agent closed the link before answering'));
      }
    });
  });
}

async function main() {
  const input = process.argv[2];
  if (input === undefined) {
    console.error('Usage: node scripts/verify/smoke-packaged.mjs <packaged app or executable>');
    process.exitCode = 2;
    return;
  }

  const executable = resolveExecutable(input);
  const port = await pickFreePort();
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'focus-agent-packaged-smoke-'));
  const env = {
    ...process.env,
    AGENT_SMOKE: '1',
    AGENT_HEADLESS: '1',
    AGENT_FOCUS_DRIVER: 'real',
    AGENT_ALLOWED_ORIGINS: 'http://localhost:5173',
    AGENT_LOG_LEVEL: 'warn',
    AGENT_USER_DATA_DIR: userDataDir,
    AGENT_PORT: String(port),
  };
  delete env.AGENT_API_BASE_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;

  console.log(`[smoke-packaged] executable: ${executable}`);
  const child = spawn(
    executable,
    ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer'],
    {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
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
    rmSync(userDataDir, { recursive: true, force: true });
  };
  const fail = (reason) => {
    console.error(`[smoke-packaged] FAIL ${reason}`);
    const errTail = stderr.trim().split('\n').slice(-20).join('\n');
    if (errTail.length > 0) console.error(`--- agent stderr ---\n${errTail}`);
    const outTail = stdout.trim().split('\n').slice(-20).join('\n');
    if (outTail.length > 0) console.error(`--- agent stdout ---\n${outTail}`);
    cleanup();
    process.exitCode = 1;
  };

  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  const ready = new Promise((resolve) => {
    const timer = setInterval(() => {
      const line = stdout.split('\n').find((entry) => READY_PATTERN.test(entry.trim()));
      if (line !== undefined) {
        clearInterval(timer);
        const match = READY_PATTERN.exec(line.trim());
        resolve(match === null ? undefined : Number(match[1]));
      }
    }, 25);
    setTimeout(() => {
      clearInterval(timer);
      resolve(undefined);
    }, TIMEOUT_MS).unref();
  });

  const readyPort = await ready;
  if (readyPort === undefined) {
    fail('the packaged agent never printed SMOKE_READY (asar/integrity/fuse boot failure?)');
    return;
  }

  const socket = new WebSocket(`ws://127.0.0.1:${readyPort}/link`, ['focus.v1'], {
    origin: 'http://localhost:5173',
  });
  try {
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    // hello + (unpaired: no challenge) then the `state` answer to getState.
    const frames = readFrames(socket, 2);
    socket.send(JSON.stringify({ v: 1, id: 'smoke-1', type: 'getState' }));
    const [hello, state] = await frames;
    if (hello?.type !== 'hello' || hello.paired !== false || hello.state !== 'IDLE') {
      fail(`unexpected hello from the packaged agent: ${JSON.stringify(hello)}`);
      return;
    }
    if (state?.type !== 'state' || state.state !== 'IDLE' || state.session !== undefined) {
      fail(`unexpected state from the packaged agent: ${JSON.stringify(state)}`);
      return;
    }
    socket.close();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  const exit = await Promise.race([
    exited,
    new Promise((resolve) =>
      setTimeout(() => resolve({ code: null, signal: 'timeout' }), TIMEOUT_MS),
    ),
  ]);
  if (exit.code !== 0) {
    fail(
      `the packaged agent did not exit 0 (code=${String(exit.code)}, signal=${String(exit.signal)})`,
    );
    return;
  }
  cleanup();
  console.log('[smoke-packaged] PASS packaged agent booted, served hello/state and exited 0');
}

main().catch((error) => {
  console.error(`[smoke-packaged] FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
