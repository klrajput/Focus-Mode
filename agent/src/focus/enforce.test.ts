// focus/enforce.test.ts — REC-005 enforcement loop (T-055). Proves the four promises that make
// "lockdown" safe: never a protected window (INV-3), never an allow-listed one, journal before
// apply (INV-4), and absolutely no driver call after stop()/exit or when the session disabled it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEntry } from '@focus-mode/shared';
import type { WindowRef } from '../allowlist.js';
import {
  PROTECTED,
  START,
  WINDOWS,
  cleanupHarnessDirs,
  makeHarness,
  makeDirectory,
  request,
} from './controller.harness.js';
import { FakeDriver, type FakeWindowSpec } from './drivers/fake.js';
import {
  EnforcementLoop,
  ENFORCEMENT_DEFAULT_INTERVAL_MS,
  ENFORCEMENT_MAX_INTERVAL_MS,
  ENFORCEMENT_MIN_INTERVAL_MS,
  clampInterval,
  planReaside,
} from './enforce.js';
import { FileJournal, type JournalEntry } from './journal.js';

const CHROME_ENTRY: AppEntry = {
  key: 'chrome',
  label: 'Google Chrome',
  mac: ['com.google.Chrome'],
};

function journalEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    version: 1,
    kind: 'FOCUS_SESSION',
    sessionId: '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f',
    startedAt: START.toISOString(),
    endsAt: new Date(START.getTime() + 25 * 60_000).toISOString(),
    plannedMinutes: 25,
    source: 'MANUAL',
    intent: 'FOCUSING',
    protected: PROTECTED.map((entry) => ({ ...entry })),
    allowList: [{ key: 'vscode', label: 'Visual Studio Code', mac: ['com.microsoft.VSCode'] }],
    candidates: [{ handle: 'w-slack', appKey: 'slack', identifier: 'com.tinyspeck.slackmacgap' }],
    changed: [{ handle: 'w-slack', appKey: 'slack', identifier: 'com.tinyspeck.slackmacgap' }],
    ...overrides,
  };
}

async function loopHarness(
  options: {
    windows?: readonly FakeWindowSpec[];
    journal?: FileJournal;
    allowList?: readonly AppEntry[];
    isActive?: () => boolean;
    driver?: FakeDriver;
    order?: string[];
  } = {},
): Promise<{ loop: EnforcementLoop; driver: FakeDriver; journal: FileJournal; order: string[] }> {
  const driver = options.driver ?? new FakeDriver(options.windows ?? WINDOWS);
  const journal = options.journal ?? new FileJournal({ directory: makeDirectory() });
  if (options.journal === undefined) {
    journal.write(
      journalEntry(options.allowList === undefined ? {} : { allowList: [...options.allowList] }),
    );
  }
  // The journal says these were already moved aside; mirror that in the fake window state.
  // A driver that refuses to move windows (failure-path suites) simply leaves the state alone.
  for (const window of journal.read()?.changed ?? []) {
    try {
      // Base implementation on purpose: a subclass override may be slow/failing, and the
      // fixture still needs the window state to reflect the journal.
      await FakeDriver.prototype.asideWindows.call(driver, [
        {
          handle: window.handle,
          appKey: window.appKey,
          ...(window.identifier === undefined ? {} : { identifier: window.identifier }),
        },
      ]);
    } catch {
      // Expected for the failing-driver cases below.
    }
  }
  driver.resetCallLog();
  const order = options.order ?? [];
  const wrapped: FileJournal = journal;
  const probeJournal = {
    filePath: wrapped.filePath,
    read: () => wrapped.read(),
    write: (entry: JournalEntry) => {
      order.push('journal.write');
      wrapped.write(entry);
    },
    clear: () => wrapped.clear(),
  };
  const loop = new EnforcementLoop({
    driver,
    journal: probeJournal,
    protectedEntries: PROTECTED,
    os: 'macOS',
    isActive: options.isActive ?? (() => true),
    intervalMs: ENFORCEMENT_MIN_INTERVAL_MS,
    setInterval: (callback, delayMs) => setInterval(callback, delayMs),
    clearInterval: (handle) => clearInterval(handle),
  });
  return { loop, driver, journal, order };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
  cleanupHarnessDirs();
});

