// focus/drivers/win32.ts — Windows 10/11 focus driver over user32/dwmapi via koffi (T-052).
// TECHNICAL_DESIGN §7.5: EnumWindows → IsWindowVisible → IsIconic → GetWindow(GW_OWNER) →
// GetWindowLongPtr(GWL_EXSTYLE, skip WS_EX_TOOLWINDOW) → DwmGetWindowAttribute(DWMWA_CLOAKED)
// → GetWindowThreadProcessId → OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION) →
// QueryFullProcessImageNameW. The executable basename is the identity; window titles are never
// read (INV-6). Aside = ShowWindow(SW_SHOWMINNOACTIVE); restore = ShowWindow(SW_RESTORE) for
// journaled handles that are still iconic and whose executable still matches (handle-reuse
// guard). The shell's "minimise everything" shortcut is never used: it would also minimise the
// protected browser.
//
// koffi is required lazily *only* when this driver is constructed for win32 and its native
// layer is first needed, so importing this module on macOS/Linux (tests, lint, docs) never loads
// a native addon. Everything below the `Win32NativeApi` seam is pure and unit-testable; real
// Win32 behaviour is CI/NEEDS-HUMAN evidence (spike S-1: no Windows desktop in this session).

import { createRequire } from 'node:module';
import type { AgentCapabilities } from '@focus-mode/shared';
import type { WindowRef } from '../../allowlist.js';
import { noopLogger, type Logger } from '../../log.js';
import type { FocusDriver, RestorePlan } from '../driver.js';
import { appKeyFromExecutableName } from './app-key.js';

// --- Win32 constants (documented values, exported for the unit tests) ----------------------

/** `ShowWindow` command: minimise without activating another window. */
export const SW_SHOWMINNOACTIVE = 7;
/** `ShowWindow` command: restore to the previous normal/maximised state. */
export const SW_RESTORE = 9;
/** `GetWindow` command: owner window (non-zero means this is an owned dialog). */
export const GW_OWNER = 4;
/** `GetWindowLongPtr` index for the extended window style. */
export const GWL_EXSTYLE = -20;
/** Extended style bit for tool windows (no taskbar entry, not a focus candidate). */
export const WS_EX_TOOLWINDOW = 0x0000_0080;
/** `DwmGetWindowAttribute` attribute for the cloaked flag (UWP shell placeholders). */
export const DWMWA_CLOAKED = 14;
/** `OpenProcess` right needed for QueryFullProcessImageNameW only. */
export const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

const EXE_NAME_MAX_CHARS = 32_768;
const PROCESS_NAME_FLAGS = 0;
const KOFFI_MODULE = 'koffi';
const DEFAULT_VERIFY_ATTEMPTS = 3;
const DEFAULT_VERIFY_DELAY_MS = 120;

// --- Native seam ---------------------------------------------------------------------------

/** Raw facts about one HWND; filtered by the pure `selectFocusWindows` below. */
export interface Win32WindowInfo {
  /** HWND as a decimal string (the journal handle). */
  readonly handle: string;
  readonly visible: boolean;
  readonly iconic: boolean;
  /** True when `GetWindow(GW_OWNER)` returned a non-zero owner (an owned dialog). */
  readonly hasOwner: boolean;
  readonly toolWindow: boolean;
  readonly cloaked: boolean;
  /** Executable basename, e.g. `Code.exe`; undefined when the process cannot be queried. */
  readonly exeName?: string;
  /** True when OpenProcess/QueryFullProcessImageNameW was refused (UIPI / elevated target). */
  readonly accessDenied: boolean;
}

/**
 * The narrow OS surface the driver needs. `createWin32NativeApi` implements it with koffi;
 * unit tests implement it in memory so no Windows machine is required to test the logic.
 */
export interface Win32NativeApi {
  enumerate(): readonly Win32WindowInfo[];
  isWindow(handle: string): boolean;
  isIconic(handle: string): boolean;
  /** Returns true when the ShowWindow call was issued (the result is verified separately). */
  showMinNoActivate(handle: string): boolean;
  showRestore(handle: string): boolean;
}

