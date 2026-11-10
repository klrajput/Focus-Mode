// focus/drivers/darwin.ts — macOS focus driver using one-shot JXA through osascript (T-053).
// TECHNICAL_DESIGN §7.5 + DEC-005: every operation is a separate `osascript -l JavaScript`
// invocation, and every state change is verified in *another* invocation with bounded retries.
// The JXA return value of hide()/unhide() is not trustworthy, and state read inside the same
// process is stale (spike S-2), so both are never relied on. Only `activationPolicy == 0`
// ("regular") apps are enumerated and only `bundleIdentifier` / `localizedName` are read: no
// window titles, PIDs or URLs ever leave this module (INV-6). Journal handles are bundle ids.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentCapabilities, AppEntry } from '@focus-mode/shared';
import type { WindowRef } from '../../allowlist.js';
import { noopLogger, type Logger } from '../../log.js';
import type { FocusDriver, RestorePlan } from '../driver.js';
import { appKeyFromBundleId } from './app-key.js';
import { CommandError, findExecutable, runCommand, type CommandRunner } from './exec.js';

// ---------------------------------------------------------------------------
// JXA programs. They are written to a private temp directory at first use and passed to
// osascript as a *file path*, so nothing is ever interpolated into a shell string. The `--`
// separator required by the driver contract arrives as argv[0]; each program strips it.
// ---------------------------------------------------------------------------

const ENUMERATE_SCRIPT = `
ObjC.import('AppKit');

function text(value) {
  try {
    if (value === undefined || value === null) { return ''; }
    var unwrapped = ObjC.unwrap(value);
    if (unwrapped === undefined || unwrapped === null) { return ''; }
    var result = String(unwrapped);
    if (result === 'undefined' || result === 'null') { return ''; }
    return result;
  } catch (error) {
    return '';
  }
}

function run() {
  var workspace = $.NSWorkspace.sharedWorkspace;
  var apps = workspace.runningApplications;
  var count = Number(apps.count);
  var found = [];
  for (var i = 0; i < count; i += 1) {
    var app = apps.objectAtIndex(i);
    if (Number(app.terminated) === 1) { continue; }
    if (Number(app.activationPolicy) !== 0) { continue; }
    var bundleId = text(app.bundleIdentifier);
    if (bundleId.length === 0) { continue; }
    found.push({
      bundleId: bundleId,
      name: text(app.localizedName),
      hidden: Number(app.hidden) === 1
    });
  }
  return JSON.stringify(found);
}
`;

const HIDE_SCRIPT = `
ObjC.import('AppKit');

function text(value) {
  try {
    if (value === undefined || value === null) { return ''; }
    var unwrapped = ObjC.unwrap(value);
    if (unwrapped === undefined || unwrapped === null) { return ''; }
    var result = String(unwrapped);
    if (result === 'undefined' || result === 'null') { return ''; }
    return result;
  } catch (error) {
    return '';
  }
}

function requestedIds(argv) {
  var args = argv;
  if (args.length > 0 && String(args[0]) === '--') { args = args.slice(1); }
  var ids = {};
  for (var i = 0; i < args.length; i += 1) { ids[String(args[i])] = true; }
  return ids;
}

function run(argv) {
  var ids = requestedIds(argv);
  var workspace = $.NSWorkspace.sharedWorkspace;
  var apps = workspace.runningApplications;
  var count = Number(apps.count);
  var matched = 0;
  for (var i = 0; i < count; i += 1) {
    var app = apps.objectAtIndex(i);
    if (Number(app.terminated) === 1) { continue; }
    if (Number(app.activationPolicy) !== 0) { continue; }
    var bundleId = text(app.bundleIdentifier);
    if (ids[bundleId] !== true) { continue; }
    // A single unresponsive app must not abort the whole operation; verification decides.
    try { app.hide(); matched += 1; } catch (error) { /* verification is the truth */ }
  }
  return JSON.stringify({ matched: matched });
}
`;

