// allowlist.test.ts — INV-3 property tests for the protected set and candidate computation (T-033).
// The core property: for every supported OS and every protected entry, no matching window can
// ever appear in the focus candidates — not by key, not by executable/bundle id/WM_CLASS, and
// not even when a hostile allow-list tries to re-add it under a different key.
// Matching must be case-insensitive and must never need window titles (INV-6).

import { describe, expect, it } from 'vitest';
import {
  PROTECTED_BY_OS,
  protectedKeysForOs,
  type AppEntry,
  type OsName,
} from '@focus-mode/shared';
import {
  computeFocusCandidates,
  findAllowListMatch,
  findProtectedMatch,
  identifierFieldForOs,
  resolveProtectedEntries,
  sanitizeAllowList,
  type WindowRef,
} from './allowlist.js';

const OSES: readonly OsName[] = ['macOS', 'windows', 'linux'];

function identifierFor(entry: AppEntry, os: OsName): string | undefined {
  return (entry[identifierFieldForOs(os)] ?? [])[0];
}

function windowFor(entry: AppEntry, os: OsName, suffix = ''): WindowRef {
  const identifier = identifierFor(entry, os);
  return {
    handle: `handle-${entry.key}${suffix}`,
    appKey: entry.key,
    ...(identifier === undefined ? {} : { identifier }),
  };
}

describe('resolveProtectedEntries', () => {
  it('contains every static protected entry for each OS (never removable)', () => {
    for (const os of OSES) {
      const resolved = resolveProtectedEntries(os);
      const keys = new Set(resolved.map((entry) => entry.key));
      for (const key of protectedKeysForOs(os)) expect(keys.has(key)).toBe(true);
      expect(resolved.length).toBe(PROTECTED_BY_OS[os].length);
    }
  });

  it('merges runtime additions and unions identifiers without losing static ones', () => {
    const extra: AppEntry = {
      key: 'chrome',
      label: 'Google Chrome (runtime)',
      mac: ['com.example.chrome.beta'],
    };
    const resolved = resolveProtectedEntries('macOS', [extra]);
    const chrome = resolved.find((entry) => entry.key === 'chrome');
    expect(chrome?.label).toBe('Google Chrome');
    expect(chrome?.mac).toContain('com.google.Chrome');
    expect(chrome?.mac).toContain('com.example.chrome.beta');
  });

  it('adds a new runtime browser (DEC-006 default browser) to the protected set', () => {
    const runtimeDefault: AppEntry = {
      key: 'orion',
      label: 'Orion',
      mac: ['com.kagi.kagimacOS'],
    };
    const resolved = resolveProtectedEntries('macOS', [runtimeDefault]);
    expect(resolved.some((entry) => entry.key === 'orion')).toBe(true);
  });
});