export class Win32DriverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Win32DriverError';
  }
}

// --- Pure logic ----------------------------------------------------------------------------

/** A window is a top-level focus candidate only if it is a real, visible, unowned window. */
export function isReachableTopLevel(info: Win32WindowInfo): boolean {
  return info.visible && !info.iconic && !info.hasOwner && !info.toolWindow && !info.cloaked;
}

export interface Win32Candidates {
  readonly candidates: readonly Win32WindowInfo[];
  /** Windows we could see but not query: almost always elevated processes blocked by UIPI. */
  readonly skippedElevated: number;
}

/**
 * Applies the §7.5 filter. A window whose process cannot be opened (UIPI/elevation) has no
 * executable identity and must never be touched; the count is surfaced in `capabilities.reasons`
 * so the dashboard/user knows some windows are outside the agent's reach.
 */
export function selectFocusWindows(windows: readonly Win32WindowInfo[]): Win32Candidates {
  const candidates: Win32WindowInfo[] = [];
  let skippedElevated = 0;
  for (const info of windows) {
    if (!isReachableTopLevel(info)) continue;
    if (info.accessDenied) {
      skippedElevated += 1;
      continue;
    }
    if (executableName(info) === undefined) continue;
    candidates.push(info);
  }
  return { candidates, skippedElevated };
}

/** Executable basename without a path, or undefined when the process was not queryable. */
export function executableName(info: Win32WindowInfo): string | undefined {
  const raw = info.exeName?.trim();
  if (raw === undefined || raw.length === 0) return undefined;
  return raw.replace(/^.*[\\/]/, '');
}

/** Maps one candidate to the journal-safe `WindowRef` (handle + executable identity only). */
export function windowInfoToRef(info: Win32WindowInfo): WindowRef | undefined {
  const exeName = executableName(info);
  if (exeName === undefined) return undefined;
  const appKey = appKeyFromExecutableName(exeName);
  if (appKey === undefined) return undefined;
  return { handle: info.handle, appKey, identifier: exeName };
}

/**
 * Handle-reuse guard: a HWND may be recycled by a different process between journal write and
 * restore/aside, so the executable identity must still match before acting.
 */
export function windowMatchesRef(ref: WindowRef, info: Win32WindowInfo): boolean {
  const exeName = executableName(info);
  if (exeName === undefined) return false;
  const identifier = ref.identifier?.trim().toLowerCase();
  if (identifier !== undefined && identifier.length > 0)
    return identifier === exeName.toLowerCase();
  const appKey = appKeyFromExecutableName(exeName);
  return appKey !== undefined && appKey === ref.appKey;
}

