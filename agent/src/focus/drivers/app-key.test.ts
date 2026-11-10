// focus/drivers/app-key.test.ts — slug derivation for bundle ids, executables and process names.
// The slug feeds `WindowRef.appKey` only; identity matching still uses the raw identifier, so
// these tests focus on the shared appKeySchema contract (2–40 chars of `[a-z0-9-]`).

import { describe, expect, it } from 'vitest';
import { APP_KEY_PATTERN } from '@focus-mode/shared';
import { appKeyFromBundleId, appKeyFromExecutableName } from './app-key.js';

const VALID_INPUTS: readonly string[] = [
  'com.google.Chrome',
  'com.microsoft.VSCode',
  'com.apple.finder',
  'com.focusmode.agent',
  'company.thebrowser.Browser',
  'net.whatsapp.WhatsApp',
  'com.example.X',
  'Code.exe',
  'chrome.EXE',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '7-Zip.exe',
  'x.exe',
  'google-chrome',
  'gnome-shell',
  'VLC',
];

describe('appKeyFromBundleId', () => {
  it('uses the last bundle-id segment', () => {
    expect(appKeyFromBundleId('com.google.Chrome')).toBe('chrome');
    expect(appKeyFromBundleId('com.microsoft.VSCode')).toBe('vscode');
    expect(appKeyFromBundleId('com.apple.finder')).toBe('finder');
    expect(appKeyFromBundleId('company.thebrowser.Browser')).toBe('browser');
  });

  it('always produces a schema-valid key or undefined', () => {
    for (const input of VALID_INPUTS) {
      const key = appKeyFromBundleId(input);
      expect(key, input).toBeDefined();
      expect(key, input).toMatch(APP_KEY_PATTERN);
    }
    expect(appKeyFromBundleId('')).toBeUndefined();
    expect(appKeyFromBundleId('   ')).toBeUndefined();
  });

  it('widens a one-character segment to a valid key', () => {
    expect(appKeyFromBundleId('com.example.X')).toBe('app-x');
  });
});

describe('appKeyFromExecutableName', () => {
  it('strips the path and a case-insensitive .exe suffix', () => {
    expect(appKeyFromExecutableName('Code.exe')).toBe('code');
    expect(appKeyFromExecutableName('chrome.EXE')).toBe('chrome');
    expect(
      appKeyFromExecutableName('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'),
    ).toBe('chrome');
    expect(appKeyFromExecutableName('7-Zip.exe')).toBe('7-zip');
  });

  it('supports Linux process names unchanged', () => {
    expect(appKeyFromExecutableName('google-chrome')).toBe('google-chrome');
    expect(appKeyFromExecutableName('gnome-shell')).toBe('gnome-shell');
    expect(appKeyFromExecutableName('VLC')).toBe('vlc');
  });

  it('always produces a schema-valid key or undefined', () => {
    for (const input of VALID_INPUTS) {
      const key = appKeyFromExecutableName(input);
      expect(key, input).toBeDefined();
      expect(key, input).toMatch(APP_KEY_PATTERN);
    }
    expect(appKeyFromExecutableName('')).toBeUndefined();
    expect(appKeyFromExecutableName('!!!')).toBeUndefined();
  });

  it('truncates a very long name to the 40-character wire limit', () => {
    const key = appKeyFromExecutableName(`${'a'.repeat(120)}.exe`);
    expect(key).toBeDefined();
    expect(key).toHaveLength(40);
    expect(key).toMatch(APP_KEY_PATTERN);
  });
});
