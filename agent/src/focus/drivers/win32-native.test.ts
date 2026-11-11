// focus/drivers/win32-native.test.ts — the koffi binding layer of the Windows driver (T-052).
// `createWin32NativeApi` is the only code that talks to user32/kernel32/dwmapi, and this session
// has no Windows desktop (spike S-1: NEEDS-HUMAN), so the native module is replaced wholesale:
// `vi.mock('koffi')` provides a scripted FFI, and `node:module`'s `createRequire` is mocked to
// hand that same fake to `requireKoffi` (a real CJS `require` would bypass the module graph and
// load the addon). Every asserted value below comes from documented Win32 semantics — out
// parameters written into the caller's Buffer, BOOL as 0/1, `ShowWindow` returning the *previous*
// visibility — never from a real user32 call.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { noopLogger } from '../../log.js';
import {
  createWin32NativeApi,
  SW_RESTORE,
  SW_SHOWMINNOACTIVE,
  Win32Driver,
  Win32DriverError,
} from './win32.js';

// --- Scripted koffi + user32/kernel32/dwmapi ------------------------------------------------

interface FakeWindow {
  /** HWND as a number, exactly what EnumWindows yields. */
  readonly handle: number;
  visible?: boolean;
  iconic?: boolean;
  owner?: number;
  style?: number;
  cloaked?: boolean;
  pid?: number;
  /** 0 makes GetWindowThreadProcessId fail the way it does for a dead window. */
  threadId?: number;
  exePath?: string;
  /** 'null' / 'undefined' make OpenProcess refuse (UIPI) instead of returning a handle. */
  openProcess?: 'handle' | 'null' | 'undefined';
  queryFails?: boolean;
  dwmHr?: number;
  throwOnVisible?: boolean;
  showReturnsFalse?: boolean;
  /** Accept the ShowWindow call but never change the window state (unverifiable aside). */
  showNoEffect?: boolean;
}

interface ShowCall {
  readonly handle: number;
  readonly command: number;
}

interface FakeState {
  windows: FakeWindow[];
  showCalls: ShowCall[];
  openCalls: number[];
  closeCalls: number[];
  visibleCalls: number[];
  isWindowCalls: number[];
  isIconicCalls: number[];
  registered: unknown[];
  unregistered: unknown[];
  enumCallbacks: unknown[];
  enumErrors: Error | undefined;
  dwmapiMissing: boolean;
  user32Missing: boolean;
  koffiModule: unknown;
}

/** Constant offset so a fake process handle can be mapped back to its PID. */
const HANDLE_BASE = 0x1_0000;
/** GW_OWNER / WS_EX_TOOLWINDOW are duplicated as literals: `vi.hoisted` runs before the module
 * imports are evaluated, so the exported constants cannot be read inside the fake. */
const GW_OWNER_LITERAL = 4;
const TOOLWINDOW_LITERAL = 0x80;

interface FakeKoffi {
  readonly module: Record<string, (...args: readonly unknown[]) => unknown>;
  readonly state: FakeState;
  /** What `require('koffi')` returns: the fake module unless a test overrides it. */
  readonly handle: unknown;
  reset(): void;
}