/** Parses a decimal HWND string; invalid values are rejected before reaching koffi. */
export function parseWin32Handle(handle: string): number | undefined {
  if (!/^\d{1,20}$/.test(handle.trim())) return undefined;
  const value = Number.parseInt(handle.trim(), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

// --- Koffi binding layer -------------------------------------------------------------------

interface KoffiFunction {
  (...args: readonly unknown[]): unknown;
}

interface KoffiLibrary {
  func(signature: string): KoffiFunction;
}

interface KoffiModule {
  load(libraryPath: string): KoffiLibrary;
  proto(signature: string): unknown;
  pointer(proto: unknown): unknown;
  register(callback: (...args: readonly unknown[]) => unknown, proto: unknown): unknown;
  unregister(callback: unknown): void;
}

function asKoffiModule(candidate: unknown): KoffiModule {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Win32DriverError('koffi did not return a module object');
  }
  const record = candidate as Record<string, unknown>;
  const isFunction = (value: unknown): value is (...args: readonly unknown[]) => unknown =>
    typeof value === 'function';
  if (
    !isFunction(record.load) ||
    !isFunction(record.proto) ||
    !isFunction(record.pointer) ||
    !isFunction(record.register) ||
    !isFunction(record.unregister)
  ) {
    throw new Win32DriverError('koffi module is missing required functions');
  }
  return {
    load: record.load as KoffiModule['load'],
    proto: record.proto as KoffiModule['proto'],
    pointer: record.pointer as KoffiModule['pointer'],
    register: record.register as KoffiModule['register'],
    unregister: record.unregister as KoffiModule['unregister'],
  };
}

/** Lazily requires the native koffi addon; only ever called on win32. */
function requireKoffi(): KoffiModule {
  const require = createRequire(import.meta.url);
  const loaded: unknown = require(KOFFI_MODULE);
  return asKoffiModule(loaded);
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return undefined;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const numeric = toNumber(value);
  return numeric !== undefined && numeric !== 0;
}

/**
 * Real Win32 implementation. Signatures follow the `__stdcall` Win32 ABI; out-parameters are
 * passed as Node buffers/arrays, so no manual memory management is needed. 64-bit HANDLE/HWND
 * values are handled as `intptr_t` numbers, which is safe for window and process handles (they
 * stay well below 2^53 in practice).
 */
export function createWin32NativeApi(): Win32NativeApi {
  const koffi = requireKoffi();
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  let dwmapi: KoffiLibrary | undefined;
  try {
    dwmapi = koffi.load('dwmapi.dll');
  } catch {
    // DWM is present on every supported Windows version; if it is not, cloaked detection
    // degrades to "not cloaked" instead of failing the whole driver.
    dwmapi = undefined;
  }

  const EnumWindowsProc = koffi.proto(
    'bool __stdcall EnumWindowsProc(intptr_t hWnd, intptr_t lParam)',
  );
  const EnumWindows = user32.func(
    'bool __stdcall EnumWindows(EnumWindowsProc *lpEnumFunc, intptr_t lParam)',
  );
  const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr_t hWnd)');
  const IsIconic = user32.func('bool __stdcall IsIconic(intptr_t hWnd)');
  const IsWindow = user32.func('bool __stdcall IsWindow(intptr_t hWnd)');
  const GetWindow = user32.func('intptr_t __stdcall GetWindow(intptr_t hWnd, uint32 uCmd)');
  const GetWindowLongPtrW = user32.func(
    'intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int nIndex)',
  );
  const GetWindowThreadProcessId = user32.func(
    'uint32 __stdcall GetWindowThreadProcessId(intptr_t hWnd, void *lpdwProcessId)',
  );
  const ShowWindow = user32.func('bool __stdcall ShowWindow(intptr_t hWnd, int nCmdShow)');
  const OpenProcess = kernel32.func(
    'intptr_t __stdcall OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)',
  );
  const CloseHandle = kernel32.func('bool __stdcall CloseHandle(intptr_t hObject)');
  const QueryFullProcessImageNameW = kernel32.func(
    'bool __stdcall QueryFullProcessImageNameW(intptr_t hProcess, uint32 dwFlags, void *lpExeName, void *lpdwSize)',
  );
  const DwmGetWindowAttribute =
    dwmapi === undefined
      ? undefined
      : dwmapi.func(
          'int __stdcall DwmGetWindowAttribute(intptr_t hWnd, uint32 dwAttribute, void *pvAttribute, uint32 cbAttribute)',
        );

  /** Process executable basename for one HWND; `accessDenied` when OpenProcess is refused. */
  function exeNameForWindow(hwnd: number): {
    readonly exeName?: string;
    readonly accessDenied: boolean;
  } {
    const pidBuffer = Buffer.alloc(4);
    const threadId = toNumber(GetWindowThreadProcessId(hwnd, pidBuffer));
    if (threadId === 0) return { accessDenied: true };
    const pid = pidBuffer.readUInt32LE(0);
    if (pid === 0) return { accessDenied: true };

    const processHandle = toNumber(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid));
    if (processHandle === undefined || processHandle === 0) return { accessDenied: true };
    try {
      const nameBuffer = Buffer.alloc(EXE_NAME_MAX_CHARS * 2);
      const sizeBuffer = Buffer.alloc(4);
      sizeBuffer.writeUInt32LE(EXE_NAME_MAX_CHARS, 0);
      const ok = toBoolean(
        QueryFullProcessImageNameW(processHandle, PROCESS_NAME_FLAGS, nameBuffer, sizeBuffer),
      );
      if (!ok) return { accessDenied: true };
      const length = Math.min(sizeBuffer.readUInt32LE(0), EXE_NAME_MAX_CHARS);
      const fullPath = nameBuffer.toString('utf16le', 0, length * 2);
      const basename = fullPath.replace(/^.*[\\/]/, '');
      return basename.length === 0
        ? { accessDenied: true }
        : { exeName: basename, accessDenied: false };
    } finally {
      CloseHandle(processHandle);
    }
  }

  function cloakedFlag(hwnd: number): boolean {
    if (DwmGetWindowAttribute === undefined) return false;
    const valueBuffer = Buffer.alloc(4);
    const hr = toNumber(DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, valueBuffer, 4));
    if (hr === undefined || hr !== 0) return false;
    return valueBuffer.readUInt32LE(0) !== 0;
  }

  return {
    enumerate(): readonly Win32WindowInfo[] {
      const windows: Win32WindowInfo[] = [];
      const callback = (...callbackArgs: readonly unknown[]): boolean => {
        try {
          const hwnd = toNumber(callbackArgs[0]);
          if (hwnd === undefined || hwnd === 0) return true;
          const visible = toBoolean(IsWindowVisible(hwnd));
          const iconic = toBoolean(IsIconic(hwnd));
          const hasOwner = toNumber(GetWindow(hwnd, GW_OWNER)) !== 0;
          const style = toNumber(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) ?? 0;
          const toolWindow = (style & WS_EX_TOOLWINDOW) !== 0;
          const cloaked = cloakedFlag(hwnd);
          // Expensive process lookup only for windows that could still be candidates.
          if (!visible || iconic || hasOwner || toolWindow || cloaked) {
            windows.push({
              handle: String(hwnd),
              visible,
              iconic,
              hasOwner,
              toolWindow,
              cloaked,
              accessDenied: false,
            });
            return true;
          }
          const process = exeNameForWindow(hwnd);
          windows.push({
            handle: String(hwnd),
            visible,
            iconic,
            hasOwner,
            toolWindow,
            cloaked,
            accessDenied: process.accessDenied,
            ...(process.exeName === undefined ? {} : { exeName: process.exeName }),
          });
          return true;
        } catch {
          // A callback must never throw across the FFI boundary; skip the offending window.
          return true;
        }
      };

      const registered = koffi.register(callback, koffi.pointer(EnumWindowsProc));
      try {
        EnumWindows(registered, 0);
      } finally {
        koffi.unregister(registered);
      }
      return windows;
    },

    isWindow(handle: string): boolean {
      const hwnd = parseWin32Handle(handle);
      return hwnd !== undefined && toBoolean(IsWindow(hwnd));
    },

    isIconic(handle: string): boolean {
      const hwnd = parseWin32Handle(handle);
      return hwnd !== undefined && toBoolean(IsIconic(hwnd));
    },

    showMinNoActivate(handle: string): boolean {
      const hwnd = parseWin32Handle(handle);
      if (hwnd === undefined) return false;
      ShowWindow(hwnd, SW_SHOWMINNOACTIVE);
      return true;
    },

    showRestore(handle: string): boolean {
      const hwnd = parseWin32Handle(handle);
      if (hwnd === undefined) return false;
      ShowWindow(hwnd, SW_RESTORE);
      return true;
    },
  };
}

