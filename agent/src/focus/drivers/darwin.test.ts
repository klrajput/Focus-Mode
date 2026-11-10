// focus/drivers/darwin.test.ts — pure + scripted tests for the macOS JXA driver (T-053).
// No test touches a real app: a scripted `osascript` invoker answers the driver's one-shot JXA
// calls, so we can prove the DEC-005 rules — one invocation per operation, verification in a
// separate invocation with bounded retries, bundle ids only, and no hide/unhide of an app the
// user already hid. The live read-only probe (`probe-darwin.ts`) is run manually instead.

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appEntrySchema, type AppEntry } from '@focus-mode/shared';
import {
  computeFocusCandidates,
  resolveProtectedEntries,
  type WindowRef,
} from '../../allowlist.js';
import { noopLogger } from '../../log.js';
import {
  bundleIdsFromWindows,
  DarwinDriver,
  DarwinDriverError,
  runningAppsToWindowRefs,
  type DarwinDriverOptions,
  type RawRunningApp,
} from './darwin.js';
import { appKeyFromBundleId } from './app-key.js';

const SESSION_ID = '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f';
const CODE = 'com.microsoft.VSCode';
const SLACK = 'com.tinyspeck.slackmacgap';
const SAFARI = 'com.apple.Safari';
const CHROME = 'com.google.Chrome';
const FINDER = 'com.apple.finder';
const AGENT = 'com.focusmode.agent';
const DEFAULT_BROWSER = 'com.example.ExampleBrowser';

interface ScriptCall {
  readonly script: string;
  readonly args: readonly string[];
}

type ScriptHandler = (args: readonly string[], callIndex: number) => unknown;

/** A deterministic stand-in for the osascript binary, keyed by script basename. */
class ScriptedOsascript {
  readonly calls: ScriptCall[] = [];
  readonly #handlers = new Map<string, ScriptHandler>();

  on(script: string, handler: ScriptHandler): this {
    this.#handlers.set(script, handler);
    return this;
  }

  invoke = async (scriptPath: string, args: readonly string[]): Promise<string> => {
    const script = path.basename(scriptPath, '.js');
    const callIndex = this.calls.filter((call) => call.script === script).length;
    this.calls.push({ script, args: [...args] });
    const handler = this.#handlers.get(script);
    if (handler === undefined) throw new Error(`unexpected osascript ${script}`);
    return JSON.stringify(handler(args, callIndex));
  };

  scripts(): readonly string[] {
    return this.calls.map((call) => call.script);
  }

  callsFor(script: string): readonly ScriptCall[] {
    return this.calls.filter((call) => call.script === script);
  }
}

function refFor(bundleId: string): WindowRef {
  const appKey = appKeyFromBundleId(bundleId);
  if (appKey === undefined) throw new Error(`invalid test bundle id ${bundleId}`);
  return { handle: bundleId, appKey, identifier: bundleId };
}

interface Harness {
  readonly os: ScriptedOsascript;
  readonly driver: DarwinDriver;
  readonly sleeps: number[];
}

function makeHarness(overrides: Partial<DarwinDriverOptions> = {}): Harness {
  const os = new ScriptedOsascript();
  const sleeps: number[] = [];
  const driver = new DarwinDriver({
    platform: 'darwin',
    invoker: os.invoke,
    logger: noopLogger,
    verifyAttempts: 3,
    verifyDelayMs: 10,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
    },
    ...overrides,
  });
  return { os, driver, sleeps };
}

const VISIBLE_APPS: readonly RawRunningApp[] = [
  { bundleId: CHROME, name: 'Google Chrome', hidden: false },
  { bundleId: CODE, name: 'Code', hidden: false },
  { bundleId: SAFARI, name: 'Safari', hidden: true },
  { bundleId: SLACK, name: 'Slack', hidden: false },
  { bundleId: SLACK, name: 'Slack', hidden: false },
];