const UNHIDE_SCRIPT = `
ObjC.import('AppKit');

function text(value) {
  try {
    if (value === undefined || value === null) { return ''; }
    var unwrapped = ObjC.unwrap(value);
    if (unwrapped === undefined || unwrapped === null) { return ''; }
    var result = String(unwrapped);
    if (result === 'undefined' || result === 'null') { return ''; }
    return result;
  } catch (error) {
    return '';
  }
}

function requestedIds(argv) {
  var args = argv;
  if (args.length > 0 && String(args[0]) === '--') { args = args.slice(1); }
  var ids = {};
  for (var i = 0; i < args.length; i += 1) { ids[String(args[i])] = true; }
  return ids;
}

function run(argv) {
  var ids = requestedIds(argv);
  var workspace = $.NSWorkspace.sharedWorkspace;
  var apps = workspace.runningApplications;
  var count = Number(apps.count);
  var matched = 0;
  for (var i = 0; i < count; i += 1) {
    var app = apps.objectAtIndex(i);
    if (Number(app.terminated) === 1) { continue; }
    if (Number(app.activationPolicy) !== 0) { continue; }
    var bundleId = text(app.bundleIdentifier);
    if (ids[bundleId] !== true) { continue; }
    try { app.unhide(); matched += 1; } catch (error) { /* verification is the truth */ }
  }
  return JSON.stringify({ matched: matched });
}
`;

const STATE_SCRIPT = `
ObjC.import('AppKit');

function text(value) {
  try {
    if (value === undefined || value === null) { return ''; }
    var unwrapped = ObjC.unwrap(value);
    if (unwrapped === undefined || unwrapped === null) { return ''; }
    var result = String(unwrapped);
    if (result === 'undefined' || result === 'null') { return ''; }
    return result;
  } catch (error) {
    return '';
  }
}

function requestedIds(argv) {
  var args = argv;
  if (args.length > 0 && String(args[0]) === '--') { args = args.slice(1); }
  var ids = {};
  for (var i = 0; i < args.length; i += 1) { ids[String(args[i])] = true; }
  return ids;
}

function run(argv) {
  var ids = requestedIds(argv);
  var workspace = $.NSWorkspace.sharedWorkspace;
  var apps = workspace.runningApplications;
  var count = Number(apps.count);
  var states = [];
  for (var i = 0; i < count; i += 1) {
    var app = apps.objectAtIndex(i);
    if (Number(app.terminated) === 1) { continue; }
    var bundleId = text(app.bundleIdentifier);
    if (ids[bundleId] !== true) { continue; }
    states.push({ bundleId: bundleId, hidden: Number(app.hidden) === 1 });
  }
  return JSON.stringify(states);
}
`;

const DEFAULT_BROWSER_SCRIPT = `
ObjC.import('AppKit');

function text(value) {
  try {
    if (value === undefined || value === null) { return ''; }
    var unwrapped = ObjC.unwrap(value);
    if (unwrapped === undefined || unwrapped === null) { return ''; }
    var result = String(unwrapped);
    if (result === 'undefined' || result === 'null') { return ''; }
    return result;
  } catch (error) {
    return '';
  }
}

function run() {
  var schemes = ['https://example.com/', 'http://example.com/'];
  for (var i = 0; i < schemes.length; i += 1) {
    var url = $.NSURL.URLWithString(schemes[i]);
    var appUrl = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL(url);
    if (appUrl === undefined || appUrl === null) { continue; }
    var appPath = '';
    try { appPath = text(appUrl.path); } catch (error) { appPath = ''; }
    if (appPath.length === 0) { continue; }
    var bundleId = '';
    try {
      var bundle = $.NSBundle.bundleWithPath(appUrl.path);
      if (bundle !== undefined && bundle !== null && !bundle.isNil()) {
        bundleId = text(bundle.bundleIdentifier);
      }
    } catch (error) {
      bundleId = '';
    }
    if (bundleId.length > 0) {
      return JSON.stringify({ bundleId: bundleId, path: appPath });
    }
  }
  return JSON.stringify({});
}
`;

type DarwinScriptName = 'enumerate' | 'hide' | 'unhide' | 'state' | 'default-browser';

const SCRIPTS: Readonly<Record<DarwinScriptName, string>> = Object.freeze({
  enumerate: ENUMERATE_SCRIPT,
  hide: HIDE_SCRIPT,
  unhide: UNHIDE_SCRIPT,
  state: STATE_SCRIPT,
  'default-browser': DEFAULT_BROWSER_SCRIPT,
});

