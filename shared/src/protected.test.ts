// shared/src/protected.test.ts — INV-3 guard tests for the hard-coded protected set.
// Proves: every entry is schema-valid, the set resolves per OS, identifier-based clones cannot
// smuggle a browser in, and any attempt to remove a protected key throws PROTECTED_ENTRY.

import { describe, expect, it } from 'vitest';
import {
  ALL_PROTECTED_KEYS,
  FOCUS_AGENT_APP_KEY,
  PROTECTED_BY_OS,
  ProtectedEntryError,
  assertNoProtectedRemoval,
  isProtectedEntry,
  isProtectedKey,
  protectedKeysForOs,
} from './protected.js';
import { APP_KEY_PATTERN, appEntrySchema, type AppEntry } from './schemas/app.js';
import { ERROR_CODES } from './errors.js';

const MACOS_CRITICAL_KEYS = [
  'finder',
  'dock',
  'system-ui-server',
  'login-window',
  'control-center',
  'notification-center',
  'spotlight',
  'system-settings',
  'activity-monitor',
];

const WINDOWS_CRITICAL_KEYS = [
  'explorer',
  'dwm',
  'csrss',
  'winlogon',
  'search-host',
  'start-menu-experience-host',
  'shell-experience-host',
  'text-input-host',
  'lock-app',
  'task-manager',
  'system-settings',
  'application-frame-host',
];

const LINUX_CRITICAL_KEYS = [
  'gnome-shell',
  'plasma-shell',
  'xfce-panel',
  'mate-panel',
  'cinnamon',
  'lxpanel',
];

const keysOf = (entries: readonly AppEntry[]): string[] => entries.map((entry) => entry.key);

