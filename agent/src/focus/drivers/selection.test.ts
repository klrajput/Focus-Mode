// focus/drivers/selection.test.ts — driver selection, the packaged-fake guard and the
// `detectCapabilities()` helper used by `hello` (AGENTS §8, FR-005, FR-011).
// Everything is injected (platform/env/native seams), so this suite covers all four selection
// branches on any developer OS without loading koffi or spawning osascript/wmctrl.

import { describe, expect, it, vi } from 'vitest';
import { agentCapabilitiesSchema, type AgentCapabilities, type AppEntry } from '@focus-mode/shared';
import { noopLogger, type Logger } from '../../log.js';
import { DarwinDriver } from './darwin.js';
import { FakeDriver } from './fake.js';
import {
  createFocusDriver,
  detectCapabilities,
  driverNameForPlatform,
  FakeDriverNotAllowedError,
  resolveConfiguredDriver,
  resolveRuntimeProtectedApps,
  UnknownFocusDriverError,
} from './index.js';
import { LinuxX11Driver } from './linux-x11.js';
import { UnavailableDriver } from './unavailable.js';
import { Win32Driver } from './win32.js';

function spyLogger(): Logger & {
  readonly warn: ReturnType<typeof vi.fn>;
  readonly info: ReturnType<typeof vi.fn>;
} {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  } as Logger & {
    readonly warn: ReturnType<typeof vi.fn>;
    readonly info: ReturnType<typeof vi.fn>;
  };
}

describe('resolveConfiguredDriver (AGENT_FOCUS_DRIVER)', () => {
  it('defaults to real, the only acceptable packaged value', () => {
    expect(resolveConfiguredDriver({})).toBe('real');
    expect(resolveConfiguredDriver({ AGENT_FOCUS_DRIVER: 'real' })).toBe('real');
    expect(resolveConfiguredDriver({ AGENT_FOCUS_DRIVER: '' })).toBe('real');
  });

  it('accepts fake for development, case-insensitively', () => {
    expect(resolveConfiguredDriver({ AGENT_FOCUS_DRIVER: 'fake' })).toBe('fake');
    expect(resolveConfiguredDriver({ AGENT_FOCUS_DRIVER: ' FAKE ' })).toBe('fake');
  });

  it('fails loudly on an unknown value instead of silently choosing real', () => {
    expect(() => resolveConfiguredDriver({ AGENT_FOCUS_DRIVER: 'auto' })).toThrow(
      UnknownFocusDriverError,
    );
    try {
      resolveConfiguredDriver({ AGENT_FOCUS_DRIVER: 'auto' });
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownFocusDriverError);
      expect((error as UnknownFocusDriverError).value).toBe('auto');
    }
  });
});

describe('driverNameForPlatform', () => {
  it('maps every supported platform and rejects the rest', () => {
    expect(driverNameForPlatform('darwin')).toBe('darwin');
    expect(driverNameForPlatform('win32')).toBe('win32');
    expect(driverNameForPlatform('linux')).toBe('linux-x11');
    expect(driverNameForPlatform('freebsd')).toBe('unavailable');
    expect(driverNameForPlatform('aix')).toBe('unavailable');
  });
});

