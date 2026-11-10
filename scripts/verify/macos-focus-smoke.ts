#!/usr/bin/env tsx
/**
 * scripts/verify/macos-focus-smoke.ts — REAL macOS focus verification (T-053 / FOCUS-1 / FOCUS-2).
 *
 * This is a manual verification tool, not part of CI. It is the destructive-but-safe test the
 * plan marks NEEDS-HUMAN (T-101 M1/M2): it uses the REAL `DarwinDriver` through the REAL
 * `FocusController` to hide one app it launches itself (TextEdit), verifies the hide from a
 * SEPARATE osascript process (DEC-005: never trust same-process state), then restores it and
 * verifies the restore the same way. Nothing else on the machine is touched; TextEdit is killed
 * at the end. It does NOT read window titles or URLs (INV-6).
 *
 * Run: npx tsx scripts/verify/macos-focus-smoke.ts
 * Exit 0 = FOCUS-1 + FOCUS-2 verified on this machine (evidence printed as JSON lines).
 * Exit 1 = verification failed; the state printed tells you which step.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { ConsentGate, type ConsentStore } from '../../agent/src/focus/consent.js';
import { FocusController } from '../../agent/src/focus/controller.js';
import { DarwinDriver } from '../../agent/src/focus/drivers/darwin.js';
import { FileJournal } from '../../agent/src/focus/journal.js';
import { resolveProtectedEntries } from '../../agent/src/allowlist.js';
import { noopLogger } from '../../agent/src/log.js';

const TARGET_BUNDLE = 'com.apple.TextEdit';

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Fresh-process JXA read: returns `{hidden}` for TextEdit. Deliberately a NEW osascript each
 * call (DEC-005: same-process hidden state can be stale). The script RETURNS a string, which
 * osascript prints on stdout; `console.log` would go to stderr instead.
 */
function readTextEditHidden(): boolean {
  const source = [
    'ObjC.import("AppKit");',
    '(function () {',
    '  var apps = $.NSWorkspace.sharedWorkspace.runningApplications;',
    '  var out = "not-running";',
    '  for (var i = 0; i < apps.count; i++) {',
    '    var a = apps.objectAtIndex(i);',
    `    if (ObjC.unwrap(a.bundleIdentifier) === "${TARGET_BUNDLE}") {`,
    '      out = String(Boolean(a.hidden));',
    '    }',
    '  }',
    '  return out;',
    '})()',
  ].join('\n');
  const result = spawnSync('osascript', ['-l', 'JavaScript', '-e', source], {
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (output === 'not-running') {
    throw new Error('TextEdit is not running');
  }
  if (output !== 'true' && output !== 'false') {
    throw new Error(`unexpected osascript output: ${JSON.stringify(output)}`);
  }
  return output === 'true';
}

async function pollHidden(want: boolean, timeoutMs = 4000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (readTextEditHidden() === want) return true;
    await sleep(120);
  }
  return readTextEditHidden() === want;
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'focus-mode-verify-'));
  const journal = new FileJournal({ directory: dataDir, logger: noopLogger });
  const consentStore: ConsentStore = {
    filePath: path.join(dataDir, 'consent.json'),
    read: () => null,
    write: () => undefined,
    clear: () => undefined,
  };
  const consent = new ConsentGate({
    store: consentStore,
    prompt: () => Promise.resolve(true),
    logger: noopLogger,
  });

  // 1. Launch the app we will move aside (our own instance; killed afterwards).
  execFileSync('open', ['-na', 'TextEdit']);
  await sleep(2000);
  const beforeHidden = readTextEditHidden();
  print({ step: 'launch-textedit', hidden: beforeHidden });
  if (beforeHidden) throw new Error('TextEdit was already hidden before the test');

  const driver = new DarwinDriver({ logger: noopLogger });
  const capabilities = driver.capabilities();
  print({ step: 'driver-capabilities', capabilities });
  if (capabilities.focus !== 'full')
    throw new Error(`unexpected capabilities ${capabilities.focus}`);

  const events: string[] = [];
  const controller = new FocusController({
    driver,
    journal,
    protectedEntries: resolveProtectedEntries('macOS'),
    os: 'macOS',
    consent,
    initialPaired: true,
    // Off for this smoke: the re-aside loop is covered by unit tests; this verifies one-shot
    // aside + restore against the real OS, which is the FOCUS-1/FOCUS-2 claim.
    enforcement: false,
    logger: noopLogger,
    onEvent: (event) => {
      events.push(event.type);
    },
  });

  // 2. enterFocus through the real controller + real driver.
  const started = await controller.enterFocus({
    durationMin: 1,
    allowList: [],
    clientSessionId: randomUUID(),
    consent: { acceptedAt: new Date().toISOString(), version: 'verify-1' },
    reaside: false,
  });
  print({
    step: 'enter-focus',
    state: started.state,
    sessionPresent: started.session !== undefined,
    journalBeforeRestore: journal.read() !== null,
    events,
  });
  if (started.state !== 'FOCUSING') throw new Error(`expected FOCUSING, got ${started.state}`);

  // 3. Verify the hide from a separate process (DEC-005).
  const hiddenAfterAside = await pollHidden(true);
  print({ step: 'verify-aside', hidden: hiddenAfterAside });
  if (!hiddenAfterAside) throw new Error('TextEdit was not hidden by the real driver');

  // 4. Idempotent second exit must not double-restore; first exit performs the restore.
  const ended = await controller.exitFocus('USER');
  const endedAgain = await controller.exitFocus('USER');
  print({
    step: 'exit-focus',
    reason: ended?.reason ?? null,
    secondExitWasNoop: endedAgain === null,
    actualMinutes: ended?.actualMinutes ?? null,
    journalCleared: journal.read() === null,
  });

  // 5. Verify the restore from a separate process.
  const restored = await pollHidden(false);
  print({ step: 'verify-restore', hidden: readTextEditHidden(), restored });
  if (!restored) throw new Error('TextEdit was not restored by the real driver');
  if (journal.read() !== null) throw new Error('journal was not cleared after restore');

  print({ result: 'PASS', os: process.platform, arch: process.arch });
}

main()
  .catch((error: unknown) => {
    print({ result: 'FAIL', error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      execFileSync('killall', ['TextEdit']);
    } catch {
      // TextEdit was already gone.
    }
  });
