// focus/drivers/index.ts — driver selection with the packaged-build guard (AGENTS §8).
// `fake` is a development/test driver and must never ship: selecting it in a packaged build is
// a fatal configuration error rather than a silent downgrade of the safety model.
// Real drivers are added here in W3 without changing the controller.

import type { AgentConfig } from '../../config/env.js';
import type { Logger } from '../../log.js';
import type { FocusDriver } from '../driver.js';
import { FakeDriver } from './fake.js';
import { UnavailableDriver } from './unavailable.js';

export class FakeDriverNotAllowedError extends Error {
  constructor() {
    super('AGENT_FOCUS_DRIVER=fake is not allowed in a packaged Focus Agent build');
    this.name = 'FakeDriverNotAllowedError';
  }
}

export interface CreateFocusDriverOptions {
  readonly configured: AgentConfig['driver'];
  readonly isPackaged: boolean;
  readonly logger: Logger;
}

/** Resolves the driver for this process. Throws when a packaged build asks for `fake`. */
export function createFocusDriver(options: CreateFocusDriverOptions): FocusDriver {
  if (options.configured === 'fake') {
    if (options.isPackaged) throw new FakeDriverNotAllowedError();
    options.logger.warn('FakeDriver active — development/test only, never packaged');
    return new FakeDriver();
  }
  return new UnavailableDriver();
}