// --- Driver --------------------------------------------------------------------------------

export interface Win32DriverOptions {
  readonly logger?: Logger;
  /** Defaults to `process.platform`; injected in tests to prove honest degradation. */
  readonly platform?: NodeJS.Platform;
  /** Injected native fake; takes precedence over `loadNative`. */
  readonly native?: Win32NativeApi;
  /** Injected loader so the unit tests can simulate a missing koffi addon. */
  readonly loadNative?: () => Win32NativeApi;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly verifyAttempts?: number;
  readonly verifyDelayMs?: number;
}

type NativeState =
  | { readonly ok: true; readonly api: Win32NativeApi }
  | { readonly ok: false; readonly reason: string };

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function uniqueRefs(windows: readonly WindowRef[]): readonly WindowRef[] {
  const seen = new Set<string>();
  const result: WindowRef[] = [];
  for (const window of windows) {
    if (seen.has(window.handle)) continue;
    seen.add(window.handle);
    result.push(window);
  }
  return result;
}

/**
 * Windows focus driver. `capabilities()` is honest about a missing koffi addon and about
 * elevated windows it cannot see (UIPI); every aside/restore is verified by polling the real
 * window state, so the driver never reports a change it did not observe (INV-5).
 */
export class Win32Driver implements FocusDriver {
  readonly name = 'win32';

