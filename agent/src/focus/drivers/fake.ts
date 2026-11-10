// focus/drivers/fake.ts — the in-memory dev/test driver (T-030).
// It records every call so tests can prove INV-3 (protected apps are never touched) and INV-4
// (journal is written before windows move). `AGENT_FOCUS_DRIVER=fake` is dev/test only and a
// packaged build refuses to start with it (see drivers/index.ts). No OS access whatsoever.

import type { AgentCapabilities } from '@focus-mode/shared';
import type { WindowRef } from '../../allowlist.js';
import type { FocusDriver, RestorePlan } from '../driver.js';

export interface FakeWindowSpec {
  readonly handle: string;
  readonly appKey: string;
  readonly identifier?: string;
  /** Display label (an app name, never a window title — INV-6). */
  readonly appLabel?: string;
  /** A window hidden by the user is not a visible top-level window for focus purposes. */
  readonly visible?: boolean;
}

interface FakeWindow {
  readonly handle: string;
  readonly appKey: string;
  readonly identifier?: string;
  readonly appLabel?: string;
  visible: boolean;
  /** True once the driver moved this window aside (restore flips it back). */
  asided: boolean;
}

export type FakeDriverCallMethod = 'listWindows' | 'asideWindows' | 'restore';

export interface FakeDriverCall {
  readonly method: FakeDriverCallMethod;
  readonly appKeys: readonly string[];
  readonly handles: readonly string[];
}

/** A deterministic `FocusDriver` with a call log. Never reads or stores window titles. */
export class FakeDriver implements FocusDriver {
  readonly name = 'fake';
  readonly #windows = new Map<string, FakeWindow>();
  readonly #callLog: FakeDriverCall[] = [];
  #capabilities: AgentCapabilities;

  constructor(
    windows: readonly FakeWindowSpec[] = [],
    capabilities: AgentCapabilities = { focus: 'full' },
  ) {
    this.#capabilities = capabilities;
    for (const window of windows) this.addWindow(window);
  }

  addWindow(window: FakeWindowSpec): void {
    this.#windows.set(window.handle, {
      handle: window.handle,
      appKey: window.appKey,
      ...(window.identifier === undefined ? {} : { identifier: window.identifier }),
      ...(window.appLabel === undefined ? {} : { appLabel: window.appLabel }),
      visible: window.visible ?? true,
      asided: false,
    });
  }

  setCapabilities(capabilities: AgentCapabilities): void {
    this.#capabilities = capabilities;
  }

  /** Every driver call, oldest first. Tests assert protected apps never appear here. */
  getCallLog(): readonly FakeDriverCall[] {
    return this.#callLog.map((call) => ({
      method: call.method,
      appKeys: [...call.appKeys],
      handles: [...call.handles],
    }));
  }

  resetCallLog(): void {
    this.#callLog.length = 0;
  }

  isAsided(handle: string): boolean {
    return this.#windows.get(handle)?.asided ?? false;
  }

  /** All windows still marked aside — used to assert a clean restore. */
  asidedHandles(): readonly string[] {
    return [...this.#windows.values()].filter((window) => window.asided).map((w) => w.handle);
  }

  capabilities(): AgentCapabilities {
    return this.#capabilities;
  }

  async listWindows(): Promise<readonly WindowRef[]> {
    const visible = [...this.#windows.values()].filter((window) => window.visible);
    this.#callLog.push({
      method: 'listWindows',
      appKeys: visible.map((window) => window.appKey),
      handles: visible.map((window) => window.handle),
    });
    return visible.map((window) => this.toRef(window));
  }

  async asideWindows(windows: readonly WindowRef[]): Promise<readonly WindowRef[]> {
    this.#callLog.push({
      method: 'asideWindows',
      appKeys: windows.map((window) => window.appKey),
      handles: windows.map((window) => window.handle),
    });
    const changed: WindowRef[] = [];
    for (const ref of windows) {
      const window = this.#windows.get(ref.handle);
      if (window === undefined || !window.visible || window.asided) continue;
      window.asided = true;
      changed.push(this.toRef(window));
    }
    return changed;
  }

  async restore(plan: RestorePlan): Promise<readonly WindowRef[]> {
    this.#callLog.push({
      method: 'restore',
      appKeys: plan.windows.map((window) => window.appKey),
      handles: plan.windows.map((window) => window.handle),
    });
    const restored: WindowRef[] = [];
    for (const ref of plan.windows) {
      const window = this.#windows.get(ref.handle);
      if (window === undefined || !window.asided) continue;
      window.asided = false;
      restored.push(this.toRef(window));
    }
    return restored;
  }

  private toRef(window: FakeWindow): WindowRef {
    return {
      handle: window.handle,
      appKey: window.appKey,
      ...(window.identifier === undefined ? {} : { identifier: window.identifier }),
    };
  }
}
