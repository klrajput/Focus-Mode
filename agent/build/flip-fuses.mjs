#!/usr/bin/env node
// agent/build/flip-fuses.mjs — flip Electron fuses on a packaged Focus Agent (SEC-8, T-080).
//
// Two entrypoints, same fuse map (they must never drift):
//   1. electron-builder `afterPack` (wired in agent/electron-builder.yml as
//      `afterPack: build/flip-fuses.mjs`): electron-builder IMPORTS this module and calls the
//      exported `afterPack(context)` / default export with `{ appOutDir, electronPlatformName }`.
//      This is the packaging path used by `npx electron-builder`.
//   2. Manual/CI CLI: `node agent/build/flip-fuses.mjs <appOutDir>`
// where <appOutDir> is electron-builder's `context.appOutDir` (e.g. `agent/release/mac-arm64`,
// `agent/release/win-unpacked`, `agent/release/linux-unpacked`). A `.app` bundle, the inner
// executable, or a packaged executable path are also accepted so the script is usable by hand.
//
// Security contract (TECHNICAL_DESIGN §7.6 / SEC-8):
//   * RunAsNode                                  OFF (ELECTRON_RUN_AS_NODE cannot turn the app
//                                                     into a plain Node interpreter)
//   * EnableNodeOptionsEnvironmentVariable       OFF (NODE_OPTIONS cannot inject code)
//   * EnableNodeCliInspectArguments              OFF (--inspect / --inspect-brk cannot attach)
//   * OnlyLoadAppFromAsar                        ON  (only our signed/asar-packed app loads)
//   * EnableEmbeddedAsarIntegrityValidation      ON  on macOS, where Electron supports it
//   * EnableCookieEncryption                     ON  (the agent renderer has no cookies; any
//                                                     accidental cookie store is encrypted)
//   * GrantFileProtocolExtraPrivileges           OFF (file:// gets no extra privileges)
//
// MUST run after packaging but BEFORE code signing. On macOS the arm64 ad-hoc signature is reset
// after the binary is modified; electron-builder then applies the real signature (or none for an
// unsigned build). Never run this against an already-signed Developer ID artifact.
//
// It is self-verifying: it reads the wire before and after the flip and exits non-zero unless the
// final state is exactly the expected one. `scripts/verify/verify-fuses.mjs` independently reads
// the same app through the `npx @electron/fuses read --app <path>` CLI.

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  flipFuses,
  FuseState,
  FuseV1Options,
  FuseVersion,
  getCurrentFuseWire,
} from '@electron/fuses';

/** Fuse names in wire order, keyed by the enum's string name (FuseV1Options also has numeric keys). */
export const FUSE_NAMES = Object.freeze(
  Object.keys(FuseV1Options).filter((name) => !/^\d+$/.test(name)),
);

/** Human-readable fuse state for both the library value and the CLI output. */
export function fuseStateName(value) {
  switch (value) {
    case FuseState.DISABLE:
      return 'Disabled';
    case FuseState.ENABLE:
      return 'Enabled';
    case FuseState.REMOVED:
      return 'Removed';
    case FuseState.INHERIT:
      return 'Inherited';
    default:
      return 'Unknown';
  }
}

/** The exact post-flip state this project requires, per target platform. */
export function expectedFuseStates(platform) {
  const expected = {
    RunAsNode: 'Disabled',
    EnableCookieEncryption: 'Enabled',
    EnableNodeOptionsEnvironmentVariable: 'Disabled',
    EnableNodeCliInspectArguments: 'Disabled',
    OnlyLoadAppFromAsar: 'Enabled',
    GrantFileProtocolExtraPrivileges: 'Disabled',
  };
  // Electron only implements embedded ASAR integrity validation on macOS today.
  if (platform === 'darwin') expected.EnableEmbeddedAsarIntegrityValidation = 'Enabled';
  return expected;
}

/** Infers the platform from the packaged artifact path, not from the build host. */
export function platformForTarget(target) {
  if (target.endsWith('.app')) return 'darwin';
  if (/\.exe$/i.test(target)) return 'win32';
  return 'linux';
}