  readonly #logger: Logger;
  readonly #platform: NodeJS.Platform;
  readonly #options: Win32DriverOptions;
  readonly #sleep: (delayMs: number) => Promise<void>;
  readonly #verifyAttempts: number;
  readonly #verifyDelayMs: number;
  #nativeState: NativeState | undefined;
  #skippedElevated = 0;

  constructor(options: Win32DriverOptions = {}) {
    this.#options = options;
    this.#logger = options.logger ?? noopLogger;
    this.#platform = options.platform ?? process.platform;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#verifyAttempts = Math.max(1, options.verifyAttempts ?? DEFAULT_VERIFY_ATTEMPTS);
    this.#verifyDelayMs = Math.max(0, options.verifyDelayMs ?? DEFAULT_VERIFY_DELAY_MS);
  }

  capabilities(): AgentCapabilities {
    if (this.#platform !== 'win32') {
      return {
        focus: 'unsupported',
        reasons: [`Windows window control requires win32 (this process runs on ${this.#platform})`],
      };
    }
    const native = this.#native();
    if (!native.ok) {
      return { focus: 'unsupported', reasons: [native.reason] };
    }
    const reasons: string[] = [];
    if (this.#skippedElevated > 0) {
      reasons.push(
        `${this.#skippedElevated} elevated or protected window(s) skipped (UIPI): the Focus Agent is not running as administrator`,
      );
    }
    return { focus: 'full', ...(reasons.length === 0 ? {} : { reasons }) };
  }

  async listWindows(): Promise<readonly WindowRef[]> {
    const api = this.#requireNative();
    const { candidates, skippedElevated } = selectFocusWindows(api.enumerate());
    this.#skippedElevated = skippedElevated;
    const refs: WindowRef[] = [];
    const seen = new Set<string>();
    for (const info of candidates) {
      const ref = windowInfoToRef(info);
      if (ref === undefined || seen.has(ref.handle)) continue;
      seen.add(ref.handle);
      refs.push(ref);
    }
    return refs;
  }