describe('macOS enumeration — WindowRef mapping (INV-6)', () => {
  it('lists visible, regular apps only and keeps bundle ids as handles', () => {
    const refs = runningAppsToWindowRefs(VISIBLE_APPS);
    expect(refs.map((ref) => ref.handle)).toEqual([CHROME, CODE, SLACK]);
    expect(refs.every((ref) => ref.handle === ref.identifier)).toBe(true);
    expect(refs.map((ref) => ref.appKey)).toEqual(['chrome', 'vscode', 'slackmacgap']);
  });

  it('never copies localizedName (or any title) into a ref', () => {
    const serialized = JSON.stringify(runningAppsToWindowRefs(VISIBLE_APPS));
    expect(serialized).not.toContain('"Google Chrome"');
    expect(serialized).not.toContain('"Code"');
    for (const ref of runningAppsToWindowRefs(VISIBLE_APPS)) {
      expect(Object.keys(ref).sort()).toEqual(['appKey', 'handle', 'identifier']);
    }
  });

  it('drops JXA nil-ish bundle ids instead of inventing a key', () => {
    const refs = runningAppsToWindowRefs([
      { bundleId: 'undefined', name: 'nil', hidden: false },
      { bundleId: '', name: 'nil', hidden: false },
      { bundleId: 'no-dot', name: 'nil', hidden: false },
    ]);
    expect(refs).toEqual([]);
  });

  it('maps bundle ids to valid app keys', () => {
    expect(appKeyFromBundleId(CHROME)).toBe('chrome');
    expect(appKeyFromBundleId(CODE)).toBe('vscode');
    expect(appKeyFromBundleId(FINDER)).toBe('finder');
    expect(appKeyFromBundleId('')).toBeUndefined();
  });

  it('passes only plausible bundle ids to osascript', () => {
    expect(
      bundleIdsFromWindows([
        refFor(CODE),
        refFor(CODE),
        { handle: 'w-1', appKey: 'code' },
        { handle: 'com.foo.Bar', appKey: 'bar', identifier: 'com.foo.Bar' },
      ]),
    ).toEqual([CODE, 'com.foo.Bar']);
  });
});

describe('macOS candidate filtering — protected apps are never candidates (INV-3)', () => {
  const runtimeBrowser: AppEntry = {
    key: 'default-browser',
    label: 'Default browser',
    mac: [DEFAULT_BROWSER],
  };
  const protectedEntries = resolveProtectedEntries('macOS', [runtimeBrowser]);

  it('excludes every protected app, including the runtime default browser', () => {
    const windows = runningAppsToWindowRefs([
      { bundleId: CHROME, name: 'Google Chrome', hidden: false },
      { bundleId: FINDER, name: 'Finder', hidden: false },
      { bundleId: AGENT, name: 'Focus Agent', hidden: false },
      { bundleId: DEFAULT_BROWSER, name: 'Example Browser', hidden: false },
      { bundleId: CODE, name: 'Code', hidden: false },
      { bundleId: SLACK, name: 'Slack', hidden: false },
    ]);
    const { candidates, skippedProtected } = computeFocusCandidates(
      windows,
      [],
      protectedEntries,
      'macOS',
    );
    expect(candidates.map((ref) => ref.handle).sort()).toEqual([CODE, SLACK].sort());
    expect(skippedProtected.map((entry) => entry.matchedEntry.key).sort()).toEqual(
      ['chrome', 'default-browser', 'finder', 'focus-agent'].sort(),
    );
  });

  it('does not treat a hidden app as a candidate', () => {
    const refs = runningAppsToWindowRefs(VISIBLE_APPS);
    expect(refs.some((ref) => ref.handle === SAFARI)).toBe(false);
  });
});

