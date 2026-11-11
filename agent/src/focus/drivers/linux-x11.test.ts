// focus/drivers/linux-x11.test.ts — pure + scripted tests for the Linux X11 driver (T-054).
// No Linux desktop exists in this session, so real wmctrl/xdotool behaviour is CI/NEEDS-HUMAN.
// An injected command runner proves the parts that matter: Wayland and missing tools degrade to
// `unsupported` with a reason, `wmctrl -l -p` is parsed for id/pid ONLY (never the title column),
// and every command is an execFile argument array with a validated window id.

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { WindowRef } from '../../allowlist.js';
import { noopLogger } from '../../log.js';
import { CommandError, type CommandRunner } from './exec.js';
import {
  isX11WindowId,
  LinuxX11Driver,
  LinuxX11DriverError,
  parseWmctrlListing,
  type LinuxX11DriverOptions,
  type ProcessNameReader,
} from './linux-x11.js';

const SESSION_ID = '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f';
const WMCTRL = '/usr/bin/wmctrl';
const XDOTOOL = '/usr/bin/xdotool';

interface Call {
  readonly file: string;
  readonly args: readonly string[];
}

/** In-memory wmctrl/xdotool with a configurable listing, /proc map and failure predicate. */
class FakeX11 {
  listing = '';
  readonly comms = new Map<number, string>();
  readonly calls: Call[] = [];
  readonly tools: Record<string, string | undefined> = { wmctrl: WMCTRL, xdotool: XDOTOOL };
  failWhen: (file: string, args: readonly string[]) => boolean = () => false;

  readonly runner: CommandRunner = async (file, args) => {
    this.calls.push({ file, args: [...args] });
    if (this.failWhen(file, args)) {
      throw new CommandError(path.basename(file), 1, 'boom');
    }
    if (file.endsWith('wmctrl') && args[0] === '-l') return { stdout: this.listing, stderr: '' };
    return { stdout: '', stderr: '' };
  };

  readonly findTool = (name: string): string | undefined => this.tools[name];
  readonly readProcessName: ProcessNameReader = (pid) => this.comms.get(pid);
}

interface Harness {
  readonly os: FakeX11;
  readonly driver: LinuxX11Driver;
}