  /**
   * Re-enumerates before touching anything: the OS may have changed since `listWindows`, and a
   * recycled HWND must never be minimised. Returns only windows observed as iconic afterwards.
   */
  async asideWindows(windows: readonly WindowRef[]): Promise<readonly WindowRef[]> {
    const api = this.#requireNative();
    const requested = uniqueRefs(windows);
    if (requested.length === 0) return [];

    const current = this.#snapshot(api);
    const issued: Win32WindowInfo[] = [];
    const issuedRefs = new Map<string, WindowRef>();
    for (const ref of requested) {
      const info = current.byHandle.get(ref.handle);
      if (info === undefined) continue;
      // Denied (elevated) windows have no executable identity and were already counted by
      // #snapshot; `windowMatchesRef` also rejects them.
      if (!isReachableTopLevel(info) || info.accessDenied) continue;
      if (!windowMatchesRef(ref, info)) continue;
      if (!api.showMinNoActivate(ref.handle)) continue;
      issued.push(info);
      issuedRefs.set(ref.handle, ref);
    }
    if (issued.length === 0) return [];

    const verified = await this.#waitForIconic(
      api,
      issued.map((info) => info.handle),
      true,
    );
    return verified
      .map((handle) => issuedRefs.get(handle))
      .filter((ref): ref is WindowRef => ref !== undefined);
  }

  /**
   * Restores only journaled handles that still exist, still belong to the same executable and
   * are still iconic (i.e. the driver's own aside is still in effect).
   */
  async restore(plan: RestorePlan): Promise<readonly WindowRef[]> {
    const api = this.#requireNative();
    const requested = uniqueRefs(plan.windows);
    if (requested.length === 0) return [];

    const current = this.#snapshot(api);
    const issuedRefs = new Map<string, WindowRef>();
    for (const ref of requested) {
      if (!api.isWindow(ref.handle)) continue;
      const info = current.byHandle.get(ref.handle);
      if (info === undefined || !windowMatchesRef(ref, info)) continue;
      if (!info.iconic) continue;
      if (!api.showRestore(ref.handle)) continue;
      issuedRefs.set(ref.handle, ref);
    }
    if (issuedRefs.size === 0) return [];

    const verified = await this.#waitForIconic(api, [...issuedRefs.keys()], false);
    return verified
      .map((handle) => issuedRefs.get(handle))
      .filter((ref): ref is WindowRef => ref !== undefined);
  }

  /**
   * One enumeration for both the UIPI count and handle lookups. Every enumerated window is kept
   * (denied ones too) so callers can distinguish "gone" from "cannot touch".
   */
  #snapshot(api: Win32NativeApi): {
    readonly byHandle: ReadonlyMap<string, Win32WindowInfo>;
  } {
    const enumerated = api.enumerate();
    this.#skippedElevated = selectFocusWindows(enumerated).skippedElevated;
    return { byHandle: new Map(enumerated.map((info) => [info.handle, info])) };
  }

  /** Bounded retry against the real window state; returns the handles that reached `expected`. */
  async #waitForIconic(
    api: Win32NativeApi,
    handles: readonly string[],
    expected: boolean,
  ): Promise<readonly string[]> {
    let satisfied: readonly string[] = [];
    for (let attempt = 0; attempt < this.#verifyAttempts; attempt += 1) {
      if (attempt > 0 && this.#verifyDelayMs > 0) await this.#sleep(this.#verifyDelayMs);
      satisfied = handles.filter((handle) => api.isIconic(handle) === expected);
      if (satisfied.length === handles.length) return satisfied;
    }
    this.#logger.warn('Win32 ShowWindow result could not be verified for every window', {
      expectedIconic: expected,
      verified: satisfied.length,
      requested: handles.length,
    });
    return satisfied;
  }

  #native(): NativeState {
    if (this.#nativeState !== undefined) return this.#nativeState;
    if (this.#platform !== 'win32') {
      this.#nativeState = { ok: false, reason: 'Win32 bindings are only available on win32' };
      return this.#nativeState;
    }
    try {
      const api = this.#options.native ?? this.#options.loadNative?.() ?? createWin32NativeApi();
      this.#nativeState = { ok: true, api };
    } catch {
      this.#nativeState = {
        ok: false,
        reason: 'koffi/Win32 bindings could not be loaded; Windows window control is unavailable',
      };
    }
    return this.#nativeState;
  }

  #requireNative(): Win32NativeApi {
    if (this.#platform !== 'win32') {
      throw new Win32DriverError('Windows driver can only run on win32');
    }
    const native = this.#native();
    if (!native.ok) throw new Win32DriverError(native.reason);
    return native.api;
  }
}