describe('macOS aside — one invocation per operation, verification separate (DEC-005)', () => {
  it('hides only the requested apps and verifies in a follow-up invocation', async () => {
    const hidden = new Set<string>();
    const { os, driver } = makeHarness();
    os.on('state', () =>
      [CODE, SLACK, SAFARI].map((bundleId) => ({
        bundleId,
        hidden: hidden.has(bundleId),
      })),
    );
    os.on('hide', (args) => {
      for (const bundleId of args) hidden.add(bundleId);
      return { matched: args.length };
    });

    const changed = await driver.asideWindows([refFor(CODE), refFor(SLACK)]);

    expect(changed.map((ref) => ref.handle)).toEqual([CODE, SLACK]);
    expect(os.scripts()).toEqual(['state', 'hide', 'state']);
    expect(os.callsFor('hide')[0]?.args).toEqual([CODE, SLACK]);
    expect(hidden.has(SAFARI)).toBe(false);
  });

  it('never hides an app the user already hid', async () => {
    const hidden = new Set<string>([SAFARI]);
    const { os, driver } = makeHarness();
    os.on('state', () => [{ bundleId: SAFARI, hidden: hidden.has(SAFARI) }]);
    os.on('hide', () => {
      throw new Error('hide must not be called');
    });

    await expect(driver.asideWindows([refFor(SAFARI)])).resolves.toEqual([]);
    expect(os.scripts()).toEqual(['state']);
  });

  it('ignores apps that are no longer running', async () => {
    const { os, driver } = makeHarness();
    os.on('state', () => []);
    os.on('hide', () => {
      throw new Error('hide must not be called');
    });
    await expect(driver.asideWindows([refFor(CODE)])).resolves.toEqual([]);
    expect(os.scripts()).toEqual(['state']);
  });

  it('retries verification a bounded number of times before reporting success', async () => {
    const hidden = new Set<string>();
    const { os, driver, sleeps } = makeHarness();
    os.on('state', (_args, callIndex) => [
      // Pre-check (index 0) sees it visible; the first verification sees stale state (DEC-005).
      { bundleId: CODE, hidden: callIndex >= 2 ? hidden.has(CODE) : false },
    ]);
    os.on('hide', (args) => {
      for (const bundleId of args) hidden.add(bundleId);
      return { matched: args.length };
    });

    const changed = await driver.asideWindows([refFor(CODE)]);

    expect(changed.map((ref) => ref.handle)).toEqual([CODE]);
    expect(os.scripts()).toEqual(['state', 'hide', 'state', 'state']);
    expect(sleeps).toEqual([10]);
  });

  it('does not claim a window it could not verify', async () => {
    // hide returns success but the app is still visible: the BOOL is untrustworthy (spike S-2).
    const { os, driver, sleeps } = makeHarness();
    os.on('state', () => [{ bundleId: CODE, hidden: false }]);
    os.on('hide', () => ({ matched: 1 }));

    await expect(driver.asideWindows([refFor(CODE)])).resolves.toEqual([]);
    expect(os.scripts()).toEqual(['state', 'hide', 'state', 'state', 'state']);
    expect(sleeps).toEqual([10, 10]);
  });

  it('surfaces a failed hide invocation instead of silently continuing', async () => {
    const { os, driver } = makeHarness();
    os.on('state', () => [{ bundleId: CODE, hidden: false }]);
    os.on('hide', () => {
      throw new Error('boom');
    });
    await expect(driver.asideWindows([refFor(CODE)])).rejects.toBeInstanceOf(DarwinDriverError);
  });

  it('short-circuits an empty list without spawning anything', async () => {
    const { os, driver } = makeHarness();
    await expect(driver.asideWindows([])).resolves.toEqual([]);
    expect(os.calls).toEqual([]);
  });

  it('rejects an unreadable JXA result without echoing it', async () => {
    const { os, driver } = makeHarness();
    os.on('enumerate', () => 'not-an-array');
    await expect(driver.listWindows()).rejects.toThrow(/unreadable result/);
  });
});