describe('protected set data', () => {
  it('has entries for all three supported OSes', () => {
    expect(PROTECTED_BY_OS.macOS.length).toBeGreaterThan(0);
    expect(PROTECTED_BY_OS.windows.length).toBeGreaterThan(0);
    expect(PROTECTED_BY_OS.linux.length).toBeGreaterThan(0);
  });

  it('is frozen at the record and per-OS array level (hard-coded contract)', () => {
    expect(Object.isFrozen(PROTECTED_BY_OS)).toBe(true);
    expect(Object.isFrozen(PROTECTED_BY_OS.macOS)).toBe(true);
    expect(Object.isFrozen(PROTECTED_BY_OS.windows)).toBe(true);
    expect(Object.isFrozen(PROTECTED_BY_OS.linux)).toBe(true);
  });

  it('every entry is a schema-valid app entry with a legal key', () => {
    for (const os of ['macOS', 'windows', 'linux'] as const) {
      expect(PROTECTED_BY_OS[os].length).toBeGreaterThan(0);
      for (const entry of PROTECTED_BY_OS[os]) {
        expect(appEntrySchema.safeParse(entry).success).toBe(true);
        expect(entry.key).toMatch(APP_KEY_PATTERN);
        expect(entry.label.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('keys are unique within each OS set', () => {
    for (const os of ['macOS', 'windows', 'linux'] as const) {
      const keys = keysOf(PROTECTED_BY_OS[os]);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('ALL_PROTECTED_KEYS is the sorted union of every entry', () => {
    const union = [...new Set(Object.values(PROTECTED_BY_OS).flatMap(keysOf))];
    expect(ALL_PROTECTED_KEYS.length).toBe(union.length);
    expect([...ALL_PROTECTED_KEYS].sort()).toEqual([...union].sort());
    expect(Object.isFrozen(ALL_PROTECTED_KEYS)).toBe(true);
  });

  it('contains every known browser on the OSes where it exists', () => {
    for (const os of ['macOS', 'windows', 'linux'] as const) {
      for (const browser of ['chrome', 'edge', 'firefox']) {
        expect(isProtectedKey(browser, os)).toBe(true);
      }
    }
    for (const browser of ['brave', 'opera', 'vivaldi']) {
      expect(isProtectedKey(browser, 'windows')).toBe(true);
      expect(isProtectedKey(browser, 'macOS')).toBe(true);
    }
    expect(isProtectedKey('safari', 'macOS')).toBe(true);
    expect(isProtectedKey('safari', 'windows')).toBe(false);
    expect(isProtectedKey('arc', 'macOS')).toBe(true);
  });

  it('contains the Focus Agent itself on every OS (it must never hide its own tray)', () => {
    expect(isProtectedKey(FOCUS_AGENT_APP_KEY)).toBe(true);
    for (const os of ['macOS', 'windows', 'linux'] as const) {
      expect(isProtectedKey(FOCUS_AGENT_APP_KEY, os)).toBe(true);
    }
  });

  it('contains the OS-critical processes from TECHNICAL_DESIGN §7.5', () => {
    for (const key of WINDOWS_CRITICAL_KEYS) expect(isProtectedKey(key, 'windows')).toBe(true);
    for (const key of MACOS_CRITICAL_KEYS) expect(isProtectedKey(key, 'macOS')).toBe(true);
    for (const key of LINUX_CRITICAL_KEYS) expect(isProtectedKey(key, 'linux')).toBe(true);
    // Task Manager / Activity Monitor are protected on purpose: the escape hatch is always open.
    expect(isProtectedKey('task-manager', 'windows')).toBe(true);
    expect(isProtectedKey('activity-monitor', 'macOS')).toBe(true);
  });

  it('does not protect arbitrary user apps', () => {
    expect(isProtectedKey('slack')).toBe(false);
    expect(isProtectedKey('vscode', 'macOS')).toBe(false);
  });

  it('protectedKeysForOs returns the per-OS keys and is frozen', () => {
    expect(protectedKeysForOs('macOS')).toEqual(keysOf(PROTECTED_BY_OS.macOS));
    expect(Object.isFrozen(protectedKeysForOs('linux'))).toBe(true);
    expect(protectedKeysForOs('windows').length).toBeGreaterThanOrEqual(18);
  });
});

describe('isProtectedEntry', () => {
  it('resolves entries by key on the matching OS', () => {
    const chrome = { key: 'chrome', label: 'Google Chrome', mac: ['com.google.Chrome'] };
    expect(isProtectedEntry(chrome, 'macOS')).toBe(true);
    expect(isProtectedEntry({ ...chrome, mac: ['com.google.Chrome'] }, 'windows')).toBe(true);
  });

  it('resolves entries by per-OS identifier even under a new key (clone attack blocked)', () => {
    const clone: AppEntry = {
      key: 'my-browser',
      label: 'My Browser',
      mac: ['com.google.Chrome'],
      win: ['chrome.exe'],
    };
    expect(isProtectedEntry(clone, 'macOS')).toBe(true);
    expect(isProtectedEntry(clone, 'windows')).toBe(true);
    const upperCase: AppEntry = { key: 'sneaky', label: 'Sneaky', win: ['EXPLORER.EXE'] };
    expect(isProtectedEntry(upperCase, 'windows')).toBe(true);
  });

  it('does not resolve protected entries on an OS where they do not exist', () => {
    const safari: AppEntry = { key: 'safari', label: 'Safari', mac: ['com.apple.Safari'] };
    expect(isProtectedEntry(safari, 'macOS')).toBe(true);
    expect(isProtectedEntry(safari, 'windows')).toBe(false);
    const finder: AppEntry = { key: 'finder', label: 'Finder', mac: ['com.apple.finder'] };
    expect(isProtectedEntry(finder, 'linux')).toBe(false);
  });

  it('lets genuinely user apps through', () => {
    const slack: AppEntry = {
      key: 'slack',
      label: 'Slack',
      win: ['slack.exe'],
      mac: ['com.tinyspeck.slackmacgap'],
    };
    expect(isProtectedEntry(slack, 'windows')).toBe(false);
    expect(isProtectedEntry(slack, 'macOS')).toBe(false);
    expect(isProtectedEntry(slack, 'linux')).toBe(false);
  });

  it('treats a key collision with a protected key as protected', () => {
    expect(isProtectedEntry({ key: 'focus-agent', label: 'Not the agent' }, 'linux')).toBe(true);
  });
});

describe('assertNoProtectedRemoval (INV-3)', () => {
  const current = ['chrome', 'focus-agent', 'finder', 'vscode'];

  it('accepts an unchanged protected list', () => {
    expect(() => assertNoProtectedRemoval(current, [...current])).not.toThrow();
  });

  it('accepts adding new user apps', () => {
    expect(() => assertNoProtectedRemoval(current, [...current, 'slack', 'notion'])).not.toThrow();
  });

  it('accepts removing a user app (only protected keys are locked)', () => {
    expect(() =>
      assertNoProtectedRemoval(current, ['chrome', 'focus-agent', 'finder']),
    ).not.toThrow();
  });

  it('throws ProtectedEntryError with code PROTECTED_ENTRY when a protected key is removed', () => {
    try {
      assertNoProtectedRemoval(current, ['chrome', 'focus-agent', 'vscode']);
      throw new Error('expected assertNoProtectedRemoval to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ProtectedEntryError);
      const protectedError = error as ProtectedEntryError;
      expect(protectedError.code).toBe(ERROR_CODES.PROTECTED_ENTRY);
      expect(protectedError.code).toBe('PROTECTED_ENTRY');
      expect(protectedError.name).toBe('ProtectedEntryError');
      expect(protectedError.removedKeys).toEqual(['finder']);
      expect(protectedError.message).toContain('finder');
    }
  });

  it('throws when every protected key is dropped', () => {
    expect(() => assertNoProtectedRemoval(current, [])).toThrow(ProtectedEntryError);
  });

  it('reports all removed protected keys in the error', () => {
    try {
      assertNoProtectedRemoval(current, ['vscode']);
      throw new Error('expected assertNoProtectedRemoval to throw');
    } catch (error) {
      expect([...(error as ProtectedEntryError).removedKeys].sort()).toEqual(
        ['chrome', 'finder', 'focus-agent'].sort(),
      );
    }
  });

  it('is a no-op when the current list was empty (nothing to preserve)', () => {
    expect(() => assertNoProtectedRemoval([], [])).not.toThrow();
  });
});
