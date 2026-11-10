// focus/controller.harness.ts — shared fixtures for the W3 controller suites (sleep, consent,
// enforcement, crash recovery). Test-only: `tsconfig.build.json` excludes `*.harness.ts`, so it
// never ships in the Focus Agent bundle. Kept out of `*.test.ts` so several suites can import it
// without re-registering another suite's cases.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveProtectedEntries } from '../allowlist.js';
import type { AppEntry } from '@focus-mode/shared';
import { ConsentGate, FileConsentStore } from './consent.js';
import { FakeDriver, type FakeWindowSpec } from './drivers/fake.js';
import { FocusController, type FocusLifecycleEvent } from './controller.js';
import { FileJournal } from './journal.js';

export const SESSION_ID = '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f';
export const START = new Date('2026-11-10T10:00:00.000Z');
export const VSCODE: AppEntry = {
  key: 'vscode',
  label: 'Visual Studio Code',
  mac: ['com.microsoft.VSCode'],
};
export const SLACK: AppEntry = { key: 'slack', label: 'Slack', mac: ['com.tinyspeck.slackmacgap'] };
export const SPOTIFY: AppEntry = {
  key: 'spotify',
  label: 'Spotify',
  mac: ['com.spotify.client'],
};
export const WINDOWS: readonly FakeWindowSpec[] = [
  { handle: 'w-chrome', appKey: 'chrome', identifier: 'com.google.Chrome' },
  { handle: 'w-vscode', appKey: 'vscode', identifier: 'com.microsoft.VSCode' },
  { handle: 'w-slack', appKey: 'slack', identifier: 'com.tinyspeck.slackmacgap' },
  { handle: 'w-hidden', appKey: 'spotify', identifier: 'com.spotify.client', visible: false },
];
export const PROTECTED = resolveProtectedEntries('macOS');

const tempDirs: string[] = [];

/** Temp directory removed by `cleanupHarnessDirs()` in the suite's afterEach. */
export function makeDirectory(prefix = 'focus-w3-'): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

export function cleanupHarnessDirs(): void {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
}

export interface Harness {
  readonly controller: FocusController;
  readonly driver: FakeDriver;
  readonly journal: FileJournal;
  readonly events: FocusLifecycleEvent[];
  readonly consent: ConsentGate;
  readonly prompts: () => number;
}

export interface HarnessOptions {
  windows?: readonly FakeWindowSpec[];
  initialPaired?: boolean;
  driver?: FakeDriver;
  journalDirectory?: string;
  consentDirectory?: string;
  now?: () => Date;
  grantConsent?: boolean;
  enforcement?: false | { intervalMs?: number };
  maxTimerDelayMs?: number;
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const driver = options.driver ?? new FakeDriver(options.windows ?? WINDOWS);
  const journal = new FileJournal({ directory: options.journalDirectory ?? makeDirectory() });
  const events: FocusLifecycleEvent[] = [];
  let promptCount = 0;
  const consent = new ConsentGate({
    store: new FileConsentStore({ directory: options.consentDirectory ?? makeDirectory() }),
    prompt: async () => {
      promptCount += 1;
      return options.grantConsent ?? true;
    },
    now: options.now ?? (() => START),
  });
  const controller = new FocusController({
    driver,
    journal,
    protectedEntries: PROTECTED,
    os: 'macOS',
    consent,
    initialPaired: options.initialPaired ?? true,
    ...(options.enforcement === undefined ? {} : { enforcement: options.enforcement }),
    ...(options.maxTimerDelayMs === undefined ? {} : { maxTimerDelayMs: options.maxTimerDelayMs }),
    now: options.now ?? (() => START),
    onEvent: (event) => events.push(event),
  });
  return { controller, driver, journal, events, consent, prompts: () => promptCount };
}

export function request(
  overrides: Partial<Parameters<FocusController['enterFocus']>[0]> = {},
): Parameters<FocusController['enterFocus']>[0] {
  return {
    durationMin: 60,
    allowList: [VSCODE],
    clientSessionId: SESSION_ID,
    ...overrides,
  };
}

export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}