describe('createFocusDriver', () => {
  it('refuses the fake driver in a packaged build', () => {
    expect(() =>
      createFocusDriver({ configured: 'fake', isPackaged: true, logger: noopLogger }),
    ).toThrow(FakeDriverNotAllowedError);
  });

  it('allows the fake driver only outside packaged builds, warning loudly', () => {
    const logger = spyLogger();
    const driver = createFocusDriver({ configured: 'fake', isPackaged: false, logger });
    expect(driver).toBeInstanceOf(FakeDriver);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('selects the macOS driver on darwin', () => {
    const driver = createFocusDriver({
      configured: 'real',
      isPackaged: true,
      platform: 'darwin',
      logger: noopLogger,
    });
    expect(driver).toBeInstanceOf(DarwinDriver);
    expect(driver.name).toBe('darwin');
  });

  it('selects the Windows driver on win32', () => {
    const driver = createFocusDriver({
      configured: 'real',
      isPackaged: true,
      platform: 'win32',
      logger: noopLogger,
    });
    expect(driver).toBeInstanceOf(Win32Driver);
    expect(driver.name).toBe('win32');
  });

  it('selects the X11 driver on linux', () => {
    const driver = createFocusDriver({
      configured: 'real',
      isPackaged: true,
      platform: 'linux',
      env: { PATH: '/usr/bin', DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' },
      logger: noopLogger,
    });
    expect(driver).toBeInstanceOf(LinuxX11Driver);
    expect(driver.name).toBe('linux-x11');
  });

  it('falls back to UnavailableDriver on an unsupported platform', () => {
    const driver = createFocusDriver({
      configured: 'real',
      isPackaged: true,
      platform: 'freebsd',
      logger: noopLogger,
    });
    expect(driver).toBeInstanceOf(UnavailableDriver);
    expect(driver.capabilities().focus).toBe('unsupported');
    expect(driver.capabilities().reasons?.[0]).toMatch(/freebsd/);
  });

  it('reads AGENT_FOCUS_DRIVER when configured is omitted', () => {
    const driver = createFocusDriver({
      isPackaged: false,
      env: { AGENT_FOCUS_DRIVER: 'fake' },
      logger: noopLogger,
    });
    expect(driver).toBeInstanceOf(FakeDriver);
  });

  it('rejects an invalid AGENT_FOCUS_DRIVER', () => {
    expect(() =>
      createFocusDriver({
        isPackaged: false,
        env: { AGENT_FOCUS_DRIVER: 'nope' },
        logger: noopLogger,
      }),
    ).toThrow(UnknownFocusDriverError);
  });
});

describe('detectCapabilities (hello)', () => {
  it('returns schema-valid capabilities from a driver', () => {
    const capabilities = detectCapabilities(new FakeDriver([], { focus: 'partial' }));
    expect(capabilities).toEqual({ focus: 'partial' });
    expect(agentCapabilitiesSchema.safeParse(capabilities).success).toBe(true);
  });

  it('accepts a capability function', () => {
    expect(detectCapabilities(() => ({ focus: 'full' }))).toEqual({ focus: 'full' });
  });

  it('never throws when the driver throws', () => {
    const capabilities = detectCapabilities(() => {
      throw new Error('driver exploded');
    });
    expect(capabilities.focus).toBe('unsupported');
    expect(capabilities.reasons?.[0]).toMatch(/failed to report capabilities/);
  });

  it('degrades an out-of-schema capability to unsupported', () => {
    const invalid = { focus: 'everything' } as unknown as AgentCapabilities;
    expect(detectCapabilities(() => invalid).focus).toBe('unsupported');
  });

  it('degrades a non-object capability report to unsupported', () => {
    for (const invalid of [null, 'full', 42, undefined]) {
      const capabilities = detectCapabilities(() => invalid as unknown as AgentCapabilities);
      expect(capabilities.focus, String(invalid)).toBe('unsupported');
      expect(capabilities.reasons?.[0]).toMatch(/invalid capabilities/);
    }
  });

  it('drops non-string reasons instead of forwarding them', () => {
    const raw = { focus: 'partial', reasons: [42, null, '  keep me  '] };
    const capabilities = detectCapabilities(() => raw as unknown as AgentCapabilities);
    expect(capabilities).toEqual({ focus: 'partial', reasons: ['keep me'] });
  });

  it('trims, bounds and caps reasons to the frozen wire schema', () => {
    const reasons = Array.from({ length: 12 }, (_, index) => `  reason ${index}  `);
    const capabilities = detectCapabilities(() => ({ focus: 'partial', reasons }));
    expect(capabilities.reasons).toHaveLength(10);
    for (const reason of capabilities.reasons ?? []) {
      expect(reason).toBe(reason.trim());
      expect(reason.length).toBeLessThanOrEqual(200);
    }
  });

  it('drops empty reasons and omits the field when nothing remains', () => {
    const capabilities = detectCapabilities(() => ({ focus: 'full', reasons: ['   '] }));
    expect(capabilities).toEqual({ focus: 'full' });
  });

  it('reports the current platform driver honestly', () => {
    const driver = createFocusDriver({
      configured: 'real',
      isPackaged: true,
      logger: noopLogger,
      platform: process.platform,
    });
    const capabilities = detectCapabilities(driver);
    expect(agentCapabilitiesSchema.safeParse(capabilities).success).toBe(true);
  });
});

describe('resolveRuntimeProtectedApps (DEC-006)', () => {
  const browser: AppEntry = {
    key: 'default-browser',
    label: 'Default browser',
    mac: ['com.example.ExampleBrowser'],
  };

  it('returns the macOS default browser as a runtime protected entry', async () => {
    const additions = await resolveRuntimeProtectedApps({
      platform: 'darwin',
      darwin: { resolveDefaultBrowser: async () => browser },
    });
    expect(additions).toEqual([browser]);
  });

  it('returns [] when the default browser could not be resolved', async () => {
    const additions = await resolveRuntimeProtectedApps({
      platform: 'darwin',
      darwin: { resolveDefaultBrowser: async () => undefined },
    });
    expect(additions).toEqual([]);
  });

  it('returns [] on Windows/Linux without touching a driver', async () => {
    for (const platform of ['win32', 'linux', 'freebsd'] as const) {
      const additions = await resolveRuntimeProtectedApps({
        platform,
        darwin: {
          resolveDefaultBrowser: async () => {
            throw new Error('must not be called');
          },
        },
      });
      expect(additions, platform).toEqual([]);
    }
  });

  it('never throws when resolution fails', async () => {
    const additions = await resolveRuntimeProtectedApps({
      platform: 'darwin',
      darwin: {
        resolveDefaultBrowser: async () => {
          throw new Error('lookup failed');
        },
      },
    });
    expect(additions).toEqual([]);
  });
});
