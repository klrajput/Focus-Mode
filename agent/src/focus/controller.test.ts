// focus/controller.test.ts — enter/exit ordering, absolute timer, idempotent restore, recovery.
// These tests are the acceptance evidence for INV-4 (journal written before windows move),
// INV-5 (restore is idempotent and journal-backed) and FR-024 (ALREADY_FOCUSING), all without
// touching the real OS.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveProtectedEntries, type WindowRef } from '../allowlist.js';
import type { AppEntry } from '@focus-mode/shared';
import type { FocusDriver, RestorePlan } from './driver.js';
import { FakeDriver, type FakeWindowSpec } from './drivers/fake.js';
import { FocusController, FocusRejectedError, type FocusLifecycleEvent } from './controller.js';
import { FileJournal, type FocusJournal, type JournalEntry } from './journal.js';

const SESSION_ID = '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f';
const START = new Date('2026-11-10T10:00:00.000Z');
const VSCODE: AppEntry = {
  key: 'vscode',
  label: 'Visual Studio Code',
  mac: ['com.microsoft.VSCode'],
};
const SLACK: AppEntry = { key: 'slack', label: 'Slack', mac: ['com.tinyspeck.slackmacgap'] };
const WINDOWS: readonly FakeWindowSpec[] = [
  { handle: 'w-chrome', appKey: 'chrome', identifier: 'com.google.Chrome' },
  { handle: 'w-vscode', appKey: 'vscode', identifier: 'com.microsoft.VSCode' },
  { handle: 'w-slack', appKey: 'slack', identifier: 'com.tinyspeck.slackmacgap' },
  { handle: 'w-hidden', appKey: 'spotify', identifier: 'com.spotify.client', visible: false },
];
const PROTECTED = resolveProtectedEntries('macOS');

const tempDirs: string[] = [];

function makeDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'focus-controller-'));
  tempDirs.push(directory);
  return directory;
}

interface Harness {
  readonly controller: FocusController;
  readonly driver: FakeDriver;
  readonly journal: FileJournal;
  readonly events: FocusLifecycleEvent[];
}

function makeHarness(options: {
  windows?: readonly FakeWindowSpec[];
  initialPaired?: boolean;
  driver?: FocusDriver;
  journalDirectory?: string;
  now?: () => Date;
}): Harness {
  const journal = new FileJournal({ directory: options.journalDirectory ?? makeDirectory() });
  const driver = (options.driver ?? new FakeDriver(options.windows ?? WINDOWS)) as FakeDriver;
  const events: FocusLifecycleEvent[] = [];
  const controller = new FocusController({
    driver,
    journal,
    protectedEntries: PROTECTED,
    os: 'macOS',
    initialPaired: options.initialPaired ?? true,
    now: options.now ?? (() => START),
    onEvent: (event) => events.push(event),
  });
  return { controller, driver, journal, events };
}

