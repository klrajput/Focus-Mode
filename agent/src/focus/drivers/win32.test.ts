// focus/drivers/win32.test.ts — pure + mocked-native tests for the Windows driver (T-052).
// No Windows desktop is available in this session (spike S-1: NEEDS-HUMAN), so real user32
// behaviour is CI/manual evidence. Everything testable without Windows is tested here against
// an injected `Win32NativeApi`: the §7.5 filter, the UIPI skip, handle-reuse identity checks,
// SW_SHOWMINNOACTIVE/SW_RESTORE usage and verified restore. koffi is never loaded on macOS.

import { describe, expect, it } from 'vitest';
import type { WindowRef } from '../../allowlist.js';
import { noopLogger } from '../../log.js';
import { appKeyFromExecutableName } from './app-key.js';
import {
  DWMWA_CLOAKED,
  GWL_EXSTYLE,
  GW_OWNER,
  isReachableTopLevel,
  parseWin32Handle,
  PROCESS_QUERY_LIMITED_INFORMATION,
  selectFocusWindows,
  SW_RESTORE,
  SW_SHOWMINNOACTIVE,
  windowInfoToRef,
  windowMatchesRef,
  Win32Driver,
  Win32DriverError,
  WS_EX_TOOLWINDOW,
  type Win32DriverOptions,
  type Win32NativeApi,
  type Win32WindowInfo,
} from './win32.js';

function info(
  handle: string,
  exeName?: string,
  overrides: Partial<Win32WindowInfo> = {},
): Win32WindowInfo {
  return {
    handle,
    visible: true,
    iconic: false,
    hasOwner: false,
    toolWindow: false,
    cloaked: false,
    accessDenied: false,
    ...(exeName === undefined ? {} : { exeName }),
    ...overrides,
  };
}

function refFor(handle: string, exeName: string): WindowRef {
  const appKey = appKeyFromExecutableName(exeName);
  if (appKey === undefined) throw new Error(`invalid test executable ${exeName}`);
  return { handle, appKey, identifier: exeName };
}

interface FakeWindow {
  handle: string;
  visible: boolean;
  iconic: boolean;
  hasOwner: boolean;
  toolWindow: boolean;
  cloaked: boolean;
  exeName?: string;
  accessDenied: boolean;
}

/** In-memory user32: window handles, iconic state and a call log. */
class FakeWin32 implements Win32NativeApi {
  readonly windows: FakeWindow[];
  readonly calls: string[] = [];
  iconicChecks = 0;
  minimizeEffect = true;
  restoreEffect = true;

  constructor(windows: readonly Partial<FakeWindow>[] = []) {
    this.windows = windows.map((window) => ({
      handle: '101',
      visible: true,
      iconic: false,
      hasOwner: false,
      toolWindow: false,
      cloaked: false,
      accessDenied: false,
      ...window,
    }));
  }

  enumerate(): readonly Win32WindowInfo[] {
    return this.windows.map((window) => {
      const copy: Win32WindowInfo = {
        handle: window.handle,
        visible: window.visible,
        iconic: window.iconic,
        hasOwner: window.hasOwner,
        toolWindow: window.toolWindow,
        cloaked: window.cloaked,
        accessDenied: window.accessDenied,
        ...(window.exeName === undefined ? {} : { exeName: window.exeName }),
      };
      return copy;
    });
  }

  isWindow(handle: string): boolean {
    return this.#find(handle) !== undefined;
  }

  isIconic(handle: string): boolean {
    this.iconicChecks += 1;
    return this.#find(handle)?.iconic ?? false;
  }

  showMinNoActivate(handle: string): boolean {
    this.calls.push(`min:${handle}`);
    const window = this.#find(handle);
    if (window === undefined) return false;
    if (this.minimizeEffect) window.iconic = true;
    return true;
  }

  showRestore(handle: string): boolean {
    this.calls.push(`restore:${handle}`);
    const window = this.#find(handle);
    if (window === undefined) return false;
    if (this.restoreEffect) window.iconic = false;
    return true;
  }