/** Injected in tests; receives a script *path* plus the argv array appended after `--`. */
export type OsascriptInvoker = (scriptPath: string, args: readonly string[]) => Promise<string>;

let scriptDirectory: string | undefined;

/** Materialises the JXA programs once per process into a 0700 directory. */
function scriptPathFor(script: DarwinScriptName): string {
  if (scriptDirectory === undefined) {
    scriptDirectory = mkdtempSync(path.join(tmpdir(), 'focus-jxa-'));
    for (const [name, source] of Object.entries(SCRIPTS)) {
      writeFileSync(path.join(scriptDirectory, `${name}.js`), source, { mode: 0o600 });
    }
  }
  return path.join(scriptDirectory, `${script}.js`);
}

export const DEFAULT_BROWSER_APP_KEY = 'default-browser';

/** A bundle id must look like `com.vendor.App`; JXA can surface nil identifiers as text. */
const BUNDLE_ID = /^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z0-9][A-Za-z0-9.-]*$/;

const OSASCRIPT_CANDIDATES = ['/usr/bin/osascript', '/usr/local/bin/osascript'] as const;
const OSASCRIPT_TIMEOUT_MS = 10_000;
const DEFAULT_VERIFY_ATTEMPTS = 3;
const DEFAULT_VERIFY_DELAY_MS = 150;
const MAX_BUNDLE_IDS = 200;

export class DarwinDriverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DarwinDriverError';
  }
}

/** One regular (`activationPolicy == 0`) macOS app; no titles, no PIDs. */
export interface RawRunningApp {
  readonly bundleId: string;
  readonly name: string;
  readonly hidden: boolean;
}

export interface DarwinDriverOptions {
  readonly logger?: Logger;
  /** Defaults to `process.platform`; tests inject other values to prove honest degradation. */
  readonly platform?: NodeJS.Platform;
  /** `null` disables the driver (capabilities report unsupported). */
  readonly osascriptPath?: string | null;
  readonly invoker?: OsascriptInvoker;
  readonly commandRunner?: CommandRunner;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly verifyAttempts?: number;
  readonly verifyDelayMs?: number;
  /** Used by the tests to bypass PATH discovery without spawning anything. */
  readonly pathValue?: string;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseEnumeratedApps(stdout: string): readonly RawRunningApp[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed))
    throw new DarwinDriverError('osascript enumerate returned a non-array');
  const apps: RawRunningApp[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) continue;
    const { bundleId, name, hidden } = entry;
    if (typeof bundleId !== 'string' || typeof name !== 'string' || typeof hidden !== 'boolean') {
      continue;
    }
    apps.push({ bundleId, name, hidden });
  }
  return apps;
}

function parseHiddenStates(stdout: string): readonly { bundleId: string; hidden: boolean }[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) throw new DarwinDriverError('osascript state returned a non-array');
  const states: { bundleId: string; hidden: boolean }[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) continue;
    const { bundleId, hidden } = entry;
    if (typeof bundleId === 'string' && typeof hidden === 'boolean') {
      states.push({ bundleId, hidden });
    }
  }
  return states;
}

function parseDefaultBrowser(
  stdout: string,
): { readonly bundleId: string; readonly path: string } | undefined {
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed)) return undefined;
  const { bundleId, path: appPath } = parsed;
  if (typeof bundleId !== 'string' || !BUNDLE_ID.test(bundleId.trim())) return undefined;
  if (typeof appPath !== 'string' || appPath.trim().length === 0) return undefined;
  return { bundleId: bundleId.trim(), path: appPath.trim() };
}

/**
 * Maps enumeration output to `WindowRef`s. Hidden apps are not visible focus candidates and
 * `.background`/`.accessory` apps are excluded by the JXA program itself. `localizedName` is
 * deliberately not copied into the ref: the journal stores bundle ids only (INV-6).
 */
export function runningAppsToWindowRefs(apps: readonly RawRunningApp[]): readonly WindowRef[] {
  const refs: WindowRef[] = [];
  const seen = new Set<string>();
  for (const app of apps) {
    if (app.hidden) continue;
    const bundleId = app.bundleId.trim();
    if (!BUNDLE_ID.test(bundleId) || seen.has(bundleId)) continue;
    const appKey = appKeyFromBundleId(bundleId);
    if (appKey === undefined) continue;
    seen.add(bundleId);
    refs.push({ handle: bundleId, appKey, identifier: bundleId });
  }
  return refs;
}

