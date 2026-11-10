// focus/controller.sleep.test.ts — TD §7.4 sleep/resume reconcile (FR-014) and the chunked
// absolute timer (FR-007). Matrix:
//   resume before endsAt                  → stay FOCUSING, re-aside, keep remaining time
//   resume after endsAt, slept past it    → SLEEP + CANCELLED, actualMinutes = suspendAt − start
//   resume after endsAt but awake at/after→ SLEEP + COMPLETED, same actualMinutes rule
// plus timer chunking below Node's 2^31−1 ms ceiling and the reaside=false optimisation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { START, cleanupHarnessDirs, makeHarness, request } from './controller.harness.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
  cleanupHarnessDirs();
});

describe('sleep / resume reconcile', () => {
  it('keeps focusing when time is left, re-arms the absolute timer and re-asides new apps', async () => {
    const harness = makeHarness({
      now: () => new Date(Date.now()),
      enforcement: { intervalMs: 2_000 },
    });
    await harness.controller.enterFocus(request({ durationMin: 25 }));
    expect(harness.driver.isAsided('w-slack')).toBe(true);

    const suspendAt = new Date(START.getTime() + 10 * 60_000);
    vi.setSystemTime(suspendAt);
    harness.controller.recordSuspend();
    harness.driver.addWindow({ handle: 'w-zoom', appKey: 'zoom', identifier: 'us.zoom.xos' });
    vi.setSystemTime(new Date(START.getTime() + 11 * 60_000));

    const ended = await harness.controller.resumeFromSleep();
    expect(ended).toBeNull();
    expect(harness.controller.getState().state).toBe('FOCUSING');
    // Re-applied aside immediately on resume (REC-005), still never the protected set.
    expect(harness.driver.isAsided('w-zoom')).toBe(true);
    expect(harness.driver.isAsided('w-chrome')).toBe(false);
    expect(harness.journal.read()?.changed.map((window) => window.handle)).toEqual([
      'w-slack',
      'w-zoom',
    ]);

    // The absolute deadline was not extended by the suspend/resume.
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(harness.controller.getState().state).toBe('PAIRED');
    expect(harness.events.at(-1)).toMatchObject({
      type: 'focusEnded',
      reason: 'COMPLETED',
      actualMinutes: 25,
      status: 'COMPLETED',
    });
    expect(harness.driver.asidedHandles()).toEqual([]);
    expect(harness.journal.read()).toBeNull();
  });

  it('ends with SLEEP + CANCELLED when the machine slept through the deadline', async () => {
    const harness = makeHarness({ now: () => new Date(Date.now()) });
    await harness.controller.enterFocus(request({ durationMin: 25 }));

    vi.setSystemTime(new Date(START.getTime() + 10 * 60_000));
    harness.controller.recordSuspend();
    vi.setSystemTime(new Date(START.getTime() + 26 * 60_000));

    const ended = await harness.controller.resumeFromSleep();
    expect(ended).toMatchObject({
      reason: 'SLEEP',
      status: 'CANCELLED',
      // actualMinutes = (suspendAt − startedAt) — not the wall clock after the wake.
      actualMinutes: 10,
    });
    expect(harness.controller.getState().state).toBe('PAIRED');
    expect(harness.driver.asidedHandles()).toEqual([]);
    expect(harness.journal.read()).toBeNull();
    expect(harness.events.at(-1)).toMatchObject({ type: 'focusEnded', reason: 'SLEEP' });
  });

  it('ends with SLEEP + COMPLETED when the machine was awake at/after the deadline', async () => {
    const harness = makeHarness({ now: () => new Date(Date.now()) });
    await harness.controller.enterFocus(request({ durationMin: 25 }));

    vi.setSystemTime(new Date(START.getTime() + 30 * 60_000));
    harness.controller.recordSuspend();
    vi.setSystemTime(new Date(START.getTime() + 35 * 60_000));

    const ended = await harness.controller.resumeFromSleep();
    expect(ended).toMatchObject({
      reason: 'SLEEP',
      status: 'COMPLETED',
      actualMinutes: 30,
    });
  });

  it('is a no-op when nothing is focusing', async () => {
    const harness = makeHarness({ now: () => new Date(Date.now()) });
    harness.controller.recordSuspend();
    await expect(harness.controller.resumeFromSleep()).resolves.toBeNull();
    expect(harness.driver.getCallLog()).toEqual([]);
  });

  it('does not re-aside on resume when the session disabled re-asiding (zero extra calls)', async () => {
    const harness = makeHarness({ now: () => new Date(Date.now()) });
    await harness.controller.enterFocus(request({ durationMin: 25, reaside: false }));
    const callsBefore = harness.driver.getCallLog().length;

    harness.driver.addWindow({ handle: 'w-zoom', appKey: 'zoom', identifier: 'us.zoom.xos' });
    vi.setSystemTime(new Date(START.getTime() + 5 * 60_000));
    harness.controller.recordSuspend();
    vi.setSystemTime(new Date(START.getTime() + 6 * 60_000));
    await harness.controller.resumeFromSleep();
    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(harness.driver.isAsided('w-zoom')).toBe(false);
    expect(harness.driver.getCallLog()).toHaveLength(callsBefore);
  });
});

describe('absolute timer chunking', () => {
  it('re-arms instead of relying on one >24-day timer, and ends exactly at endsAt', async () => {
    const harness = makeHarness({
      now: () => new Date(Date.now()),
      maxTimerDelayMs: 60_000,
    });
    await harness.controller.enterFocus(request({ durationMin: 2 }));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.controller.isFocusing()).toBe(true);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.controller.getState().state).toBe('PAIRED');
    expect(harness.events.at(-1)).toMatchObject({
      type: 'focusEnded',
      reason: 'COMPLETED',
      actualMinutes: 2,
      status: 'COMPLETED',
    });
  });
});