  #find(handle: string): FakeWindow | undefined {
    return this.windows.find((window) => window.handle === handle);
  }
}

interface Harness {
  readonly windows: FakeWin32;
  readonly driver: Win32Driver;
  readonly sleeps: number[];
}

function makeHarness(
  windows: readonly Partial<FakeWindow>[] = [],
  overrides: Partial<Win32DriverOptions> = {},
): Harness {
  const native = new FakeWin32(windows);
  const sleeps: number[] = [];
  const driver = new Win32Driver({
    platform: 'win32',
    native,
    logger: noopLogger,
    verifyAttempts: 3,
    verifyDelayMs: 10,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
    },
    ...overrides,
  });
  return { windows: native, driver, sleeps };
}

describe('Win32 constants match the documented API values', () => {
  it('uses the correct ShowWindow and window-query constants', () => {
    expect(SW_SHOWMINNOACTIVE).toBe(7);
    expect(SW_RESTORE).toBe(9);
    expect(GW_OWNER).toBe(4);
    expect(GWL_EXSTYLE).toBe(-20);
    expect(WS_EX_TOOLWINDOW).toBe(0x0000_0080);
    expect(DWMWA_CLOAKED).toBe(14);
    expect(PROCESS_QUERY_LIMITED_INFORMATION).toBe(0x1000);
  });
});

describe('Win32 candidate filtering (TECHNICAL_DESIGN §7.5)', () => {
  it('skips invisible, iconic, owned, tool and cloaked windows', () => {
    const windows: readonly Win32WindowInfo[] = [
      info('1', 'Code.exe'),
      info('2', 'Code.exe', { visible: false }),
      info('3', 'Code.exe', { iconic: true }),
      info('4', 'Code.exe', { hasOwner: true }),
      info('5', 'Code.exe', { toolWindow: true }),
      info('6', 'Code.exe', { cloaked: true }),
      info('7', undefined, { accessDenied: true }),
      info('8', undefined),
    ];
    const { candidates, skippedElevated } = selectFocusWindows(windows);
    expect(candidates.map((window) => window.handle)).toEqual(['1']);
    expect(skippedElevated).toBe(1);
  });

  it('treats an unqueryable (UIPI/elevated) window as unreachable even when visible', () => {
    const { candidates, skippedElevated } = selectFocusWindows([
      info('1', 'Code.exe', { accessDenied: true }),
    ]);
    expect(candidates).toEqual([]);
    expect(skippedElevated).toBe(1);
  });

  it('states the reachability rule once', () => {
    expect(isReachableTopLevel(info('1', 'Code.exe'))).toBe(true);
    expect(isReachableTopLevel(info('1', 'Code.exe', { hasOwner: true }))).toBe(false);
  });

  it('derives the identity from the executable basename only', () => {
    expect(windowInfoToRef(info('42', 'Code.exe'))).toEqual({
      handle: '42',
      appKey: 'code',
      identifier: 'Code.exe',
    });
    expect(windowInfoToRef(info('42', 'C:\\Apps\\Slack.exe'))?.identifier).toBe('Slack.exe');
    expect(windowInfoToRef(info('42'))).toBeUndefined();
  });

  it('rejects a recycled handle whose executable changed', () => {
    const ref = refFor('42', 'Code.exe');
    expect(windowMatchesRef(ref, info('42', 'Code.exe'))).toBe(true);
    expect(windowMatchesRef(ref, info('42', 'Slack.exe'))).toBe(false);
    expect(windowMatchesRef(ref, info('42'))).toBe(false);
  });

  it('validates journal handles before they reach koffi', () => {
    expect(parseWin32Handle('12345')).toBe(12345);
    expect(parseWin32Handle('0')).toBeUndefined();
    expect(parseWin32Handle('-1')).toBeUndefined();
    expect(parseWin32Handle('1.5')).toBeUndefined();
    expect(parseWin32Handle('0x10')).toBeUndefined();
    expect(parseWin32Handle('99999999999999999999')).toBeUndefined();
  });
});