describe('computeFocusCandidates — INV-3 property', () => {
  it('never returns a protected window for any protected entry on any OS', () => {
    for (const os of OSES) {
      const protectedEntries = resolveProtectedEntries(os);

      for (const entry of protectedEntries) {
        const protectedWindow = windowFor(entry, os);
        const allowList: AppEntry[] = [entry];
        const partition = computeFocusCandidates(
          [protectedWindow],
          allowList,
          protectedEntries,
          os,
        );

        expect(partition.candidates).toHaveLength(0);
        expect(partition.skippedProtected.map((skip) => skip.window.handle)).toEqual([
          protectedWindow.handle,
        ]);
        expect(partition.skippedAllowListed).toHaveLength(0);
      }
    }
  });

  it('never returns a protected window even when a hostile allow-list renames it', () => {
    for (const os of OSES) {
      const protectedEntries = resolveProtectedEntries(os);
      const field = identifierFieldForOs(os);

      for (const entry of protectedEntries) {
        const identifiers = entry[field] ?? [];
        if (identifiers.length === 0) continue;
        const window: WindowRef = {
          handle: `hostile-${entry.key}`,
          appKey: 'innocent-app',
          identifier: (identifiers[0] ?? '').toUpperCase(),
        };
        const hostileAllowList: AppEntry = {
          key: 'innocent-app',
          label: 'Innocent App',
          [field]: identifiers,
        };

        const partition = computeFocusCandidates(
          [window],
          [hostileAllowList],
          protectedEntries,
          os,
        );
        expect(partition.candidates).toHaveLength(0);
        expect(partition.skippedProtected).toHaveLength(1);
      }
    }
  });

  it('excludes allow-listed apps and leaves only unprotected, non-allowed windows', () => {
    const protectedEntries = resolveProtectedEntries('macOS');
    const vscode: AppEntry = {
      key: 'vscode',
      label: 'Visual Studio Code',
      mac: ['com.microsoft.VSCode'],
    };
    const windows: WindowRef[] = [
      { handle: 'w1', appKey: 'chrome', identifier: 'com.google.Chrome' },
      { handle: 'w2', appKey: 'vscode', identifier: 'com.microsoft.VSCode' },
      { handle: 'w3', appKey: 'slack', identifier: 'com.tinyspeck.slackmacgap' },
      { handle: 'w4', appKey: 'notes', identifier: 'com.apple.Notes' },
    ];

    const partition = computeFocusCandidates(windows, [vscode], protectedEntries, 'macOS');
    expect(partition.candidates.map((window) => window.handle)).toEqual(['w3', 'w4']);
    expect(partition.skippedProtected.map((skip) => skip.matchedEntry.key)).toEqual(['chrome']);
    expect(partition.skippedAllowListed.map((skip) => skip.matchedEntry.key)).toEqual(['vscode']);
  });

  it('matches user apps case-insensitively by exe, bundle id and WM_CLASS', () => {
    const protectedEntries = resolveProtectedEntries('windows');
    const windows: WindowRef[] = [
      { handle: 'w1', appKey: 'vscode', identifier: 'CODE.EXE' },
      { handle: 'w2', appKey: 'slack', identifier: 'Slack.exe' },
    ];
    const allowList: AppEntry[] = [
      { key: 'vscode', label: 'Visual Studio Code', win: ['Code.exe'] },
      { key: 'slack', label: 'Slack', win: ['slack.exe'] },
    ];
    const partition = computeFocusCandidates(windows, allowList, protectedEntries, 'windows');
    expect(partition.candidates).toHaveLength(0);
    expect(partition.skippedAllowListed).toHaveLength(2);
  });

  it('matches by app key when an OS does not expose an identifier', () => {
    const protectedEntries = resolveProtectedEntries('linux');
    const window: WindowRef = { handle: 'x1', appKey: 'slack' };
    const allowList: AppEntry[] = [{ key: 'slack', label: 'Slack', linux: ['slack'] }];
    const partition = computeFocusCandidates([window], allowList, protectedEntries, 'linux');
    expect(partition.candidates).toHaveLength(0);
    expect(partition.skippedAllowListed).toHaveLength(1);
  });

  it('returns every window as a candidate when the allow-list is empty and nothing is protected', () => {
    const windows: WindowRef[] = [
      { handle: 'w1', appKey: 'slack', identifier: 'com.tinyspeck.slackmacgap' },
      { handle: 'w2', appKey: 'notes', identifier: 'com.apple.Notes' },
    ];
    const partition = computeFocusCandidates(
      windows,
      [],
      resolveProtectedEntries('macOS'),
      'macOS',
    );
    expect(partition.candidates).toHaveLength(2);
    expect(partition.skippedProtected).toHaveLength(0);
    expect(partition.skippedAllowListed).toHaveLength(0);
  });

  it('finds protected and allow-list matches independently', () => {
    const protectedEntries = resolveProtectedEntries('macOS');
    const chromeWindow: WindowRef = {
      handle: 'w1',
      appKey: 'chrome',
      identifier: 'com.google.Chrome',
    };
    expect(findProtectedMatch(chromeWindow, protectedEntries, 'macOS')?.key).toBe('chrome');
    expect(
      findAllowListMatch(chromeWindow, [{ key: 'chrome', label: 'Chrome' }], 'macOS')?.key,
    ).toBe('chrome');
  });
});

describe('sanitizeAllowList', () => {
  it('drops protected entries by key and by identifier, plus duplicates', () => {
    const protectedEntries = resolveProtectedEntries('macOS');
    const allowList: AppEntry[] = [
      { key: 'chrome', label: 'Google Chrome' },
      { key: 'vscode', label: 'Visual Studio Code', mac: ['com.microsoft.VSCode'] },
      { key: 'vscode', label: 'Duplicate VS Code', mac: ['com.microsoft.VSCode'] },
      { key: 'my-browser', label: 'My Browser', mac: ['com.google.Chrome'] },
      { key: 'slack', label: 'Slack', mac: ['com.tinyspeck.slackmacgap'] },
    ];
    const sanitized = sanitizeAllowList(allowList, protectedEntries, 'macOS');
    expect(sanitized.map((entry) => entry.key)).toEqual(['vscode', 'slack']);
  });

  it('never removes protected entries from the resolved set', () => {
    const protectedEntries = resolveProtectedEntries('windows');
    const sanitized = sanitizeAllowList(protectedEntries, protectedEntries, 'windows');
    expect(sanitized).toHaveLength(0);
    expect(resolveProtectedEntries('windows')).toHaveLength(PROTECTED_BY_OS.windows.length);
  });
});
