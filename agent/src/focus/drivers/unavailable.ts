// focus/drivers/unavailable.ts — honest driver for a platform without a real driver.
// The Windows/macOS/Linux implementations live in this directory (T-052/T-053/T-054); this class
// remains the answer for an unsupported platform or a build where the configured driver is not
// available. `capabilities.focus = 'unsupported'` makes the dashboard disable Start instead of
// the agent pretending to move windows (FR-005). Nothing here touches the OS.

import type { AgentCapabilities } from '@focus-mode/shared';
import type { WindowRef } from '../../allowlist.js';
import type { FocusDriver } from '../driver.js';

export const DRIVER_UNAVAILABLE_MESSAGE =
  'Real OS window control is not available for this platform.';

export class DriverUnavailableError extends Error {
  readonly code = 'UNSUPPORTED';

  constructor(message: string = DRIVER_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = 'DriverUnavailableError';
  }
}

/** A driver that truthfully reports it cannot manage windows on this platform. */
export class UnavailableDriver implements FocusDriver {
  readonly name = 'unavailable';
  readonly #reason: string;

  constructor(reason: string = DRIVER_UNAVAILABLE_MESSAGE) {
    this.#reason = reason;
  }

  capabilities(): AgentCapabilities {
    return { focus: 'unsupported', reasons: [this.#reason] };
  }

  async listWindows(): Promise<readonly WindowRef[]> {
    return [];
  }

  async asideWindows(): Promise<readonly WindowRef[]> {
    throw new DriverUnavailableError(this.#reason);
  }

  async restore(): Promise<readonly WindowRef[]> {
    throw new DriverUnavailableError(this.#reason);
  }
}