describe('Win32 capabilities — honest degradation (FR-005)', () => {
  it('reports unsupported on another platform without loading koffi', () => {
    const native = new FakeWin32();
    const driver = new Win32Driver({ platform: 'darwin', native, logger: noopLogger });
    const capabilities = driver.capabilities();
    expect(capabilities.focus).toBe('unsupported');
    expect(capabilities.reasons?.[0]).toMatch(/win32/);
    expect(native.calls).toEqual([]);
  });

  it('reports unsupported (once) when koffi cannot be loaded', () => {
    let loads = 0;
    const driver = new Win32Driver({
      platform: 'win32',
      logger: noopLogger,
      loadNative: () => {
        loads += 1;
        throw new Error('koffi missing');
      },
    });
    expect(driver.capabilities().focus).toBe('unsupported');
    expect(driver.capabilities().focus).toBe('unsupported');
    expect(driver.capabilities().reasons?.[0]).toMatch(/koffi/);
    expect(loads).toBe(1);
  });

  it('refuses window operations when the native layer is unavailable', async () => {
    const driver = new Win32Driver({
      platform: 'win32',
      logger: noopLogger,
      loadNative: () => {
        throw new Error('koffi missing');
      },
    });
    await expect(driver.listWindows()).rejects.toBeInstanceOf(Win32DriverError);
    await expect(driver.asideWindows([refFor('1', 'Code.exe')])).rejects.toBeInstanceOf(
      Win32DriverError,
    );
  });

  it('reports full control with the native layer present', () => {
    const { driver } = makeHarness();
    expect(driver.capabilities()).toEqual({ focus: 'full' });
  });

  it('reports UIPI-skipped windows in capabilities.reasons', async () => {
    const { driver } = makeHarness([
      { handle: '1', exeName: 'Code.exe' },
      { handle: '2', accessDenied: true },
    ]);
    const windows = await driver.listWindows();
    expect(windows.map((ref) => ref.handle)).toEqual(['1']);
    const capabilities = driver.capabilities();
    expect(capabilities.focus).toBe('full');
    expect(capabilities.reasons?.[0]).toMatch(/1 elevated/);
  });
});

describe('Win32 listWindows', () => {
  it('returns only reachable, identified windows and dedupes handles', async () => {
    const { driver } = makeHarness([
      { handle: '1', exeName: 'Code.exe' },
      { handle: '2', exeName: 'chrome.exe', visible: false },
      { handle: '3', accessDenied: true },
      { handle: '1', exeName: 'Code.exe' },
    ]);
    const windows = await driver.listWindows();
    expect(windows.map((ref) => ref.handle)).toEqual(['1']);
  });

  it('never exposes titles or a URL-like field (INV-6)', async () => {
    const { driver } = makeHarness([{ handle: '1', exeName: 'Code.exe' }]);
    const windows = await driver.listWindows();
    expect(Object.keys(windows[0] ?? {}).sort()).toEqual(['appKey', 'handle', 'identifier']);
  });
});

