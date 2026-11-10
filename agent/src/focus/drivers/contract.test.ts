// focus/drivers/contract.test.ts — the shared `FocusDriver` contract (FR-011, X-PLAT-1).
// The same assertions run against the in-memory FakeDriver on every OS. The current platform's
// real driver is only checked for `capabilities()` here: the contract suite is not allowed to
// hide the developer's windows (the destructive macOS hide/unhide run belongs to A0/T-101), and
// Windows/Linux have no desktop in this session (spike S-1/S-2 notes).
//
// Contract summary: a driver has a stable name, reports schema-valid capabilities, lists unique
// `WindowRef`s with no extra fields (INV-6: no titles/URLs), accepts an empty aside/restore
// without side effects, and an aside→restore round-trip never claims more than it was given.

import { describe, expect, it } from 'vitest';
import { agentCapabilitiesSchema, type AgentCapabilities } from '@focus-mode/shared';
import { noopLogger } from '../../log.js';
import type { WindowRef } from '../../allowlist.js';
import type { FocusDriver, RestorePlan } from '../driver.js';
import { FakeDriver } from './fake.js';
import { createFocusDriver } from './index.js';

const SESSION_ID = '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f';
const APP_KEY = /^[a-z0-9-]{2,40}$/;
const REF_FIELDS = new Set(['handle', 'appKey', 'identifier']);

function expectValidCapabilities(capabilities: AgentCapabilities): void {
  const parsed = agentCapabilitiesSchema.safeParse(capabilities);
  expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  expect((capabilities.reasons ?? []).length).toBeLessThanOrEqual(10);
}

function expectValidRef(ref: WindowRef): void {
  expect(Object.keys(ref).every((key) => REF_FIELDS.has(key))).toBe(true);
  expect(ref.handle.trim().length).toBeGreaterThan(0);
  expect(ref.appKey).toMatch(APP_KEY);
  if (ref.identifier !== undefined) expect(ref.identifier.trim().length).toBeGreaterThan(0);
}

/** The platform-independent half of the `FocusDriver` contract (asserted on FakeDriver). */
async function expectDriverContract(driver: FocusDriver): Promise<void> {
  expect(typeof driver.name).toBe('string');
  expect(driver.name.length).toBeGreaterThan(0);
  expectValidCapabilities(driver.capabilities());

  const listed = await driver.listWindows();
  expect(Array.isArray(listed)).toBe(true);
  const handles = new Set<string>();
  for (const ref of listed) {
    expectValidRef(ref);
    expect(handles.has(ref.handle), `duplicate handle ${ref.handle}`).toBe(false);
    handles.add(ref.handle);
  }

  const emptyPlan: RestorePlan = { sessionId: SESSION_ID, windows: [] };
  await expect(driver.asideWindows([])).resolves.toEqual([]);
  await expect(driver.restore(emptyPlan)).resolves.toEqual([]);

  const target = listed[0];
  if (target === undefined) return;
  const changed = await driver.asideWindows([target]);
  for (const ref of changed) expect(ref.handle).toBe(target.handle);

  const restored = await driver.restore({ sessionId: SESSION_ID, windows: changed });
  const changedHandles = new Set(changed.map((ref) => ref.handle));
  for (const ref of restored) expect(changedHandles.has(ref.handle)).toBe(true);

  // A second restore of the same plan must not claim the windows again (INV-5 idempotency).
  await expect(driver.restore({ sessionId: SESSION_ID, windows: changed })).resolves.toEqual([]);
}

function fakeDriverWithWindows(): FakeDriver {
  return new FakeDriver([
    { handle: 'w-code', appKey: 'code', identifier: 'Code.exe' },
    { handle: 'w-slack', appKey: 'slack', identifier: 'Slack.exe' },
    { handle: 'w-spotify', appKey: 'spotify', identifier: 'Spotify.exe', visible: false },
  ]);
}

describe('FocusDriver contract — FakeDriver (runs on every OS)', () => {
  it('satisfies the contract with visible windows', async () => {
    await expectDriverContract(fakeDriverWithWindows());
  });

  it('satisfies the contract with no windows at all', async () => {
    await expectDriverContract(new FakeDriver());
  });

  it('never lists a window the user has hidden', async () => {
    const listed = await fakeDriverWithWindows().listWindows();
    expect(listed.map((ref) => ref.handle)).toEqual(['w-code', 'w-slack']);
  });

  it('reports unsupported capabilities without pretending to work', async () => {
    const driver = new FakeDriver([], {
      focus: 'unsupported',
      reasons: ['Simulated unsupported platform'],
    });
    expectValidCapabilities(driver.capabilities());
    expect(driver.capabilities().focus).toBe('unsupported');
  });
});

describe('FocusDriver contract — current platform real driver (capabilities only)', () => {
  const driver = createFocusDriver({
    configured: 'real',
    isPackaged: true,
    logger: noopLogger,
    platform: process.platform,
  });

  it('selects the platform driver and exposes a stable name', () => {
    const expected =
      process.platform === 'darwin'
        ? 'darwin'
        : process.platform === 'win32'
          ? 'win32'
          : process.platform === 'linux'
            ? 'linux-x11'
            : 'unavailable';
    expect(driver.name).toBe(expected);
  });

  it('reports schema-valid capabilities for hello', () => {
    const capabilities = driver.capabilities();
    expectValidCapabilities(capabilities);
    if (process.platform === 'darwin' || process.platform === 'win32') {
      expect(capabilities.focus).toBe('full');
    }
    if (process.platform === 'linux' && capabilities.focus === 'unsupported') {
      // Honest degradation when wmctrl/xdotool/Wayland: a reason is mandatory (FR-005).
      expect((capabilities.reasons ?? []).length).toBeGreaterThan(0);
    }
  });

  it('never reports a reason longer than the wire limit', () => {
    for (const reason of driver.capabilities().reasons ?? []) {
      expect(reason.length).toBeLessThanOrEqual(200);
      expect(reason.trim().length).toBeGreaterThan(0);
    }
  });
});
