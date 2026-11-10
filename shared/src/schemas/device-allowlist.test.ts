// shared/src/schemas/device-allowlist.test.ts — pairing/attestation and allow-list payloads
// (FR-003, FR-008, FR-026, REC-002, REC-003). The code is a 6-digit STRING (leading zeros matter)
// and only ever travels over the REST channel; allow-lists cap user apps at 50.

import { describe, expect, it } from 'vitest';
import {
  attestRequestSchema,
  deviceListQuerySchema,
  devicePairSchema,
  deviceRegisterSchema,
  devicesSortSchema,
  enrollPollSchema,
} from './device.js';
import { APP_KEY_PATTERN, appEntrySchema, hasDuplicateAppKeys, type AppEntry } from './app.js';
import { MAX_USER_APPS, allowlistPutSchema } from './allowlist.js';

const DEVICE_ID = '507f1f77bcf86cd799439011';
const CODE_HMAC = 'a'.repeat(64);
const NONCE = 'abcdefghijklmnopqrstuvwxyz012345';

const chrome: AppEntry = { key: 'chrome', label: 'Google Chrome', mac: ['com.google.Chrome'] };
const vscode: AppEntry = { key: 'vscode', label: 'Visual Studio Code', win: ['Code.exe'] };

describe('deviceRegisterSchema (POST /agent/register)', () => {
  it('accepts a valid registration', () => {
    const result = deviceRegisterSchema.safeParse({
      codeHmac: CODE_HMAC,
      os: 'macOS',
      name: 'Kabir-MacBook',
      agentVersion: '1.4.0',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed codeHmac, OS and version', () => {
    const valid = {
      codeHmac: CODE_HMAC,
      os: 'macOS',
      name: 'Kabir-MacBook',
      agentVersion: '1.4.0',
    };
    expect(deviceRegisterSchema.safeParse({ ...valid, codeHmac: 'a'.repeat(63) }).success).toBe(
      false,
    );
    expect(deviceRegisterSchema.safeParse({ ...valid, codeHmac: 'g'.repeat(64) }).success).toBe(
      false,
    );
    expect(deviceRegisterSchema.safeParse({ ...valid, os: 'Windows' }).success).toBe(false);
    expect(deviceRegisterSchema.safeParse({ ...valid, agentVersion: 'v1.4.0' }).success).toBe(
      false,
    );
    expect(deviceRegisterSchema.safeParse({ ...valid, name: 'K' }).success).toBe(false);
    expect(deviceRegisterSchema.safeParse({ ...valid, unexpected: true }).success).toBe(false);
  });
});

describe('devicePairSchema (POST /devices/pair)', () => {
  it('accepts 6-digit strings and an optional device name', () => {
    expect(devicePairSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(devicePairSchema.safeParse({ code: '000123', name: 'My laptop' }).success).toBe(true);
  });

  it('rejects non-6-digit codes and numeric codes (leading zeros would be lost)', () => {
    for (const code of ['12345', '1234567', 'abcdef', '', '12 456']) {
      expect(devicePairSchema.safeParse({ code }).success).toBe(false);
    }
    expect(devicePairSchema.safeParse({ code: 123456 }).success).toBe(false);
    expect(devicePairSchema.safeParse({ code: '123456', unexpected: true }).success).toBe(false);
  });
});

describe('attestRequestSchema and enrollPollSchema', () => {
  it('accepts a valid attestation request', () => {
    expect(attestRequestSchema.safeParse({ nonce: NONCE }).success).toBe(true);
    expect(attestRequestSchema.safeParse({ nonce: 'short' }).success).toBe(false);
    expect(
      attestRequestSchema.safeParse({ nonce: 'has spaces and is long enough!!' }).success,
    ).toBe(false);
    expect(attestRequestSchema.safeParse({ nonce: NONCE, extra: 1 }).success).toBe(false);
  });

  it('accepts a valid enrollment poll and rejects weak secrets', () => {
    expect(
      enrollPollSchema.safeParse({ deviceId: DEVICE_ID, enrollSecret: 'a'.repeat(32) }).success,
    ).toBe(true);
    expect(
      enrollPollSchema.safeParse({ deviceId: 'not-an-id', enrollSecret: 'a'.repeat(32) }).success,
    ).toBe(false);
    expect(
      enrollPollSchema.safeParse({ deviceId: DEVICE_ID, enrollSecret: 'a'.repeat(31) }).success,
    ).toBe(false);
    expect(
      enrollPollSchema.safeParse({ deviceId: DEVICE_ID, enrollSecret: 'a'.repeat(32), extra: 1 })
        .success,
    ).toBe(false);
  });
});

describe('device list query', () => {
  it('applies defaults and coerces query strings', () => {
    const parsed = deviceListQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
    expect(parsed.sort).toBe('-lastSeenAt');
  });

  it('enforces pagination bounds and the sort whitelist', () => {
    expect(deviceListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(deviceListQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(devicesSortSchema.safeParse('-lastSeenAt').success).toBe(true);
    expect(devicesSortSchema.safeParse('passwordHash').success).toBe(false);
    expect(deviceListQuerySchema.safeParse({ sort: 'passwordHash' }).success).toBe(false);
    expect(deviceListQuerySchema.safeParse({ unknown: 'x' }).success).toBe(false);
  });
});

describe('appEntrySchema', () => {
  it('accepts valid user apps with optional per-OS identifiers', () => {
    expect(appEntrySchema.safeParse(vscode).success).toBe(true);
    expect(appEntrySchema.safeParse({ key: 'slack', label: 'Slack' }).success).toBe(true);
    expect(appEntrySchema.safeParse(chrome).success).toBe(true);
  });

  it('enforces the key pattern (REQUIREMENTS §7)', () => {
    expect(APP_KEY_PATTERN.test('vscode')).toBe(true);
    expect(APP_KEY_PATTERN.test('google-chrome')).toBe(true);
    expect(APP_KEY_PATTERN.test('a1b2c3')).toBe(true);
    for (const key of ['VS Code', 'a', '', 'UPPER', 'has space', 'x'.repeat(41)]) {
      expect(APP_KEY_PATTERN.test(key)).toBe(false);
      expect(appEntrySchema.safeParse({ key, label: 'Bad key' }).success).toBe(false);
    }
  });

  it('rejects bad labels, identifier arrays and unknown fields', () => {
    expect(appEntrySchema.safeParse({ key: 'slack', label: 'S' }).success).toBe(false);
    expect(appEntrySchema.parse({ key: 'slack', label: '  Slack  ' })).toEqual({
      key: 'slack',
      label: 'Slack',
    });
    expect(appEntrySchema.safeParse({ ...vscode, win: [] }).success).toBe(false);
    expect(appEntrySchema.safeParse({ ...vscode, win: [1, 2] }).success).toBe(false);
    expect(
      appEntrySchema.safeParse({ ...vscode, win: Array.from({ length: 11 }, () => 'x.exe') })
        .success,
    ).toBe(false);
    expect(appEntrySchema.safeParse({ ...vscode, extra: true }).success).toBe(false);
  });

  it('detects duplicate keys', () => {
    expect(hasDuplicateAppKeys([vscode, chrome])).toBe(false);
    expect(hasDuplicateAppKeys([vscode, vscode])).toBe(true);
    expect(hasDuplicateAppKeys([])).toBe(false);
  });
});

describe('allowlistPutSchema (PUT /allowlist)', () => {
  it('accepts an empty user list and up to 50 unique apps', () => {
    expect(allowlistPutSchema.safeParse({ userApps: [] }).success).toBe(true);
    expect(allowlistPutSchema.safeParse({ userApps: [vscode, chrome] }).success).toBe(true);
    const fifty = Array.from({ length: MAX_USER_APPS }, (_unused, index) => ({
      key: `app-${index}`,
      label: `App ${index}`,
    }));
    expect(allowlistPutSchema.safeParse({ userApps: fifty }).success).toBe(true);
  });

  it('rejects more than 50 apps and duplicate keys', () => {
    const apps = Array.from({ length: MAX_USER_APPS + 1 }, (_unused, index) => ({
      key: `app-${index}`,
      label: `App ${index}`,
    }));
    expect(allowlistPutSchema.safeParse({ userApps: apps }).success).toBe(false);
    expect(allowlistPutSchema.safeParse({ userApps: [vscode, vscode] }).success).toBe(false);
  });

  it('accepts an echoed protectedApps list (server compares/ignores it — INV-3)', () => {
    expect(
      allowlistPutSchema.safeParse({ userApps: [vscode], protectedApps: [chrome] }).success,
    ).toBe(true);
    expect(
      allowlistPutSchema.safeParse({
        userApps: [],
        protectedApps: [{ key: 'bad key', label: 'x' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a missing userApps list and unknown fields', () => {
    expect(allowlistPutSchema.safeParse({}).success).toBe(false);
    expect(
      allowlistPutSchema.safeParse({ userApps: [], protectedApps: [], version: 2 }).success,
    ).toBe(false);
  });
});
