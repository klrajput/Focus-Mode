// focus/driver.ts — the one OS boundary of the Focus Agent (TECHNICAL_DESIGN §7.1/§7.5).
// Every platform driver (Windows, macOS, Linux X11, and the dev/test FakeDriver) implements
// this interface, so the controller, link server and UI never contain OS-specific code (INV-1).
// `WindowRef` carries opaque handles and app identifiers only — never window titles or URLs
// (INV-6). Drivers must return only *visible top-level* windows from `listWindows()`.

import type { AgentCapabilities } from '@focus-mode/shared';
import type { WindowRef } from '../allowlist.js';

/** What a restore must undo: only the windows the journal says this agent moved aside. */
export interface RestorePlan {
  readonly sessionId: string;
  readonly windows: readonly WindowRef[];
}

/** One OS window-management implementation. All methods are async because drivers spawn. */
export interface FocusDriver {
  /** Stable driver name for logs/status: `fake`, `win32`, `darwin`, `linux-x11`. */
  readonly name: string;
  /** Honest capability flag; `unsupported` must block `enterFocus` (FR-005). */
  capabilities(): AgentCapabilities;
  /** Visible top-level windows, identified without titles/URLs (INV-6). */
  listWindows(): Promise<readonly WindowRef[]>;
  /** Moves the given windows aside and resolves to the subset it actually changed. */
  asideWindows(windows: readonly WindowRef[]): Promise<readonly WindowRef[]>;
  /** Restores exactly the journaled windows that still exist and are still aside. */
  restore(plan: RestorePlan): Promise<readonly WindowRef[]>;
}