describe('macOS restore — only journaled, still-hidden apps (INV-5)', () => {
  it('unhides only the apps that are still hidden', async () => {
    const hidden = new Set<string>([CODE]);
    const { os, driver } = makeHarness();
    os.on('state', () =>
      [CODE, SLACK].map((bundleId) => ({ bundleId, hidden: hidden.has(bundleId) })),
    );
    os.on('unhide', (args) => {
      for (const bundleId of args) hidden.delete(bundleId);
      return { matched: args.length };
    });

    const restored = await driver.restore({
      sessionId: SESSION_ID,
      windows: [refFor(CODE), refFor(SLACK)],
    });

    expect(restored.map((ref) => ref.handle)).toEqual([CODE]);
    expect(os.scripts()).toEqual(['state', 'unhide', 'state']);
    expect(os.callsFor('unhide')[0]?.args).toEqual([CODE]);
    expect(hidden.size).toBe(0);
  });

  it('does nothing when the journaled app already quit', async () => {
    const { os, driver } = makeHarness();
    os.on('state', () => []);
    os.on('unhide', () => {
      throw new Error('unhide must not be called');
    });
    await expect(
      driver.restore({ sessionId: SESSION_ID, windows: [refFor(CODE)] }),
    ).resolves.toEqual([]);
    expect(os.scripts()).toEqual(['state']);
  });

  it('does nothing when the journaled app is already visible', async () => {
    const { os, driver } = makeHarness();
    os.on('state', () => [{ bundleId: CODE, hidden: false }]);
    os.on('unhide', () => {
      throw new Error('unhide must not be called');
    });
    await expect(
      driver.restore({ sessionId: SESSION_ID, windows: [refFor(CODE)] }),
    ).resolves.toEqual([]);
    expect(os.scripts()).toEqual(['state']);
  });

  it('reports nothing when unhide cannot be verified', async () => {
    const { os, driver } = makeHarness();
    os.on('state', () => [{ bundleId: CODE, hidden: true }]);
    os.on('unhide', () => ({ matched: 1 }));
    await expect(
      driver.restore({ sessionId: SESSION_ID, windows: [refFor(CODE)] }),
    ).resolves.toEqual([]);
    expect(os.callsFor('unhide')).toHaveLength(1);
  });

  it('returns [] for an empty plan without spawning anything', async () => {
    const { os, driver } = makeHarness();
    await expect(driver.restore({ sessionId: SESSION_ID, windows: [] })).resolves.toEqual([]);
    expect(os.calls).toEqual([]);
  });
});

describe('macOS default browser (DEC-006)', () => {
  it('resolves the default browser as a runtime protected entry', async () => {
    const { os, driver } = makeHarness();
    os.on('default-browser', () => ({
      bundleId: DEFAULT_BROWSER,
      path: '/Applications/Example Browser.app',
    }));

    const entry = await driver.resolveDefaultBrowser();

    expect(entry).toEqual({
      key: 'default-browser',
      label: 'Example Browser',
      mac: [DEFAULT_BROWSER],
    });
    expect(appEntrySchema.safeParse(entry).success).toBe(true);
    expect(os.callsFor('default-browser')[0]?.args).toEqual([]);
  });

  it('is non-fatal when resolution fails', async () => {
    const { os, driver } = makeHarness();
    os.on('default-browser', () => {
      throw new Error('dwm lookup failed');
    });
    await expect(driver.resolveDefaultBrowser()).resolves.toBeUndefined();
  });

  it('is non-fatal when no handler is registered', async () => {
    const { os, driver } = makeHarness();
    os.on('default-browser', () => ({}));
    await expect(driver.resolveDefaultBrowser()).resolves.toBeUndefined();
  });
});

describe('macOS capabilities — honest degradation (FR-005)', () => {
  it('reports full control on darwin with osascript', () => {
    const { driver } = makeHarness();
    expect(driver.capabilities()).toEqual({ focus: 'full' });
  });

  it('reports unsupported on another platform without running a command', () => {
    const { os, driver } = makeHarness({ platform: 'linux' });
    const capabilities = driver.capabilities();
    expect(capabilities.focus).toBe('unsupported');
    expect(capabilities.reasons?.[0]).toMatch(/darwin/);
    expect(os.calls).toEqual([]);
  });

  it('reports unsupported when osascript is missing', () => {
    const driver = new DarwinDriver({ platform: 'darwin', osascriptPath: null });
    const capabilities = driver.capabilities();
    expect(capabilities.focus).toBe('unsupported');
    expect(capabilities.reasons?.[0]).toMatch(/osascript/);
  });

  it('refuses to touch windows when unsupported', async () => {
    const driver = new DarwinDriver({ platform: 'linux' });
    await expect(driver.listWindows()).rejects.toBeInstanceOf(DarwinDriverError);
    await expect(driver.asideWindows([refFor(CODE)])).rejects.toBeInstanceOf(DarwinDriverError);
  });
});
