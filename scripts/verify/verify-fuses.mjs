#!/usr/bin/env node
// scripts/verify/verify-fuses.mjs — independent fuse-state gate for a packaged Focus Agent (T-080).
//
// Reads the fuses the way an auditor would (the `@electron/fuses` CLI, not our flip code) and
// exits non-zero unless every required fuse has the hardened state. Run it against the packaged
// artifact after `agent/build/flip-fuses.mjs` has run:
//
//   node scripts/verify/verify-fuses.mjs agent/release/mac-arm64
//   node scripts/verify/verify-fuses.mjs "agent/release/mac-arm64/Focus Mode Agent.app"
//   node scripts/verify/verify-fuses.mjs agent/release/win-unpacked
//
// A stock (unflipped) Electron build FAILS here on purpose: RunAsNode is Enabled, Node CLI
// inspect is Enabled, OnlyLoadAppFromAsar is Disabled. That is the "before" evidence; the same
// command must PASS after the flip. This is the SEC-8 gate for release artifacts.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expectedFuseStates,
  platformForTarget,
  resolveFuseTarget,
} from '../../agent/build/flip-fuses.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
/** The exact CLI entrypoint behind `npx @electron/fuses read`; used as a portable fallback. */
const FUSES_CLI = path.join(REPO_ROOT, 'node_modules', '@electron', 'fuses', 'dist', 'bin.js');

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const FUSE_LINE_PATTERN = /^\s*([A-Za-z]\w*) is (Enabled|Disabled|Removed|Inherited)\s*$/;

function stripAnsi(value) {
  return value.replace(ANSI_PATTERN, '');
}

/** Reads fuses through the official CLI: `npx @electron/fuses read --app <path>`. */
function readFuses(target) {
  // The task/contract command is the npx form; `--no-install` keeps it offline and prevents an
  // accidental registry download. Fall back to the checked-in workspace binary if npx is absent.
  const npx = spawnSync('npx', ['--no-install', '@electron/fuses', 'read', '--app', target], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, NO_COLOR: '1' },
  });
  const local =
    npx.status === 0 || !existsSync(FUSES_CLI)
      ? undefined
      : spawnSync(process.execPath, [FUSES_CLI, 'read', '--app', target], {
          encoding: 'utf8',
          env: { ...process.env, NO_COLOR: '1' },
        });
  const result = npx.status === 0 ? npx : (local ?? npx);
  if (result.error !== undefined) throw result.error;
  const stdout = stripAnsi(result.stdout ?? '');
  const stderr = stripAnsi(result.stderr ?? '');
  if (result.status !== 0) {
    throw new Error(`electron-fuses read failed (exit ${String(result.status)}): ${stderr}`);
  }
  if (stdout.trim().length === 0) throw new Error('electron-fuses read produced no output');

  const states = {};
  for (const line of stdout.split('\n')) {
    const match = FUSE_LINE_PATTERN.exec(line);
    if (match !== null) states[match[1]] = match[2];
  }
  return { stdout: stdout.trimEnd(), states };
}

function main() {
  const input = process.argv[2];
  if (input === undefined) {
    console.error('Usage: node scripts/verify/verify-fuses.mjs <appOutDir|app|executable>');
    process.exitCode = 1;
    return;
  }

  const target = resolveFuseTarget(input);
  const platform = platformForTarget(target);
  const { stdout, states } = readFuses(target);

  console.log(stdout);
  console.log(`[verify-fuses] target: ${target} (${platform})`);

  const expected = expectedFuseStates(platform);
  const failures = [];
  for (const [name, wanted] of Object.entries(expected)) {
    const found = states[name];
    if (found === undefined) failures.push(`${name}: expected ${wanted}, fuse was not reported`);
    else if (found !== wanted) failures.push(`${name}: expected ${wanted}, found ${found}`);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`[verify-fuses] FAIL ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('[verify-fuses] PASS every required fuse has the hardened state');
}

try {
  main();
} catch (error) {
  console.error(`[verify-fuses] FAIL ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