function isDirectory(candidate) {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolves whatever the caller passed (appOutDir, .app bundle, inner binary) to a path
 * `@electron/fuses` understands: a `.app` for macOS, else the packaged executable.
 */
export function resolveFuseTarget(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('Pass the packaged app directory (electron-builder context.appOutDir)');
  }
  const resolved = path.resolve(input);
  if (!existsSync(resolved)) throw new Error(`Packaged app not found: ${resolved}`);

  if (isFile(resolved)) return resolved;

  // A macOS app bundle may itself be the argument (Contents/MacOS is inside it).
  if (resolved.endsWith('.app')) return resolved;

  const entries = readdirSync(resolved);
  const bundles = entries
    .filter((entry) => entry.endsWith('.app'))
    .map((entry) => path.join(resolved, entry))
    .filter(isDirectory);
  if (bundles.length === 1) return bundles[0];
  if (bundles.length > 1) {
    throw new Error(`More than one .app in ${resolved}; pass the bundle explicitly`);
  }

  // Windows: electron-builder writes "<productName>.exe"; Linux uses executableName.
  const preferred = ['focus-mode-agent.exe', 'Focus Mode Agent.exe', 'focus-mode-agent'];
  for (const name of preferred) {
    const candidate = path.join(resolved, name);
    if (isFile(candidate)) return candidate;
  }
  const executables = entries
    .filter((entry) => /\.exe$/i.test(entry) && !/^(elevate|crashpad_handler)\.exe$/i.test(entry))
    .map((entry) => path.join(resolved, entry))
    .filter(isFile);
  if (executables.length === 1) return executables[0];
  if (executables.length > 1) {
    throw new Error(`Could not choose the packaged executable in ${resolved}; pass it explicitly`);
  }
  throw new Error(`No packaged Focus Agent executable found in ${resolved}`);
}

/** Turns a `getCurrentFuseWire` result into `{RunAsNode: 'Disabled', ...}`. */
export function describeFuseWire(wire) {
  const described = {};
  for (const name of FUSE_NAMES) {
    described[name] = fuseStateName(wire[FuseV1Options[name]]);
  }
  return described;
}

/** Returns a list of human-readable mismatches; empty means the required state is in place. */
export function verifyFuseWire(wire, platform) {
  const actual = describeFuseWire(wire);
  const expected = expectedFuseStates(platform);
  const failures = [];
  for (const [name, wanted] of Object.entries(expected)) {
    const found = actual[name];
    if (found !== wanted) failures.push(`${name}: expected ${wanted}, found ${found}`);
  }
  return failures;
}

function printWire(label, wire) {
  console.log(`[fuses] ${label} (wire v${wire.version})`);
  for (const [name, state] of Object.entries(describeFuseWire(wire))) {
    console.log(`  ${name}: ${state}`);
  }
}

function fuseConfigFor(platform) {
  const config = {
    version: FuseVersion.V1,
    // Required for an unsigned arm64 build; must run before any real signing (see header).
    resetAdHocDarwinSignature: platform === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  };
  if (platform === 'darwin') {
    config[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] = true;
  }
  return config;
}

/**
 * Flips + self-verifies the fuses for one resolved target. Shared by the CLI entrypoint and the
 * electron-builder `afterPack` hook so both paths can never drift apart.
 * @param {string} target path accepted by `resolveFuseTarget`
 * @param {string} platform `darwin` | `win32` | `linux`
 */
export async function applyHardenedFuses(target, platform) {
  console.log(`[fuses] target: ${target} (${platform})`);

  const before = await getCurrentFuseWire(target);
  printWire('before', before);

  await flipFuses(target, fuseConfigFor(platform));

  const after = await getCurrentFuseWire(target);
  printWire('after', after);

  const failures = verifyFuseWire(after, platform);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`[fuses] FAIL ${failure}`);
    throw new Error(`fuse verification failed (${failures.length} mismatch(es))`);
  }
  console.log('[fuses] PASS every required fuse has the hardened state');
  return after;
}

/**
 * electron-builder `afterPack` hook (wired from agent/electron-builder.yml).
 *
 * IMPORTANT: electron-builder does NOT spawn `node flip-fuses.mjs <appOutDir>` — it imports this
 * module and calls the exported function with its AfterPackContext:
 *   { appOutDir, outDir, arch, targets, packager, electronPlatformName }
 * The CLI form above stays available for manual verification.
 *
 * @param {{ appOutDir: string, electronPlatformName: string }} context
 */
export async function afterPack(context) {
  const { appOutDir, electronPlatformName } = context ?? {};
  if (typeof appOutDir !== 'string' || appOutDir.length === 0) {
    throw new Error('afterPack: electron-builder context has no appOutDir');
  }
  const platform = electronPlatformName === 'darwin' ? 'darwin' : electronPlatformName === 'win32' ? 'win32' : 'linux';
  console.log(`[fuses] afterPack appOutDir: ${appOutDir} (${platform})`);
  const target = resolveFuseTarget(appOutDir);
  return applyHardenedFuses(target, platform);
}

export default afterPack;

async function main() {
  const input = process.argv[2];
  if (input === undefined) {
    console.error('Usage: node agent/build/flip-fuses.mjs <appOutDir>');
    process.exitCode = 1;
    return;
  }

  const target = resolveFuseTarget(input);
  const platform = platformForTarget(target);
  try {
    await applyHardenedFuses(target, platform);
  } catch (error) {
    console.error(`[fuses] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[fuses] FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