describe('Win32 aside', () => {
  it('minimises only the requested, still-matching windows', async () => {
    const { windows, driver } = makeHarness([
      { handle: '101', exeName: 'Code.exe' },
      { handle: '102', exeName: 'Slack.exe' },
    ]);
    const changed = await driver.asideWindows([
      refFor('101', 'Code.exe'),
      refFor('102', 'Slack.exe'),
    ]);
    expect(changed.map((ref) => ref.handle)).toEqual(['101', '102']);
    expect(windows.calls).toEqual(['min:101', 'min:102']);
    expect(windows.windows.every((window) => window.iconic)).toBe(true);
  });

  it('leaves an already-minimised window alone', async () => {
    const { windows, driver } = makeHarness([{ handle: '101', exeName: 'Code.exe', iconic: true }]);
    await expect(driver.asideWindows([refFor('101', 'Code.exe')])).resolves.toEqual([]);
    expect(windows.calls).toEqual([]);
  });

  it('leaves an invisible or elevated window alone', async () => {
    const { windows, driver } = makeHarness([
      { handle: '101', exeName: 'Code.exe', visible: false },
      { handle: '102', accessDenied: true },
    ]);
    await expect(
      driver.asideWindows([refFor('101', 'Code.exe'), refFor('102', 'Slack.exe')]),
    ).resolves.toEqual([]);
    expect(windows.calls).toEqual([]);
    expect(driver.capabilities().reasons?.[0]).toMatch(/elevated/);
  });

  it('refuses to minimise a handle now owned by another executable', async () => {
    const { windows, driver } = makeHarness([{ handle: '101', exeName: 'Slack.exe' }]);
    await expect(driver.asideWindows([refFor('101', 'Code.exe')])).resolves.toEqual([]);
    expect(windows.calls).toEqual([]);
  });

  it('does not claim a window whose minimise it could not verify', async () => {
    const { windows, driver, sleeps } = makeHarness([{ handle: '101', exeName: 'Code.exe' }]);
    windows.minimizeEffect = false;
    await expect(driver.asideWindows([refFor('101', 'Code.exe')])).resolves.toEqual([]);
    expect(windows.iconicChecks).toBe(3);
    expect(sleeps).toEqual([10, 10]);
  });

  it('short-circuits an empty candidate list without touching the OS', async () => {
    const { windows, driver } = makeHarness([{ handle: '101', exeName: 'Code.exe' }]);
    await expect(driver.asideWindows([])).resolves.toEqual([]);
    expect(windows.calls).toEqual([]);
  });
});

describe('Win32 restore', () => {
  it('restores only journaled handles that are valid, still iconic and still the same app', async () => {
    const { windows, driver } = makeHarness([
      { handle: '101', exeName: 'Code.exe', iconic: true },
      { handle: '102', exeName: 'Slack.exe', iconic: false },
      { handle: '103', exeName: 'Spotify.exe', iconic: true },
    ]);
    const restored = await driver.restore({
      sessionId: '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f',
      windows: [
        refFor('101', 'Code.exe'),
        refFor('102', 'Slack.exe'),
        refFor('103', 'Spotify.exe'),
        refFor('999', 'Code.exe'),
      ],
    });
    // 102 is no longer iconic (so it is not ours to restore); 999 no longer exists.
    expect(restored.map((ref) => ref.handle)).toEqual(['101', '103']);
    expect(windows.calls).toEqual(['restore:101', 'restore:103']);
    expect(windows.windows[0]?.iconic).toBe(false);
  });

  it('skips a recycled handle whose executable changed', async () => {
    const { windows, driver } = makeHarness([
      { handle: '101', exeName: 'Slack.exe', iconic: true },
    ]);
    await expect(
      driver.restore({
        sessionId: '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f',
        windows: [refFor('101', 'Code.exe')],
      }),
    ).resolves.toEqual([]);
    expect(windows.calls).toEqual([]);
  });

  it('reports nothing when the restore cannot be verified', async () => {
    const { windows, driver, sleeps } = makeHarness([
      { handle: '101', exeName: 'Code.exe', iconic: true },
    ]);
    windows.restoreEffect = false;
    await expect(
      driver.restore({
        sessionId: '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f',
        windows: [refFor('101', 'Code.exe')],
      }),
    ).resolves.toEqual([]);
    expect(windows.iconicChecks).toBe(3);
    expect(sleeps).toEqual([10, 10]);
  });

  it('returns [] for an empty plan without touching the OS', async () => {
    const { windows, driver } = makeHarness([{ handle: '101', exeName: 'Code.exe' }]);
    await expect(
      driver.restore({ sessionId: '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f', windows: [] }),
    ).resolves.toEqual([]);
    expect(windows.calls).toEqual([]);
  });
});