describe('planReaside (pure INV-3 filter)', () => {
  it('skips protected, allow-listed and already-handled windows and re-asides the rest', () => {
    const windows: readonly WindowRef[] = [
      { handle: 'w-chrome', appKey: 'chrome', identifier: 'com.google.Chrome' },
      { handle: 'w-vscode', appKey: 'vscode', identifier: 'com.microsoft.VSCode' },
      { handle: 'w-slack', appKey: 'slack', identifier: 'com.tinyspeck.slackmacgap' },
      { handle: 'w-zoom', appKey: 'zoom', identifier: 'us.zoom.xos' },
    ];
    const plan = planReaside({
      windows,
      allowList: [{ key: 'vscode', label: 'Visual Studio Code', mac: ['com.microsoft.VSCode'] }],
      protectedEntries: PROTECTED,
      os: 'macOS',
      handledHandles: new Set(['w-zoom']),
    });

    expect(plan.toAside.map((window) => window.handle)).toEqual(['w-slack']);
    expect(plan.protectedCount).toBe(1);
    expect(plan.allowListedCount).toBe(1);
    expect(plan.handledCount).toBe(1);
  });

  it('keeps a protected app untouched even when a hostile allow-list names it', () => {
    const plan = planReaside({
      windows: [{ handle: 'w-chrome', appKey: 'chrome', identifier: 'com.google.Chrome' }],
      allowList: [CHROME_ENTRY],
      protectedEntries: PROTECTED,
      os: 'macOS',
      handledHandles: new Set(),
    });
    expect(plan.toAside).toEqual([]);
    expect(plan.protectedCount).toBe(1);
  });

  it('clamps the poll interval to the REC-005 1–2 s window', () => {
    expect(clampInterval(10)).toBe(ENFORCEMENT_MIN_INTERVAL_MS);
    expect(clampInterval(60_000)).toBe(ENFORCEMENT_MAX_INTERVAL_MS);
    expect(clampInterval(1_500)).toBe(ENFORCEMENT_DEFAULT_INTERVAL_MS);
    expect(clampInterval(Number.NaN)).toBe(ENFORCEMENT_DEFAULT_INTERVAL_MS);
  });
});

describe('EnforcementLoop', () => {
  it('journals the new candidates before moving them and re-asides only the new app', async () => {
    const order: string[] = [];
    const { loop, driver, journal } = await loopHarness({ order });

    loop.start();
    await vi.advanceTimersByTimeAsync(ENFORCEMENT_MIN_INTERVAL_MS);

    expect(driver.isAsided('w-slack')).toBe(true); // from the entry's changed set (already aside)
    expect(driver.isAsided('w-zoom')).toBe(false);
    // WINDOWS has no newly-opened app, so one listWindows call and no aside call happened.
    expect(driver.getCallLog().map((call) => call.method)).toEqual(['listWindows']);
    expect(order).toEqual([]);
    expect(journal.read()?.changed.map((window) => window.handle)).toEqual(['w-slack']);

    driver.addWindow({ handle: 'w-zoom', appKey: 'zoom', identifier: 'us.zoom.xos' });
    await vi.advanceTimersByTimeAsync(ENFORCEMENT_MIN_INTERVAL_MS);

    const methods = driver.getCallLog().map((call) => call.method);
    expect(methods.at(-2)).toBe('listWindows');
    expect(methods.at(-1)).toBe('asideWindows');
    expect(driver.getCallLog().at(-1)?.appKeys).toEqual(['zoom']);
    expect(order).toEqual(['journal.write', 'journal.write']);
    expect(journal.read()?.changed.map((window) => window.handle)).toEqual(['w-slack', 'w-zoom']);
    expect(driver.isAsided('w-chrome')).toBe(false);
    expect(driver.isAsided('w-vscode')).toBe(false);
    expect(driver.asidedHandles()).toEqual(['w-slack', 'w-zoom']);

    await loop.stop();
  });

  it('makes no driver call at all after stop() (exit/quit)', async () => {
    const { loop, driver } = await loopHarness({});
    loop.start();
    await loop.stop();
    driver.resetCallLog();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(driver.getCallLog()).toEqual([]);
    expect(loop.isRunning()).toBe(false);
  });

  it('waits for an in-flight pass before stop() resolves (restore wins the race)', async () => {
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    class SlowDriver extends FakeDriver {
      override async asideWindows(windows: readonly WindowRef[]): Promise<readonly WindowRef[]> {
        entered?.();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return super.asideWindows(windows);
      }
    }
    const driver = new SlowDriver(WINDOWS);
    const { loop } = await loopHarness({ driver });
    driver.addWindow({ handle: 'w-zoom', appKey: 'zoom', identifier: 'us.zoom.xos' });

    loop.start();
    await vi.advanceTimersByTimeAsync(ENFORCEMENT_MIN_INTERVAL_MS);
    await enteredPromise;
    expect(driver.isAsided('w-zoom')).toBe(false);

    let stopped = false;
    const stopping = loop.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    release?.();
    await stopping;
    expect(stopped).toBe(true);
    expect(driver.isAsided('w-zoom')).toBe(true);
  });

  it('never touches windows after the session is no longer active', async () => {
    let active = true;
    const { loop, driver } = await loopHarness({ isActive: () => active });
    loop.start();
    active = false;

    await vi.advanceTimersByTimeAsync(5_000);
    expect(driver.getCallLog()).toEqual([]);
    await loop.stop();
  });

  it('keeps the journaled candidates when the driver refuses to move a window', async () => {
    class FailingDriver extends FakeDriver {
      override async asideWindows(): Promise<readonly WindowRef[]> {
        throw new Error('window server unavailable');
      }
    }
    const driver = new FailingDriver(WINDOWS);
    const { loop, journal } = await loopHarness({ driver });
    driver.addWindow({ handle: 'w-zoom', appKey: 'zoom', identifier: 'us.zoom.xos' });
    loop.start();

    await vi.advanceTimersByTimeAsync(ENFORCEMENT_MIN_INTERVAL_MS);
    expect(journal.read()?.candidates.map((window) => window.handle)).toEqual([
      'w-slack',
      'w-zoom',
    ]);
    expect(journal.read()?.changed.map((window) => window.handle)).toEqual(['w-slack']);
    await loop.stop();
  });

  it('does not move anything when the intent cannot be journaled (INV-4)', async () => {
    const driver = new FakeDriver(WINDOWS);
    driver.addWindow({ handle: 'w-zoom', appKey: 'zoom', identifier: 'us.zoom.xos' });
    const base = new FileJournal({ directory: makeDirectory() });
    base.write(journalEntry());
    const journal = {
      filePath: base.filePath,
      read: () => base.read(),
      write: (): void => {
        throw new Error('disk full');
      },
      clear: () => base.clear(),
    };
    const loop = new EnforcementLoop({
      driver,
      journal,
      protectedEntries: PROTECTED,
      os: 'macOS',
      isActive: () => true,
      intervalMs: ENFORCEMENT_MIN_INTERVAL_MS,
    });
    loop.start();

    await vi.advanceTimersByTimeAsync(ENFORCEMENT_MIN_INTERVAL_MS);
    expect(driver.getCallLog().map((call) => call.method)).toEqual(['listWindows']);
    expect(driver.isAsided('w-zoom')).toBe(false);
    await loop.stop();
  });
});