function request(overrides: Partial<Parameters<FocusController['enterFocus']>[0]> = {}) {
  return {
    durationMin: 60,
    allowList: [VSCODE],
    clientSessionId: SESSION_ID,
    ...overrides,
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

describe('FocusController.enterFocus', () => {
  it('journals before the driver moves windows, then updates the journal with what changed', async () => {
    const order: string[] = [];
    const directory = makeDirectory();
    const fileJournal = new FileJournal({ directory });
    const journalSnapshots: JournalEntry[] = [];

    const journal: FocusJournal = {
      filePath: fileJournal.filePath,
      read: () => fileJournal.read(),
      write: (entry) => {
        order.push('journal.write');
        fileJournal.write(entry);
      },
      clear: () => {
        order.push('journal.clear');
        fileJournal.clear();
      },
    };

    class ProbeDriver extends FakeDriver {
      override async asideWindows(windows: readonly WindowRef[]): Promise<readonly WindowRef[]> {
        order.push('driver.asideWindows');
        const snapshot = journal.read();
        if (snapshot !== null) journalSnapshots.push(snapshot);
        return super.asideWindows(windows);
      }
    }

    const driver = new ProbeDriver(WINDOWS);
    const controller = new FocusController({
      driver,
      journal,
      protectedEntries: PROTECTED,
      os: 'macOS',
      initialPaired: true,
      now: () => START,
    });

    await controller.enterFocus(request());

    expect(order.slice(0, 3)).toEqual(['journal.write', 'driver.asideWindows', 'journal.write']);
    expect(journalSnapshots).toHaveLength(1);
    expect(journalSnapshots[0]?.intent).toBe('FOCUSING');
    expect(journalSnapshots[0]?.changed).toEqual([]);
    expect(journal.read()?.changed.map((window) => window.handle)).toEqual(['w-slack']);
  });

  it('moves aside only unprotected, non-allow-listed windows and reports FOCUSING', async () => {
    const harness = makeHarness({});
    const snapshot = await harness.controller.enterFocus(request());

    expect(snapshot.state).toBe('FOCUSING');
    expect(snapshot.session).toMatchObject({
      sessionId: SESSION_ID,
      plannedMinutes: 60,
      source: 'MANUAL',
      startedAt: START.toISOString(),
      endsAt: new Date(START.getTime() + 60 * 60_000).toISOString(),
    });
    expect(harness.driver.getCallLog().map((call) => call.method)).toEqual([
      'listWindows',
      'asideWindows',
    ]);
    expect(harness.driver.getCallLog()[1]?.appKeys).toEqual(['slack']);
    expect(harness.driver.isAsided('w-slack')).toBe(true);
    expect(harness.driver.isAsided('w-chrome')).toBe(false);
    expect(harness.driver.isAsided('w-vscode')).toBe(false);
    expect(harness.driver.isAsided('w-hidden')).toBe(false);
    expect(harness.events[0]).toMatchObject({ type: 'focusStarted', sessionId: SESSION_ID });
  });

  it('never asks the driver to aside a protected app, even when it is in the allow-list', async () => {
    const harness = makeHarness({});
    const snapshot = await harness.controller.enterFocus(
      request({
        allowList: [SLACK, { key: 'chrome', label: 'Google Chrome', mac: ['com.google.Chrome'] }],
      }),
    );

    const asideCall = harness.driver.getCallLog().find((call) => call.method === 'asideWindows');
    expect(asideCall?.appKeys).toEqual(['vscode']);
    expect(asideCall?.appKeys).not.toContain('chrome');
    // The protected entry is dropped from the reported allow-list, never moved aside.
    expect(snapshot.allowList.map((entry) => entry.key)).toEqual(['slack']);
  });

  it('never passes any protected window to asideWindows, even with an empty allow-list', async () => {
    const protectedWindows: FakeWindowSpec[] = PROTECTED.flatMap((entry) => {
      const identifier = entry.mac?.[0];
      return identifier === undefined
        ? []
        : [{ handle: `p-${entry.key}`, appKey: entry.key, identifier }];
    });
    const harness = makeHarness({ windows: protectedWindows });

    await harness.controller.enterFocus(request({ allowList: [] }));

    const asideCall = harness.driver.getCallLog().find((call) => call.method === 'asideWindows');
    expect(asideCall?.appKeys).toEqual([]);
    expect(harness.driver.asidedHandles()).toEqual([]);
    expect(harness.journal.read()?.candidates).toEqual([]);
  });

  it('rejects a second session with ALREADY_FOCUSING (FR-024)', async () => {
    const harness = makeHarness({});
    await harness.controller.enterFocus(request());

    await expect(
      harness.controller.enterFocus(request({ clientSessionId: crypto.randomUUID() })),
    ).rejects.toMatchObject({ code: 'ALREADY_FOCUSING' });
    expect(harness.controller.getState().state).toBe('FOCUSING');
  });

  it('rejects focus when the agent is not paired', async () => {
    const harness = makeHarness({ initialPaired: false });
    await expect(harness.controller.enterFocus(request())).rejects.toMatchObject({
      code: 'NOT_PAIRED',
    });
    expect(harness.controller.getState().state).toBe('IDLE');
  });

  it('rejects unsupported platforms without journalling', async () => {
    const driver = new FakeDriver(WINDOWS, {
      focus: 'unsupported',
      reasons: ['Wayland is not supported'],
    });
    const harness = makeHarness({ driver });
    await expect(harness.controller.enterFocus(request())).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
    expect(harness.journal.read()).toBeNull();
    expect(driver.getCallLog()).toHaveLength(0);
  });

  it('validates the request schema and rejects invalid durations', async () => {
    const harness = makeHarness({});
    await expect(harness.controller.enterFocus(request({ durationMin: 0 }))).rejects.toBeInstanceOf(
      FocusRejectedError,
    );
    await expect(
      harness.controller.enterFocus(request({ durationMin: 999 })),
    ).rejects.toMatchObject({ code: 'INVALID' });
    expect(harness.journal.read()).toBeNull();
  });

  it('restores and clears the journal when the driver fails while applying focus', async () => {
    class FailingDriver extends FakeDriver {
      override async asideWindows(): Promise<readonly WindowRef[]> {
        throw new Error('Window server refused the operation');
      }
    }
    const harness = makeHarness({ driver: new FailingDriver(WINDOWS) });
    await expect(harness.controller.enterFocus(request())).rejects.toThrow(
      'Window server refused the operation',
    );
    expect(harness.controller.getState().state).toBe('PAIRED');
    expect(harness.journal.read()).toBeNull();
  });

  it('keeps the journal when a failed apply cannot be restored (next start retries)', async () => {
    class BrokenDriver extends FakeDriver {
      override async asideWindows(): Promise<readonly WindowRef[]> {
        throw new Error('aside failed');
      }
      override async restore(): Promise<readonly WindowRef[]> {
        throw new Error('restore failed');
      }
    }
    const harness = makeHarness({ driver: new BrokenDriver(WINDOWS) });
    await expect(harness.controller.enterFocus(request())).rejects.toThrow('aside failed');
    expect(harness.journal.read()?.sessionId).toBe(SESSION_ID);
  });
});

describe('FocusController.exitFocus', () => {
  it('restores exactly what the journal recorded, clears it, and is idempotent', async () => {
    const harness = makeHarness({});
    await harness.controller.enterFocus(request());

    const first = await harness.controller.exitFocus('USER');
    expect(first).toMatchObject({ sessionId: SESSION_ID, reason: 'USER', actualMinutes: 0 });
    expect(harness.controller.getState().state).toBe('PAIRED');
    expect(harness.driver.asidedHandles()).toEqual([]);
    expect(harness.journal.read()).toBeNull();
    expect(harness.events.at(-1)).toMatchObject({ type: 'focusEnded', reason: 'USER' });

    const second = await harness.controller.exitFocus('USER');
    expect(second).toBeNull();
    const restoreCalls = harness.driver.getCallLog().filter((call) => call.method === 'restore');
    expect(restoreCalls).toHaveLength(1);
  });

  it('joins concurrent exits instead of restoring twice', async () => {
    const harness = makeHarness({});
    await harness.controller.enterFocus(request());

    const [a, b] = await Promise.all([
      harness.controller.exitFocus('USER'),
      harness.controller.exitFocus('AGENT'),
    ]);
    expect(a?.sessionId).toBe(SESSION_ID);
    expect(b).toBe(a);
    expect(harness.driver.getCallLog().filter((call) => call.method === 'restore')).toHaveLength(1);
  });

  it('keeps FOCUSING and the journal when restore fails', async () => {
    class RestoreFailsDriver extends FakeDriver {
      failures = 1;
      override async restore(plan: RestorePlan): Promise<readonly WindowRef[]> {
        if (this.failures > 0) {
          this.failures -= 1;
          throw new Error('restore failed');
        }
        return super.restore(plan);
      }
    }
    const harness = makeHarness({ driver: new RestoreFailsDriver(WINDOWS) });
    await harness.controller.enterFocus(request());

    await expect(harness.controller.exitFocus('USER')).rejects.toThrow('restore failed');
    expect(harness.controller.getState().state).toBe('FOCUSING');
    expect(harness.journal.read()?.sessionId).toBe(SESSION_ID);

    const retry = await harness.controller.exitFocus('USER');
    expect(retry?.sessionId).toBe(SESSION_ID);
    expect(harness.controller.getState().state).toBe('PAIRED');
    expect(harness.journal.read()).toBeNull();
  });

  it('reports QUIT for a quit-driven restore', async () => {
    const harness = makeHarness({});
    await harness.controller.enterFocus(request());
    const ended = await harness.controller.exitFocus('QUIT');
    expect(ended?.reason).toBe('QUIT');
    expect(harness.driver.asidedHandles()).toEqual([]);
  });
});

describe('FocusController timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  it('uses an absolute endsAt deadline, not a drifting countdown', async () => {
    const harness = makeHarness({ now: () => new Date(Date.now()) });
    const snapshot = await harness.controller.enterFocus(request({ durationMin: 25 }));
    expect(snapshot.session?.endsAt).toBe(new Date(START.getTime() + 25 * 60_000).toISOString());

    await vi.advanceTimersByTimeAsync(24 * 60_000);
    await flushMicrotasks();
    expect(harness.controller.isFocusing()).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    await flushMicrotasks();
    expect(harness.controller.isFocusing()).toBe(false);
    expect(harness.controller.getState().state).toBe('PAIRED');
    expect(harness.events.at(-1)).toMatchObject({
      type: 'focusEnded',
      reason: 'COMPLETED',
      actualMinutes: 25,
    });
    expect(harness.driver.asidedHandles()).toEqual([]);
    expect(harness.journal.read()).toBeNull();
  });

  it('does not fire a second exit after a manual end', async () => {
    const harness = makeHarness({ now: () => new Date(Date.now()) });
    await harness.controller.enterFocus(request({ durationMin: 10 }));
    await harness.controller.exitFocus('USER');
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    await flushMicrotasks();
    expect(harness.driver.getCallLog().filter((call) => call.method === 'restore')).toHaveLength(1);
    expect(harness.events.filter((event) => event.type === 'focusEnded')).toHaveLength(1);
  });
});

