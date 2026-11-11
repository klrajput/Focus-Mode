// focus/drivers/unavailable.test.ts — the honest "no driver" fallback (FR-005).
// On an unsupported platform the agent must advertise `unsupported` (so the dashboard disables
// Start) and refuse window operations loudly instead of silently pretending they worked.

import { describe, expect, it } from 'vitest';
import {
  DRIVER_UNAVAILABLE_MESSAGE,
  DriverUnavailableError,
  UnavailableDriver,
} from './unavailable.js';

describe('UnavailableDriver', () => {
  it('reports unsupported with the documented default reason', () => {
    const driver = new UnavailableDriver();
    expect(driver.name).toBe('unavailable');
    expect(driver.capabilities()).toEqual({
      focus: 'unsupported',
      reasons: [DRIVER_UNAVAILABLE_MESSAGE],
    });
  });

  it('keeps a caller-supplied reason, e.g. the unsupported platform name', () => {
    const driver = new UnavailableDriver('No focus driver exists for platform "freebsd"');
    expect(driver.capabilities()).toEqual({
      focus: 'unsupported',
      reasons: ['No focus driver exists for platform "freebsd"'],
    });
  });

  it('lists no windows, so a caller cannot act on a platform it cannot control', async () => {
    await expect(new UnavailableDriver().listWindows()).resolves.toEqual([]);
  });

  it('refuses aside and restore with an UNSUPPORTED error carrying the reason', async () => {
    const driver = new UnavailableDriver('platform not supported');
    const aside = driver.asideWindows();
    await expect(aside).rejects.toBeInstanceOf(DriverUnavailableError);
    await expect(aside).rejects.toMatchObject({
      code: 'UNSUPPORTED',
      message: 'platform not supported',
    });
    await expect(driver.restore()).rejects.toBeInstanceOf(DriverUnavailableError);
  });
});
