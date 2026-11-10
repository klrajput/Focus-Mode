// focus/drivers/linux-x11.ts — Linux X11 focus driver through wmctrl/xdotool (T-054).
// X11 only: Wayland has no way for an unprivileged app to minimise another app's window, so
// `capabilities().focus` is `unsupported` with a reason and the dashboard blocks Start (FR-005).
// Commands run via execFile with argument arrays (never a shell string). `wmctrl -l -p` output is
// parsed for exactly two fields — window id and PID — and the process name comes from
// /proc/<pid>/comm, so window titles are never read or copied (INV-6). Aside =
// `xdotool windowminimize <id>`; restore = `wmctrl -i -r <id> -b remove,hidden`, with
// `xdotool windowmap <id>` as the fallback.
//
// Honest limitation: X11 exposes no title-free, dependency-free way to ask "is this window
// minimised?" (that needs xprop/_NET_WM_STATE), so this driver reports a window as changed when
// `xdotool windowminimize` exits 0. Windows/macOS verify every operation against live state.
// Real X11 behaviour is CI/NEEDS-HUMAN evidence: no Linux desktop exists in this session.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentCapabilities } from '@focus-mode/shared';
import type { WindowRef } from '../../allowlist.js';
import { noopLogger, type Logger } from '../../log.js';
import type { FocusDriver, RestorePlan } from '../driver.js';
import { appKeyFromExecutableName } from './app-key.js';
import { findExecutable, runCommand, type CommandRunner } from './exec.js';

const WMCTRL = 'wmctrl';
const XDOTOOL = 'xdotool';
/** X11 window ids look like `0x03a00007`. Strict, so nothing else can reach an argv slot. */
const X11_WINDOW_ID = /^0x[0-9a-f]{1,16}$/i;

export class LinuxX11DriverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinuxX11DriverError';
  }
}

/** Reads `/proc/<pid>/comm`; injected in tests (no /proc on macOS). */
export type ProcessNameReader = (pid: number) => string | undefined;

export type ToolFinder = (name: string) => string | undefined;

export interface LinuxX11DriverOptions {
  readonly logger?: Logger;
  /** Defaults to `process.platform`; tests inject other values. */
  readonly platform?: NodeJS.Platform;
  /** Injection seam for XDG_SESSION_TYPE / DISPLAY / PATH. */
  readonly env?: NodeJS.ProcessEnv;
  readonly commandRunner?: CommandRunner;
  readonly findTool?: ToolFinder;
  readonly readProcessName?: ProcessNameReader;
}

type LinuxCapabilities =
  | { readonly focus: 'unsupported'; readonly reason: string }
  | { readonly focus: 'full'; readonly wmctrl: string; readonly xdotool: string };

interface ToolPaths {
  readonly wmctrl: string;
  readonly xdotool: string;
}

/** True when the id is safe to pass to wmctrl/xdotool as its own argv element. */
export function isX11WindowId(handle: string): boolean {
  return X11_WINDOW_ID.test(handle.trim());
}

/**
 * Parses `wmctrl -l -p`. Columns are `id desktop pid host title…`; only `id` and `pid` are read
 * — the remainder (which contains the title) is never sliced, stored, logged or returned.
 */
export function parseWmctrlListing(
  stdout: string,
  readProcessName: ProcessNameReader,
  excludePids: ReadonlySet<number> = new Set(),
): readonly WindowRef[] {
  const refs: WindowRef[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const columns = trimmed.split(/\s+/);
    const rawId = columns[0];
    const rawPid = columns[2];
    if (rawId === undefined || rawPid === undefined) continue;
    if (!X11_WINDOW_ID.test(rawId)) continue;
    if (!/^\d{1,10}$/.test(rawPid)) continue;
    const pid = Number.parseInt(rawPid, 10);
    if (pid <= 0 || excludePids.has(pid)) continue;
    const handle = rawId.toLowerCase();
    if (seen.has(handle)) continue;
    const processName = readProcessName(pid)?.trim();
    if (processName === undefined || processName.length === 0) continue;
    const appKey = appKeyFromExecutableName(processName);
    if (appKey === undefined) continue;
    seen.add(handle);
    refs.push({ handle, appKey, identifier: processName });
  }
  return refs;
}

function defaultProcessNameReader(pid: number): string | undefined {
  try {
    const name = readFileSync(path.join('/proc', String(pid), 'comm'), 'utf8').trim();
    return name.length === 0 ? undefined : name;
  } catch {
    return undefined;
  }
}

/**
 * Detects the session type and runtime dependencies exactly once. Wayland (or a missing
 * display) is reported before tool detection so the reason is specific and actionable.
 */
function detectLinuxSupport(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  findTool: ToolFinder,
): LinuxCapabilities {
  if (platform !== 'linux') {
    return {
      focus: 'unsupported',
      reason: `Linux window control requires linux (this process runs on ${platform})`,
    };
  }
  const session = env.XDG_SESSION_TYPE?.trim().toLowerCase();
  const display = env.DISPLAY?.trim();
  const waylandDisplay = env.WAYLAND_DISPLAY?.trim();
  // A Wayland session usually has XWayland's DISPLAY set too, so WAYLAND_DISPLAY is only
  // overridden by an explicit X11 session type.
  const isWayland =
    session === 'wayland' ||
    (session !== 'x11' && waylandDisplay !== undefined && waylandDisplay.length > 0);
  if (isWayland) {
    return {
      focus: 'unsupported',
      reason: 'Wayland does not allow focus control; log in with an X11 session to use focus',
    };
  }
  if (display === undefined || display.length === 0) {
    return { focus: 'unsupported', reason: 'No X11 DISPLAY is set for this session' };
  }
  const wmctrl = findTool(WMCTRL);
  if (wmctrl === undefined) {
    return {
      focus: 'unsupported',
      reason: 'wmctrl was not found; install wmctrl to enable focus on Linux X11',
    };
  }
  const xdotool = findTool(XDOTOOL);
  if (xdotool === undefined) {
    return {
      focus: 'unsupported',
      reason: 'xdotool was not found; install xdotool to enable focus on Linux X11',
    };
  }
  return { focus: 'full', wmctrl, xdotool };
}