describe('FocusController.recoverFromJournal', () => {
  it('restores a journaled session before reporting state (FR-023, CRASH_RECOVERY)', async () => {
    const directory = makeDirectory();
    const journal = new FileJournal({ directory });
    journal.write({
      version: 1,
      kind: 'FOCUS_SESSION',
      sessionId: SESSION_ID,
      startedAt: new Date(START.getTime() - 30 * 60_000).toISOString(),
      endsAt: new Date(START.getTime() + 30 * 60_000).toISOString(),
      plannedMinutes: 60,
      source: 'MANUAL',
      intent: 'FOCUSING',
      protected: PROTECTED.map((entry) => ({ ...entry })),
      allowList: [SLACK],
      candidates: [{ handle: 'w-slack', appKey: 'slack' }],
      changed: [{ handle: 'w-slack', appKey: 'slack' }],
    });

    const driver = new FakeDriver(WINDOWS);
    await driver.asideWindows([{ handle: 'w-slack', appKey: 'slack' }]);
    driver.resetCallLog();

    const events: FocusLifecycleEvent[] = [];
    const controller = new FocusController({
      driver,
      journal,
      protectedEntries: PROTECTED,
      os: 'macOS',
      now: () => START,
      onEvent: (event) => events.push(event),
    });

    const recovery = await controller.recoverFromJournal();
    expect(recovery).toMatchObject({
      sessionId: SESSION_ID,
      restored: true,
      actualMinutes: 30,
    });
    expect(driver.asidedHandles()).toEqual([]);
    expect(journal.read()).toBeNull();
    expect(events).toEqual([
      {
        type: 'focusEnded',
        sessionId: SESSION_ID,
        at: START.toISOString(),
        reason: 'CRASH_RECOVERY',
        actualMinutes: 30,
      },
    ]);
    expect(controller.getState().state).toBe('IDLE');
    expect(await controller.recoverFromJournal()).toBeNull();
  });

  it('returns null when there is nothing to recover', async () => {
    const harness = makeHarness({});
    expect(await harness.controller.recoverFromJournal()).toBeNull();
  });

  it('keeps the journal when recovery restore fails', async () => {
    const directory = makeDirectory();
    const journal = new FileJournal({ directory });
    journal.write({
      version: 1,
      kind: 'FOCUS_SESSION',
      sessionId: SESSION_ID,
      startedAt: START.toISOString(),
      endsAt: new Date(START.getTime() + 60 * 60_000).toISOString(),
      plannedMinutes: 60,
      source: 'MANUAL',
      intent: 'FOCUSING',
      protected: [],
      allowList: [],
      candidates: [{ handle: 'w-slack', appKey: 'slack' }],
      changed: [{ handle: 'w-slack', appKey: 'slack' }],
    });

    class BrokenDriver extends FakeDriver {
      override async restore(): Promise<readonly WindowRef[]> {
        throw new Error('no window server');
      }
    }
    const controller = new FocusController({
      driver: new BrokenDriver(WINDOWS),
      journal,
      protectedEntries: PROTECTED,
      os: 'macOS',
      now: () => START,
    });

    expect(await controller.recoverFromJournal()).toMatchObject({ restored: false });
    expect(journal.read()?.sessionId).toBe(SESSION_ID);
  });
});