const fake = vi.hoisted((): FakeKoffi => {
  const state: FakeState = {
    windows: [],
    showCalls: [],
    openCalls: [],
    closeCalls: [],
    visibleCalls: [],
    isWindowCalls: [],
    isIconicCalls: [],
    registered: [],
    unregistered: [],
    enumCallbacks: [],
    enumErrors: undefined,
    dwmapiMissing: false,
    user32Missing: false,
    koffiModule: undefined,
  };

  function num(value: unknown): number {
    return typeof value === 'number' ? value : Number(value);
  }

  function windowFor(handle: unknown): FakeWindow | undefined {
    const hwnd = num(handle);
    return state.windows.find((window) => window.handle === hwnd);
  }

  function openProcess(handle: unknown): unknown {
    const pid = num(handle) - HANDLE_BASE;
    const window = state.windows.find((candidate) => (candidate.pid ?? 0) === pid);
    if (window === undefined) return 0;
    switch (window.openProcess ?? 'handle') {
      case 'null':
        return 0;
      case 'undefined':
        return undefined;
      default:
        return num(handle);
    }
  }

  /** Dispatch on the Win32 function name embedded in the koffi signature string. */
  function funcFor(signature: string): (...args: readonly unknown[]) => unknown {
    const name = /__stdcall\s+(\w+)\s*\(/.exec(signature)?.[1];
    switch (name) {
      case 'EnumWindows':
        return (callback: unknown): boolean => {
          state.enumCallbacks.push(callback);
          const invoke = callback as (handle: unknown, param: unknown) => unknown;
          for (const window of state.windows) invoke(window.handle, 0);
          if (state.enumErrors !== undefined) throw state.enumErrors;
          return true;
        };
      case 'IsWindowVisible':
        return (handle: unknown): boolean => {
          state.visibleCalls.push(num(handle));
          const window = windowFor(handle);
          if (window === undefined) return false;
          if (window.throwOnVisible === true) throw new Error('user32 exploded');
          return window.visible ?? false;
        };
      case 'IsIconic':
        return (handle: unknown): boolean => {
          state.isIconicCalls.push(num(handle));
          return windowFor(handle)?.iconic ?? false;
        };
      case 'IsWindow':
        return (handle: unknown): boolean => {
          state.isWindowCalls.push(num(handle));
          return windowFor(handle) !== undefined;
        };
      case 'GetWindow': {
        return (handle: unknown, command: unknown): number | boolean => {
          const window = windowFor(handle);
          if (window === undefined) return 0;
          // BOOL false for every non-GW_OWNER command exercises toNumber(boolean).
          return num(command) === GW_OWNER_LITERAL ? (window.owner ?? 0) : false;
        };
      }
      case 'GetWindowLongPtrW':
        // bigint: 64-bit style values may arrive as BigInt through koffi.
        return (handle: unknown): bigint => BigInt(windowFor(handle)?.style ?? 0);
      case 'GetWindowThreadProcessId':
        return (handle: unknown, pidBuffer: unknown): number => {
          const window = windowFor(handle);
          if (window === undefined) return 0;
          if ((window.threadId ?? 4242) === 0) return 0;
          (pidBuffer as Buffer).writeUInt32LE(window.pid ?? 0, 0);
          return window.threadId ?? 4242;
        };
      case 'ShowWindow':
        return (handle: unknown, command: unknown): boolean => {
          const hwnd = num(handle);
          const cmd = num(command);
          state.showCalls.push({ handle: hwnd, command: cmd });
          const window = windowFor(handle);
          if (window === undefined) return false;
          if (window.showNoEffect !== true) window.iconic = cmd === 7;
          return window.showReturnsFalse !== true;
        };
      case 'OpenProcess':
        return (access: unknown, inherit: unknown, pid: unknown): unknown => {
          state.openCalls.push(num(pid));
          void access;
          void inherit;
          return openProcess(num(pid) + HANDLE_BASE);
        };
      case 'CloseHandle':
        return (handle: unknown): boolean => {
          state.closeCalls.push(num(handle));
          return true;
        };
      case 'QueryFullProcessImageNameW':
        return (
          handle: unknown,
          flags: unknown,
          nameBuffer: unknown,
          sizeBuffer: unknown,
        ): boolean => {
          void flags;
          const pid = num(handle) - HANDLE_BASE;
          const window = state.windows.find((candidate) => (candidate.pid ?? 0) === pid);
          if (window === undefined || window.queryFails === true) return false;
          const fullPath = window.exePath ?? 'C:\\Apps\\App.exe';
          (nameBuffer as Buffer).write(fullPath, 0, 'utf16le');
          (sizeBuffer as Buffer).writeUInt32LE(fullPath.length, 0);
          return true;
        };
      case 'DwmGetWindowAttribute':
        return (handle: unknown, attribute: unknown, valueBuffer: unknown): number | undefined => {
          void attribute;
          const window = windowFor(handle);
          if (window === undefined) return -1;
          if ((window.dwmHr ?? 0) !== 0) return window.dwmHr;
          (valueBuffer as Buffer).writeUInt32LE(window.cloaked === true ? 1 : 0, 0);
          return 0;
        };
      default:
        return (): number => 0;
    }
  }

  const module: Record<string, (...args: readonly unknown[]) => unknown> = {
    load: (library: unknown): unknown => {
      const name = String(library);
      if (name === 'user32.dll' && state.user32Missing) throw new Error('user32.dll missing');
      if (name === 'dwmapi.dll' && state.dwmapiMissing) throw new Error('dwmapi.dll missing');
      return { func: funcFor };
    },
    proto: (signature: unknown): unknown => ({ signature }),
    pointer: (proto: unknown): unknown => ({ kind: 'pointer', proto }),
    register: (callback: unknown): unknown => {
      state.registered.push(callback);
      return callback;
    },
    unregister: (registered: unknown): void => {
      state.unregistered.push(registered);
    },
  };

  return {
    module,
    state,
    get handle(): unknown {
      // `undefined` means "not overridden"; an explicit null must survive so asKoffiModule rejects it.
      return state.koffiModule === undefined ? module : state.koffiModule;
    },
    reset(): void {
      state.windows = [];
      state.showCalls.length = 0;
      state.openCalls.length = 0;
      state.closeCalls.length = 0;
      state.visibleCalls.length = 0;
      state.isWindowCalls.length = 0;
      state.isIconicCalls.length = 0;
      state.registered.length = 0;
      state.unregistered.length = 0;
      state.enumCallbacks.length = 0;
      state.enumErrors = undefined;
      state.dwmapiMissing = false;
      state.user32Missing = false;
      state.koffiModule = undefined;
    },
  };
});

vi.mock('koffi', () => fake.module);
// The production seam is a real CJS `require` (`createRequire(import.meta.url)`), which Vitest
// cannot intercept from the module graph; returning the same mocked binding keeps one fake.
vi.mock('node:module', () => ({
  createRequire: () => (specifier: string) => {
    if (specifier !== 'koffi') throw new Error(`unexpected require(${specifier})`);
    return fake.handle;
  },
}));

function window(handle: number, overrides: Partial<FakeWindow> = {}): FakeWindow {
  return {
    visible: true,
    iconic: false,
    owner: 0,
    style: 0,
    cloaked: false,
    pid: 1000 + handle,
    ...overrides,
    handle,
  };
}

/** A normal, visible, unowned app window with a queryable process. */
function appWindow(handle: number, pid: number, exePath: string): FakeWindow {
  return window(handle, { pid, exePath });
}

beforeEach(() => {
  fake.reset();
});

// --- Module construction ---------------------------------------------------------------------

describe('Win32 native module construction (koffi seam)', () => {
  it('builds the API from the mocked koffi module', () => {
    const api = createWin32NativeApi();
    expect(typeof api.enumerate).toBe('function');
    expect(typeof api.isWindow).toBe('function');
    expect(typeof api.showMinNoActivate).toBe('function');
  });

  it('rejects a koffi export that is not a module object', () => {
    fake.state.koffiModule = null;
    expect(() => createWin32NativeApi()).toThrow(Win32DriverError);
    expect(() => createWin32NativeApi()).toThrow(/did not return a module object/);
  });

  it('rejects a koffi module that is missing required functions', () => {
    fake.state.koffiModule = {
      load: () => ({ func: () => () => 0 }),
      proto: () => ({}),
      pointer: () => ({}),
      register: () => ({}),
    };
    expect(() => createWin32NativeApi()).toThrow(/missing required functions/);
  });

  it('fails loudly when user32.dll cannot be loaded', () => {
    fake.state.user32Missing = true;
    expect(() => createWin32NativeApi()).toThrow(/user32\.dll/);
  });
});

// --- Enumeration ----------------------------------------------------------------------------

describe('Win32 enumeration through the koffi binding', () => {
  it('keeps top-level candidates and filters everything §7.5 rejects', () => {
    fake.state.windows = [
      window(0), // EnumWindows can hand back a zero handle; never dereferenced.
      appWindow(101, 2001, 'C:\\Program Files\\Microsoft VS Code\\Code.exe'),
      window(102, { pid: 2002, visible: false }),
      window(103, { pid: 2003, iconic: true }),
      window(104, { pid: 2004, owner: 99 }),
      window(105, { pid: 2005, style: TOOLWINDOW_LITERAL }),
      window(106, { pid: 2006, cloaked: true }),
    ];

    const infos = createWin32NativeApi().enumerate();
    const byHandle = new Map(infos.map((info) => [info.handle, info]));

    expect(infos.map((info) => info.handle)).toEqual(['101', '102', '103', '104', '105', '106']);
    expect(byHandle.get('101')).toEqual({
      handle: '101',
      visible: true,
      iconic: false,
      hasOwner: false,
      toolWindow: false,
      cloaked: false,
      accessDenied: false,
      exeName: 'Code.exe',
    });
    expect(byHandle.get('102')?.visible).toBe(false);
    expect(byHandle.get('103')?.iconic).toBe(true);
    // Iconic windows keep their executable identity: restore() must recognise its own asides.
    expect(byHandle.get('103')?.exeName).toBe('App.exe');
    expect(byHandle.get('104')?.hasOwner).toBe(true);
    expect(byHandle.get('105')?.toolWindow).toBe(true);
    expect(byHandle.get('106')?.cloaked).toBe(true);
    // The expensive OpenProcess/QueryFullProcessImageNameW pair runs only for windows that can
    // still be identified (candidates and iconic restore targets), never for hidden/owned/tool
    // or cloaked windows.
    expect(fake.state.openCalls).toEqual([2001, 2003]);
    expect(fake.state.visibleCalls).toContain(102);
  });

  it('marks a window whose process cannot be opened as denied (UIPI/elevated)', () => {
    fake.state.windows = [
      window(201, { pid: 3001, openProcess: 'null' }),
      window(202, { pid: 3002, openProcess: 'undefined' }),
      window(203, { pid: 3003, threadId: 0 }),
      window(204, { pid: 0 }),
      window(205, { pid: 3005, queryFails: true }),
      window(206, { pid: 3006, exePath: '' }),
      window(207, { pid: 3007, exePath: 'C:\\Tools\\' }),
    ];

    const infos = createWin32NativeApi().enumerate();
    for (const info of infos) {
      expect(info.accessDenied, info.handle).toBe(true);
      expect(info.exeName, info.handle).toBeUndefined();
    }
    // A returned process handle is always closed, even when the image-name query failed.
    expect(fake.state.closeCalls).toHaveLength(3);
  });

  it('surfaces a basename only, never the executable path', () => {
    fake.state.windows = [appWindow(301, 4001, 'C:\\Users\\kabir\\AppData\\Slack.exe')];
    const [info] = createWin32NativeApi().enumerate();
    expect(info?.exeName).toBe('Slack.exe');
    expect(JSON.stringify(info)).not.toContain('kabir');
  });

  it('skips a window whose queries throw without losing the rest', () => {
    fake.state.windows = [
      window(401, { pid: 5001, throwOnVisible: true }),
      appWindow(402, 5002, 'C:\\Apps\\Code.exe'),
    ];
    const infos = createWin32NativeApi().enumerate();
    expect(infos.map((info) => info.handle)).toEqual(['402']);
  });

  it('registers the EnumWindows callback, passes lParam 0 and always unregisters', () => {
    fake.state.windows = [appWindow(501, 6001, 'C:\\Apps\\Code.exe')];
    createWin32NativeApi().enumerate();

    expect(fake.state.registered).toHaveLength(1);
    expect(fake.state.enumCallbacks).toEqual(fake.state.registered);
    expect(fake.state.unregistered).toEqual(fake.state.registered);
  });

  it('unregisters the callback even when EnumWindows itself fails', () => {
    fake.state.windows = [appWindow(601, 7001, 'C:\\Apps\\Code.exe')];
    fake.state.enumErrors = new Error('EnumWindows failed');
    expect(() => createWin32NativeApi().enumerate()).toThrow(/EnumWindows failed/);
    expect(fake.state.unregistered).toEqual(fake.state.registered);
  });

  it('reports a window as cloaked only when both the HRESULT and the flag agree', () => {
    fake.state.windows = [
      window(701, { pid: 8001, cloaked: true }),
      window(702, { pid: 8002, cloaked: true, dwmHr: -2_147_024_639 }),
      window(703, { pid: 8003, cloaked: false }),
    ];
    const infos = createWin32NativeApi().enumerate();
    expect(infos[0]?.cloaked).toBe(true);
    expect(infos[1]?.cloaked).toBe(false);
    expect(infos[2]?.cloaked).toBe(false);
  });

  it('degrades to "not cloaked" when dwmapi.dll is unavailable', () => {
    fake.state.dwmapiMissing = true;
    fake.state.windows = [window(801, { pid: 9001, cloaked: true, exePath: 'C:\\Apps\\Code.exe' })];
    const [info] = createWin32NativeApi().enumerate();
    expect(info?.cloaked).toBe(false);
    expect(info?.exeName).toBe('Code.exe');
    expect(fake.state.openCalls).toEqual([9001]);
  });
});

// --- Window primitives ----------------------------------------------------------------------

describe('Win32 window primitives', () => {
  it('answers isWindow/isIconic only for strictly parsed decimal handles', () => {
    fake.state.windows = [window(901, { iconic: true })];
    const api = createWin32NativeApi();
    expect(api.isWindow('901')).toBe(true);
    expect(api.isIconic('901')).toBe(true);
    expect(api.isWindow('902')).toBe(false);
    expect(api.isWindow('0x385')).toBe(false);
    expect(api.isIconic('not-a-handle')).toBe(false);
    // Invalid handles never reach user32.
    expect(fake.state.isWindowCalls).toEqual([901, 902]);
    expect(fake.state.isIconicCalls).toEqual([901]);
  });

  it('issues SW_SHOWMINNOACTIVE / SW_RESTORE for valid handles only', () => {
    fake.state.windows = [window(1001), window(1002, { iconic: true })];
    const api = createWin32NativeApi();

    expect(api.showMinNoActivate('1001')).toBe(true);
    expect(api.showRestore('1002')).toBe(true);
    expect(api.showMinNoActivate('0x3e9')).toBe(false);
    expect(api.showRestore('nope')).toBe(false);

    expect(fake.state.showCalls).toEqual([
      { handle: 1001, command: SW_SHOWMINNOACTIVE },
      { handle: 1002, command: SW_RESTORE },
    ]);
  });

  it('treats ShowWindow returning false as issued: the BOOL is previous visibility, not success', () => {
    fake.state.windows = [window(1101, { showReturnsFalse: true })];
    const api = createWin32NativeApi();
    expect(api.showMinNoActivate('1101')).toBe(true);
    expect(api.showRestore('1101')).toBe(true);
    expect(fake.state.showCalls).toHaveLength(2);
  });
});

// --- Driver over the real binding path ------------------------------------------------------

describe('Win32Driver wired to the koffi binding', () => {
  function driver(): Win32Driver {
    // No `native`/`loadNative` override: this exercises createWin32NativeApi() as shipped.
    return new Win32Driver({ platform: 'win32', logger: noopLogger, verifyDelayMs: 0 });
  }

  const CODE = 'C:\\Apps\\Code.exe';
  const SLACK = 'C:\\Apps\\Slack.exe';

  it('lists only reachable, identified windows and reports UIPI skips', async () => {
    fake.state.windows = [
      appWindow(1201, 12_001, CODE),
      window(1202, { pid: 12_002, openProcess: 'null' }),
      window(1203, { pid: 12_003, visible: false }),
    ];
    const focus = driver();
    const windows = await focus.listWindows();

    expect(windows).toEqual([{ handle: '1201', appKey: 'code', identifier: 'Code.exe' }]);
    expect(focus.capabilities().focus).toBe('full');
    expect(focus.capabilities().reasons?.[0]).toMatch(/1 elevated/);
  });

  it('minimises through ShowWindow and verifies the resulting iconic state', async () => {
    fake.state.windows = [appWindow(1301, 13_001, CODE)];
    const changed = await driver().asideWindows([
      { handle: '1301', appKey: 'code', identifier: 'Code.exe' },
    ]);

    expect(changed).toHaveLength(1);
    expect(fake.state.showCalls).toEqual([{ handle: 1301, command: SW_SHOWMINNOACTIVE }]);
    expect(fake.state.windows[0]?.iconic).toBe(true);
  });

  it('restores only journaled windows that are still iconic and still the same app', async () => {
    fake.state.windows = [
      window(1401, { pid: 14_001, exePath: CODE, iconic: true }),
      window(1402, { pid: 14_002, exePath: SLACK, iconic: true }),
    ];
    const restored = await driver().restore({
      sessionId: '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f',
      windows: [
        { handle: '1401', appKey: 'code', identifier: 'Code.exe' },
        { handle: '1402', appKey: 'code', identifier: 'Code.exe' },
      ],
    });

    expect(restored.map((ref) => ref.handle)).toEqual(['1401']);
    expect(fake.state.showCalls).toEqual([{ handle: 1401, command: SW_RESTORE }]);
  });

  it('does not claim a window when ShowWindow never makes it iconic', async () => {
    fake.state.windows = [window(1501, { pid: 15_001, exePath: CODE, showNoEffect: true })];
    const focus = new Win32Driver({
      platform: 'win32',
      logger: noopLogger,
      verifyAttempts: 2,
      verifyDelayMs: 0,
      sleep: async () => undefined,
    });

    await expect(
      focus.asideWindows([{ handle: '1501', appKey: 'code', identifier: 'Code.exe' }]),
    ).resolves.toEqual([]);
    expect(fake.state.showCalls).toEqual([{ handle: 1501, command: SW_SHOWMINNOACTIVE }]);
    expect(fake.state.windows[0]?.iconic).toBe(false);
  });
});