function uniqueRefs(windows: readonly WindowRef[]): readonly WindowRef[] {
  const seen = new Set<string>();
  const result: WindowRef[] = [];
  for (const window of windows) {
    const handle = window.handle.toLowerCase();
    if (seen.has(handle)) continue;
    seen.add(handle);
    result.push(window);
  }
  return result;
}

function identifiersMatch(ref: WindowRef, current: WindowRef): boolean {
  const identifier = ref.identifier?.trim().toLowerCase();
  if (identifier === undefined || identifier.length === 0) return true;
  return current.identifier?.trim().toLowerCase() === identifier;
}

/**
 * Linux X11 focus driver. The session/tool probe is synchronous and cached, so `capabilities()`
 * can answer `hello` without spawning anything.
 */
export class LinuxX11Driver implements FocusDriver {
  readonly name = 'linux-x11';

  readonly #logger: Logger;
  readonly #env: NodeJS.ProcessEnv;
  readonly #runner: CommandRunner;
  readonly #readProcessName: ProcessNameReader;
  readonly #excludePids: ReadonlySet<number>;
  readonly #capabilities: LinuxCapabilities;

  constructor(options: LinuxX11DriverOptions = {}) {
    this.#logger = options.logger ?? noopLogger;
    this.#env = options.env ?? process.env;
    this.#runner = options.commandRunner ?? runCommand;
    this.#readProcessName = options.readProcessName ?? defaultProcessNameReader;
    const findTool: ToolFinder =
      options.findTool ??
      ((name) => {
        const candidates =
          name === WMCTRL
            ? ['/usr/bin/wmctrl', '/usr/local/bin/wmctrl']
            : ['/usr/bin/xdotool', '/usr/local/bin/xdotool'];
        return findExecutable(name, this.#env.PATH, candidates);
      });
    const platform = options.platform ?? process.platform;
    this.#capabilities = detectLinuxSupport(platform, this.#env, findTool);
    const ownPid = process.pid;
    this.#excludePids = new Set([ownPid]);
  }

  capabilities(): AgentCapabilities {
    return this.#capabilities.focus === 'full'
      ? { focus: 'full' }
      : { focus: 'unsupported', reasons: [this.#capabilities.reason] };
  }

  async listWindows(): Promise<readonly WindowRef[]> {
    const tools = this.#requireTools();
    return this.#listing(tools);
  }

  /**
   * Minimises the given windows after re-listing the X server (so a recycled id never receives a
   * command). Returns the refs whose `windowminimize` invocation exited successfully.
   */
  async asideWindows(windows: readonly WindowRef[]): Promise<readonly WindowRef[]> {
    const tools = this.#requireTools();
    const requested = uniqueRefs(windows);
    if (requested.length === 0) return [];

    const current = new Map((await this.#listing(tools)).map((ref) => [ref.handle, ref]));
    const changed: WindowRef[] = [];
    for (const ref of requested) {
      const handle = ref.handle.trim().toLowerCase();
      if (!isX11WindowId(handle)) continue;
      const live = current.get(handle);
      if (live === undefined || !identifiersMatch(ref, live)) continue;
      try {
        await this.#runner(tools.xdotool, ['windowminimize', handle]);
        changed.push({ ...ref, handle });
      } catch (error) {
        this.#logger.debug('xdotool windowminimize failed', {
          handle,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return changed;
  }

  /**
   * Restores journaled ids that still exist (and still belong to the same process). Uses
   * `wmctrl -i -r <id> -b remove,hidden` and falls back to `xdotool windowmap` per window.
   */
  async restore(plan: RestorePlan): Promise<readonly WindowRef[]> {
    const tools = this.#requireTools();
    const requested = uniqueRefs(plan.windows);
    if (requested.length === 0) return [];

    const current = new Map((await this.#listing(tools)).map((ref) => [ref.handle, ref]));
    const restored: WindowRef[] = [];
    for (const ref of requested) {
      const handle = ref.handle.trim().toLowerCase();
      if (!isX11WindowId(handle)) continue;
      const live = current.get(handle);
      if (live === undefined || !identifiersMatch(ref, live)) continue;
      let ok = false;
      try {
        await this.#runner(tools.wmctrl, ['-i', '-r', handle, '-b', 'remove,hidden']);
        ok = true;
      } catch {
        try {
          await this.#runner(tools.xdotool, ['windowmap', handle]);
          ok = true;
        } catch (fallbackError) {
          this.#logger.debug('xdotool windowmap fallback failed', {
            handle,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
          });
        }
      }
      if (ok) restored.push({ ...ref, handle });
    }
    return restored;
  }

  async #listing(tools: ToolPaths): Promise<readonly WindowRef[]> {
    const result = await this.#runner(tools.wmctrl, ['-l', '-p']);
    return parseWmctrlListing(result.stdout, this.#readProcessName, this.#excludePids);
  }

  #requireTools(): ToolPaths {
    const state = this.#capabilities;
    if (state.focus !== 'full') throw new LinuxX11DriverError(state.reason);
    return { wmctrl: state.wmctrl, xdotool: state.xdotool };
  }
}
