// focus/drivers/unavailable.ts — honest placeholder for W1, when only the FakeDriver exists.
// Real window control is W3 (T-052 Windows, T-053 macOS, T-054 Linux X11). Until then a
// `real` build reports `capabilities.focus = 'unsupported'` so the dashboard disables Start
// instead of the agent pretending to move windows. Nothing here touches the OS.

import type { AgentCapabilities } from '@focus-mode/shared';
import type { WindowRef } from '../../allowlist.js';
import type { FocusDriver } from '../driver.js';

export const DRIVER_UNAVAILABLE_MESSAGE =
  'Real OS window control is not available in this build (W3: T-052/T-053/T-054). ' +
  'Set AGENT_FOCUS_DRIVER=fake for development and tests.';

export class DriverUnavailableError extends Error {
  readonly code = 'UNSUPPORTED';

  constructor() {
    super(DRIVER_UNAVAILABLE_MESSAGE);
    this.name = 'DriverUnavailableError';
  }
}

/** A driver that truthfully reports it cannot manage windows yet. */
export class UnavailableDriver implements FocusDriver {
  readonly name = 'unavailable';

  capabilities(): AgentCapabilities {
    return { focus: 'unsupported', reasons: [DRIVER_UNAVAILABLE_MESSAGE] };
  }

  async listWindows(): Promise<readonly WindowRef[]> {
    return [];
  }

  async asideWindows(): Promise<readonly WindowRef[]> {
    throw new DriverUnavailableError();
  }

  async restore(): Promise<readonly WindowRef[]> {
    throw new DriverUnavailableError();
  }
}