describe('controller integration (per-session reaside flag)', () => {
  it('re-asides apps opened during focus and restores them too on exit', async () => {
    const harness = makeHarness({ enforcement: { intervalMs: ENFORCEMENT_MIN_INTERVAL_MS } });
    await harness.controller.enterFocus(request({ durationMin: 25 }));
    harness.driver.addWindow({ handle: 'w-zoom', appKey: 'zoom', identifier: 'us.zoom.xos' });

    await vi.advanceTimersByTimeAsync(ENFORCEMENT_MIN_INTERVAL_MS);
    expect(harness.driver.isAsided('w-zoom')).toBe(true);
    expect(harness.controller.isFocusing()).toBe(true);

    await harness.controller.exitFocus('USER');
    expect(harness.driver.asidedHandles()).toEqual([]);
    expect(harness.journal.read()).toBeNull();
  });

  it('does not poll the driver when the consent modal turned re-aside off', async () => {
    const harness = makeHarness({ enforcement: { intervalMs: ENFORCEMENT_MIN_INTERVAL_MS } });
    await harness.controller.enterFocus(request({ durationMin: 25, reaside: false }));
    const callsAfterEnter = harness.driver.getCallLog().length;
    harness.driver.addWindow({ handle: 'w-zoom', appKey: 'zoom', identifier: 'us.zoom.xos' });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.driver.getCallLog()).toHaveLength(callsAfterEnter);
    expect(harness.driver.isAsided('w-zoom')).toBe(false);
  });

  it('stops polling immediately after the session ends', async () => {
    const harness = makeHarness({ enforcement: { intervalMs: ENFORCEMENT_MIN_INTERVAL_MS } });
    await harness.controller.enterFocus(request({ durationMin: 25 }));
    await harness.controller.exitFocus('USER');
    const callsAfterExit = harness.driver.getCallLog().length;

    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.driver.getCallLog()).toHaveLength(callsAfterExit);
  });
});