/** Bundle ids for a set of refs, deduplicated, bounded, and only plausible bundle ids. */
export function bundleIdsFromWindows(windows: readonly WindowRef[]): readonly string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const window of windows) {
    const candidate = (window.identifier ?? window.handle).trim();
    // A bundle id must look like `com.vendor.App`; anything else cannot be hidden via JXA.
    if (!BUNDLE_ID.test(candidate)) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    ids.push(candidate);
    if (ids.length >= MAX_BUNDLE_IDS) break;
  }
  return ids;
}

/**
 * macOS window control. On a non-darwin platform, or without a working osascript binary, it
 * reports `unsupported` with a reason so the dashboard blocks Start instead of pretending
 * (FR-005). All destructive operations are verified from a separate invocation (DEC-005).
 */
export class DarwinDriver implements FocusDriver {
  readonly name = 'darwin';

  readonly #logger: Logger;
  readonly #platform: NodeJS.Platform;
  readonly #osascriptPath: string | null;
  readonly #invokeOsascript: OsascriptInvoker;
  readonly #sleep: (delayMs: number) => Promise<void>;
  readonly #verifyAttempts: number;
  readonly #verifyDelayMs: number;

  constructor(options: DarwinDriverOptions = {}) {
    this.#logger = options.logger ?? noopLogger;
    this.#platform = options.platform ?? process.platform;
    const runner = options.commandRunner ?? runCommand;
    this.#invokeOsascript =
      options.invoker ??
      (async (scriptPath, args) => {
        const osascriptPath = this.#osascriptPath;
        if (osascriptPath === null) throw new DarwinDriverError('osascript is not available');
        const result = await runner(
          osascriptPath,
          ['-l', 'JavaScript', scriptPath, '--', ...args],
          { timeoutMs: OSASCRIPT_TIMEOUT_MS },
        );
        return result.stdout;
      });
    if (options.osascriptPath !== undefined) {
      this.#osascriptPath = options.osascriptPath;
    } else if (options.invoker !== undefined) {
      // Injected invoker: availability was decided by the caller (tests).
      this.#osascriptPath = '/usr/bin/osascript';
    } else {
      this.#osascriptPath =
        findExecutable('osascript', options.pathValue ?? process.env.PATH, OSASCRIPT_CANDIDATES) ??
        null;
    }
    this.#sleep = options.sleep ?? defaultSleep;
    this.#verifyAttempts = Math.max(1, options.verifyAttempts ?? DEFAULT_VERIFY_ATTEMPTS);
    this.#verifyDelayMs = Math.max(0, options.verifyDelayMs ?? DEFAULT_VERIFY_DELAY_MS);
  }

  capabilities(): AgentCapabilities {
    if (this.#platform !== 'darwin') {
      return {
        focus: 'unsupported',
        reasons: [`macOS window control requires darwin (this process runs on ${this.#platform})`],
      };
    }
    if (this.#osascriptPath === null) {
      return {
        focus: 'unsupported',
        reasons: ['osascript was not found; macOS window control is unavailable'],
      };
    }
    return { focus: 'full' };
  }

  /** Visible regular apps as focus candidates (protected matching happens in `allowlist.ts`). */
  async listWindows(): Promise<readonly WindowRef[]> {
    this.#assertPlatform();
    const apps = await this.#runJson('enumerate', [], parseEnumeratedApps);
    return runningAppsToWindowRefs(apps);
  }