function makeHarness(
  overrides: Partial<LinuxX11DriverOptions> = {},
  configure: (os: FakeX11) => void = () => undefined,
): Harness {
  const os = new FakeX11();
  configure(os);
  const driver = new LinuxX11Driver({
    platform: 'linux',
    env: { PATH: '/usr/bin', DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' },
    commandRunner: os.runner,
    findTool: os.findTool,
    readProcessName: os.readProcessName,
    logger: noopLogger,
    ...overrides,
  });
  return { os, driver };
}

function refFor(handle: string, identifier: string, appKey: string): WindowRef {
  return { handle, appKey, identifier };
}

const LISTING = [
  '0x03A00001  0 2000 host Private Document https://secret.example/account',
  '0x03a00002  0 0 host Ghost',
  '0x03a00003  0 2001 host code',
  'not-an-id 0 2002 host ignored',
  '0x03a00004  0 2003 host no-comm',
].join('\n');

function seedListing(os: FakeX11): void {
  os.listing = LISTING;
  os.comms.set(2000, 'code');
  os.comms.set(2001, 'google-chrome');
  os.comms.set(2002, 'ignored');
  // 2003 deliberately absent from /proc.
}

describe('X11 window-id validation', () => {
  it('accepts only hexadecimal 0x window ids', () => {
    expect(isX11WindowId('0x03a00007')).toBe(true);
    expect(isX11WindowId('0XAAbb')).toBe(true);
    for (const invalid of ['12345', '0x', '0xZZ', '0x1;rm -rf /', '--all', '']) {
      expect(isX11WindowId(invalid), invalid).toBe(false);
    }
  });
});

describe('wmctrl listing parsing (id/pid only — INV-6)', () => {
  it('reads the id and pid columns and never the title column', () => {
    const os = new FakeX11();
    seedListing(os);
    const refs = parseWmctrlListing(os.listing, os.readProcessName, new Set());

    expect(refs.map((ref) => ref.handle)).toEqual(['0x03a00001', '0x03a00003']);
    expect(refs.map((ref) => ref.appKey)).toEqual(['code', 'google-chrome']);
    const serialized = JSON.stringify(refs);
    expect(serialized).not.toContain('Private');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('Ghost');
    expect(serialized).not.toContain('host');
  });

  it('honours the excluded-PID set (the agent itself)', () => {
    const os = new FakeX11();
    seedListing(os);
    const refs = parseWmctrlListing(os.listing, os.readProcessName, new Set([2000]));
    expect(refs.map((ref) => ref.handle)).toEqual(['0x03a00003']);
  });

  it('ignores malformed lines instead of throwing', () => {
    const read = (): string | undefined => 'code';
    expect(parseWmctrlListing('', read)).toEqual([]);
    expect(parseWmctrlListing('garbage\n0x0000\n', read)).toEqual([]);
    expect(parseWmctrlListing('   \n\t\n', read)).toEqual([]);
  });

  it('rejects non-numeric, zero, negative, oversized and duplicate rows', () => {
    const read = (): string | undefined => 'code';
    const listing = [
      '0xAA  0 abc host a', // pid is not numeric
      '0xAB  0 0 host b', // pid 0 can never be a real window process
      '0xAC  0 -5 host c', // negative pid
      '0xAD  0 12345678901 host d', // more digits than a PID can have
      '0xAE  0 42 host e',
      '0xae  0 42 host f', // same window id, different case
    ].join('\r\n');
    expect(parseWmctrlListing(listing, read).map((ref) => ref.handle)).toEqual(['0xae']);
  });

  it('splits on any run of whitespace and tolerates CRLF listings', () => {
    const read = (): string | undefined => 'code';
    const refs = parseWmctrlListing('0x03A0000F\t0\t2000\thost\ttitle', read);
    expect(refs).toEqual([{ handle: '0x03a0000f', appKey: 'code', identifier: 'code' }]);
  });
});

describe('Linux capabilities — Wayland and missing tools (FR-005)', () => {
  it('reports full control on X11 with both tools', () => {
    const { driver } = makeHarness();
    expect(driver.capabilities()).toEqual({ focus: 'full' });
  });

  it('reports unsupported on Wayland and refuses to start focus', async () => {
    const { os, driver } = makeHarness({
      env: { PATH: '/usr/bin', DISPLAY: ':0', XDG_SESSION_TYPE: 'wayland' },
    });
    const capabilities = driver.capabilities();
    expect(capabilities.focus).toBe('unsupported');
    expect(capabilities.reasons?.[0]).toMatch(/Wayland/);
    await expect(driver.listWindows()).rejects.toBeInstanceOf(LinuxX11DriverError);
    expect(os.calls).toEqual([]);
  });

  it('detects Wayland from WAYLAND_DISPLAY when DISPLAY is absent', () => {
    const { driver } = makeHarness({
      env: { PATH: '/usr/bin', WAYLAND_DISPLAY: 'wayland-0' },
    });
    expect(driver.capabilities().focus).toBe('unsupported');
    expect(driver.capabilities().reasons?.[0]).toMatch(/Wayland/);
  });

  it('treats a Wayland session with XWayland DISPLAY as Wayland', () => {
    const { driver } = makeHarness({
      env: { PATH: '/usr/bin', DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' },
    });
    expect(driver.capabilities().focus).toBe('unsupported');
    expect(driver.capabilities().reasons?.[0]).toMatch(/Wayland/);
  });

  it('trusts an explicit X11 session type over a stray WAYLAND_DISPLAY', () => {
    const { driver } = makeHarness({
      env: {
        PATH: '/usr/bin',
        DISPLAY: ':0',
        WAYLAND_DISPLAY: 'wayland-0',
        XDG_SESSION_TYPE: 'x11',
      },
    });
    expect(driver.capabilities()).toEqual({ focus: 'full' });
  });

  it('reports unsupported when DISPLAY is not set', () => {
    const { driver } = makeHarness({ env: { PATH: '/usr/bin' } });
    expect(driver.capabilities().focus).toBe('unsupported');
    expect(driver.capabilities().reasons?.[0]).toMatch(/DISPLAY/);
  });

  it('reports unsupported when wmctrl is missing', () => {
    const { driver } = makeHarness({}, (os) => {
      os.tools.wmctrl = undefined;
    });
    expect(driver.capabilities().focus).toBe('unsupported');
    expect(driver.capabilities().reasons?.[0]).toMatch(/wmctrl/);
  });

  it('reports unsupported when xdotool is missing', () => {
    const { driver } = makeHarness({}, (os) => {
      os.tools.xdotool = undefined;
    });
    expect(driver.capabilities().focus).toBe('unsupported');
    expect(driver.capabilities().reasons?.[0]).toMatch(/xdotool/);
  });

  it('reports unsupported on a non-Linux platform', () => {
    const { driver } = makeHarness({ platform: 'darwin' });
    expect(driver.capabilities().focus).toBe('unsupported');
    expect(driver.capabilities().reasons?.[0]).toMatch(/linux/);
  });
});

describe('Linux listWindows', () => {
  it('lists the parsed windows with wmctrl -l -p', async () => {
    const { os, driver } = makeHarness({}, seedListing);
    const windows = await driver.listWindows();
    expect(windows.map((ref) => ref.handle)).toEqual(['0x03a00001', '0x03a00003']);
    expect(os.calls).toEqual([{ file: WMCTRL, args: ['-l', '-p'] }]);
  });

  it('exposes only handle/appKey/identifier', async () => {
    const { driver } = makeHarness({}, seedListing);
    const windows = await driver.listWindows();
    expect(Object.keys(windows[0] ?? {}).sort()).toEqual(['appKey', 'handle', 'identifier']);
  });
});

describe('Linux aside', () => {
  it('minimises each live, matching window with an argument array', async () => {
    const { os, driver } = makeHarness({}, seedListing);
    const changed = await driver.asideWindows([
      refFor('0x03A00001', 'code', 'code'),
      refFor('0x03a00003', 'google-chrome', 'google-chrome'),
    ]);
    expect(changed.map((ref) => ref.handle)).toEqual(['0x03a00001', '0x03a00003']);
    expect(os.calls.slice(1)).toEqual([
      { file: XDOTOOL, args: ['windowminimize', '0x03a00001'] },
      { file: XDOTOOL, args: ['windowminimize', '0x03a00003'] },
    ]);
  });

  it('skips unknown ids, invalid ids and handles now owned by another process', async () => {
    const { os, driver } = makeHarness({}, seedListing);
    const changed = await driver.asideWindows([
      refFor('0xdeadbeef', 'code', 'code'),
      refFor('$(rm -rf /)', 'code', 'code'),
      refFor('0x03a00001', 'firefox', 'firefox'),
    ]);
    expect(changed).toEqual([]);
    expect(os.calls.filter((call) => call.file === XDOTOOL)).toEqual([]);
  });

  it('returns only the windows whose command succeeded', async () => {
    const { os, driver } = makeHarness({}, seedListing);
    os.failWhen = (file, args) => file === XDOTOOL && args[1] === '0x03a00001';
    const changed = await driver.asideWindows([
      refFor('0x03a00001', 'code', 'code'),
      refFor('0x03a00003', 'google-chrome', 'google-chrome'),
    ]);
    expect(changed.map((ref) => ref.handle)).toEqual(['0x03a00003']);
  });

  it('returns [] for an empty list without spawning anything', async () => {
    const { os, driver } = makeHarness({}, seedListing);
    await expect(driver.asideWindows([])).resolves.toEqual([]);
    expect(os.calls).toEqual([]);
  });
});

describe('Linux restore', () => {
  it('restores journaled windows with wmctrl remove,hidden', async () => {
    const { os, driver } = makeHarness({}, seedListing);
    const restored = await driver.restore({
      sessionId: SESSION_ID,
      windows: [
        refFor('0x03a00001', 'code', 'code'),
        refFor('0x03a00003', 'google-chrome', 'google-chrome'),
      ],
    });
    expect(restored.map((ref) => ref.handle)).toEqual(['0x03a00001', '0x03a00003']);
    expect(os.calls.slice(1)).toEqual([
      { file: WMCTRL, args: ['-i', '-r', '0x03a00001', '-b', 'remove,hidden'] },
      { file: WMCTRL, args: ['-i', '-r', '0x03a00003', '-b', 'remove,hidden'] },
    ]);
  });

  it('falls back to xdotool windowmap when wmctrl fails for one window', async () => {
    const { os, driver } = makeHarness({}, seedListing);
    os.failWhen = (file, args) => file === WMCTRL && args[2] === '0x03a00001';
    const restored = await driver.restore({
      sessionId: SESSION_ID,
      windows: [
        refFor('0x03a00001', 'code', 'code'),
        refFor('0x03a00003', 'google-chrome', 'google-chrome'),
      ],
    });
    expect(restored.map((ref) => ref.handle)).toEqual(['0x03a00001', '0x03a00003']);
    expect(os.calls.slice(1)).toEqual([
      { file: WMCTRL, args: ['-i', '-r', '0x03a00001', '-b', 'remove,hidden'] },
      { file: XDOTOOL, args: ['windowmap', '0x03a00001'] },
      { file: WMCTRL, args: ['-i', '-r', '0x03a00003', '-b', 'remove,hidden'] },
    ]);
  });

  it('skips a window that no longer exists or changed process', async () => {
    const { os, driver } = makeHarness({}, seedListing);
    const restored = await driver.restore({
      sessionId: SESSION_ID,
      windows: [
        refFor('0xdeadbeef', 'code', 'code'),
        refFor('0x03a00001', 'firefox', 'firefox'),
        refFor('0x03a00004', 'code', 'code'),
      ],
    });
    expect(restored).toEqual([]);
    expect(os.calls.filter((call) => call.args[0] === '-i')).toEqual([]);
  });

  it('returns [] for an empty plan without spawning anything', async () => {
    const { os, driver } = makeHarness({}, seedListing);
    await expect(driver.restore({ sessionId: SESSION_ID, windows: [] })).resolves.toEqual([]);
    expect(os.calls).toEqual([]);
  });

  it('reports nothing when wmctrl and the xdotool fallback both fail', async () => {
    const debug = vi.fn();
    const { os, driver } = makeHarness(
      { logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug } },
      seedListing,
    );
    os.failWhen = (file, args) =>
      (file === WMCTRL && args[0] === '-i') || (file === XDOTOOL && args[0] === 'windowmap');

    await expect(
      driver.restore({
        sessionId: SESSION_ID,
        windows: [refFor('0x03a00001', 'code', 'code')],
      }),
    ).resolves.toEqual([]);
    expect(os.calls.slice(1)).toEqual([
      { file: WMCTRL, args: ['-i', '-r', '0x03a00001', '-b', 'remove,hidden'] },
      { file: XDOTOOL, args: ['windowmap', '0x03a00001'] },
    ]);
    expect(debug).toHaveBeenCalledWith(
      'xdotool windowmap fallback failed',
      expect.objectContaining({ handle: '0x03a00001' }),
    );
  });
});

describe('Linux defaults (no injected seams)', () => {
  it('resolves wmctrl and xdotool from PATH', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'focus-x11-tools-'));
    try {
      for (const tool of [path.basename(WMCTRL), path.basename(XDOTOOL)]) {
        const file = path.join(directory, tool);
        writeFileSync(file, '#!/bin/sh\nexit 0\n');
        chmodSync(file, 0o755);
      }
      const driver = new LinuxX11Driver({
        platform: 'linux',
        env: { PATH: directory, DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' },
        commandRunner: async () => ({ stdout: '', stderr: '' }),
        readProcessName: () => undefined,
        logger: noopLogger,
      });
      expect(driver.capabilities()).toEqual({ focus: 'full' });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports unsupported when PATH has no wmctrl (default finder)', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'focus-x11-empty-'));
    try {
      const driver = new LinuxX11Driver({
        platform: 'linux',
        env: { PATH: directory, DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' },
        commandRunner: async () => ({ stdout: '', stderr: '' }),
        logger: noopLogger,
      });
      expect(driver.capabilities().focus).toBe('unsupported');
      expect(driver.capabilities().reasons?.[0]).toMatch(/wmctrl/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reads process names from /proc and treats an unreadable entry as unknown', async () => {
    const os = new FakeX11();
    // 4294967295 is outside every Linux PID range, so /proc cannot have it.
    os.listing = '0x03a00009  0 4294967295 host Private Document';
    const driver = new LinuxX11Driver({
      platform: 'linux',
      env: { PATH: '/usr/bin', DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' },
      commandRunner: os.runner,
      findTool: os.findTool,
      logger: noopLogger,
    });
    await expect(driver.listWindows()).resolves.toEqual([]);
  });
});

describe('Linux identity matching', () => {
  it('matches a journaled ref that has no identifier by its window id alone', async () => {
    const { os, driver } = makeHarness({}, seedListing);
    const changed = await driver.asideWindows([{ handle: '0x03A00001', appKey: 'code' }]);
    expect(changed).toEqual([{ handle: '0x03a00001', appKey: 'code' }]);
    expect(os.calls.at(-1)).toEqual({
      file: XDOTOOL,
      args: ['windowminimize', '0x03a00001'],
    });
  });
});