  /**
   * Hides the given apps and returns only the ones a *separate* state invocation verified as
   * hidden. Apps already hidden by the user, not running, or failing verification are not
   * reported as changed, so the journal never claims a window this driver did not move (INV-5).
   */
  async asideWindows(windows: readonly WindowRef[]): Promise<readonly WindowRef[]> {
    this.#assertPlatform();
    const ids = bundleIdsFromWindows(windows);
    if (ids.length === 0) return [];

    const before = await this.#readHiddenStates(ids);
    const toHide = ids.filter((id) => before.get(id) === false);
    if (toHide.length === 0) return [];

    await this.#runJson('hide', toHide, () => undefined);
    const verified = new Set(await this.#waitForHidden(toHide, true));
    return this.#refsForIds(windows, verified);
  }

  /**
   * Unhides only journaled bundle ids that are currently running *and still hidden*, then
   * verifies in a separate invocation. Apps the user restored manually are left untouched.
   */
  async restore(plan: RestorePlan): Promise<readonly WindowRef[]> {
    this.#assertPlatform();
    const ids = bundleIdsFromWindows(plan.windows);
    if (ids.length === 0) return [];

    const before = await this.#readHiddenStates(ids);
    const toRestore = ids.filter((id) => before.get(id) === true);
    if (toRestore.length === 0) return [];

    await this.#runJson('unhide', toRestore, () => undefined);
    const verified = new Set(await this.#waitForHidden(toRestore, false));
    return this.#refsForIds(plan.windows, verified);
  }

  /**
   * Resolves the OS default browser (DEC-006, spike S-3) as a runtime protected entry. Failure
   * is non-fatal: the static browser list is already protected (INV-3).
   */
  async resolveDefaultBrowser(): Promise<AppEntry | undefined> {
    if (this.#platform !== 'darwin' || this.#osascriptPath === null) return undefined;
    try {
      const resolved = await this.#runJson('default-browser', [], parseDefaultBrowser);
      if (resolved === undefined) return undefined;
      const label = path.basename(resolved.path, '.app').trim().slice(0, 60);
      return {
        key: DEFAULT_BROWSER_APP_KEY,
        label: label.length >= 2 ? label : 'Default browser',
        mac: [resolved.bundleId],
      };
    } catch (error) {
      this.#logger.warn('Could not resolve the default browser; static browser protection stands', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  async #readHiddenStates(ids: readonly string[]): Promise<ReadonlyMap<string, boolean>> {
    const states = await this.#runJson('state', ids, parseHiddenStates);
    return new Map(states.map((state) => [state.bundleId, state.hidden]));
  }

  /**
   * Bounded retry against a fresh `state` invocation. Returns the ids whose observed hidden
   * flag matches `expected`; callers treat that subset as "actually changed" (DEC-005).
   */
  async #waitForHidden(ids: readonly string[], expected: boolean): Promise<readonly string[]> {
    let satisfied: readonly string[] = [];
    for (let attempt = 0; attempt < this.#verifyAttempts; attempt += 1) {
      if (attempt > 0 && this.#verifyDelayMs > 0) await this.#sleep(this.#verifyDelayMs);
      const states = await this.#readHiddenStates(ids);
      satisfied = ids.filter((id) => states.get(id) === expected);
      if (satisfied.length === ids.length) return satisfied;
    }
    if (satisfied.length < ids.length) {
      this.#logger.warn('macOS hide/unhide was not verified for every app', {
        expected,
        verified: satisfied.length,
        requested: ids.length,
      });
    }
    return satisfied;
  }

  #refsForIds(windows: readonly WindowRef[], verified: ReadonlySet<string>): readonly WindowRef[] {
    const result: WindowRef[] = [];
    const seen = new Set<string>();
    for (const window of windows) {
      const id = (window.identifier ?? window.handle).trim();
      if (!verified.has(id) || seen.has(id)) continue;
      seen.add(id);
      result.push(window);
    }
    return result;
  }

  async #runJson<T>(
    script: DarwinScriptName,
    args: readonly string[],
    parse: (stdout: string) => T,
  ): Promise<T> {
    const scriptPath = scriptPathFor(script);
    let stdout: string;
    try {
      stdout = await this.#invokeOsascript(scriptPath, args);
    } catch (error) {
      if (error instanceof CommandError) throw new DarwinDriverError(error.message);
      throw error instanceof DarwinDriverError
        ? error
        : new DarwinDriverError(`osascript ${script} failed`);
    }
    try {
      return parse(stdout);
    } catch {
      // Never echo stdout: it may contain app names, and no caller needs it.
      throw new DarwinDriverError(`osascript ${script} returned an unreadable result`);
    }
  }

  #assertPlatform(): void {
    if (this.#platform !== 'darwin') {
      throw new DarwinDriverError('macOS driver can only run on darwin');
    }
    if (this.#osascriptPath === null) {
      throw new DarwinDriverError('osascript is not available');
    }
  }
}
