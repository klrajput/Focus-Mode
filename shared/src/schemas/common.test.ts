// shared/src/schemas/common.test.ts — primitives shared by every REST payload.
// Bounds, formats and coercions are asserted here once so resource tests stay readable.

import { describe, expect, it } from 'vitest';
import {
  actualMinutesSchema,
  agentArchSchema,
  agentVersionSchema,
  deviceStatusSchema,
  durationMinSchema,
  endReasonSchema,
  focusSourceSchema,
  isOrderedDateRange,
  isValidIanaTimeZone,
  limitSchema,
  nonceSchema,
  objectIdSchema,
  osSchema,
  pageSchema,
  roleSchema,
  searchSchema,
  sessionStatusSchema,
  terminalSessionStatusSchema,
  timezoneSchema,
  uuidSchema,
  isoDateTimeSchema,
} from './common.js';

describe('identifiers and timestamps', () => {
  it('accepts a 24-char hex ObjectId and rejects everything else', () => {
    expect(objectIdSchema.safeParse('507f1f77bcf86cd799439011').success).toBe(true);
    expect(objectIdSchema.safeParse('507F1F77BCF86CD799439011').success).toBe(true);
    expect(objectIdSchema.safeParse('507f1f77bcf86cd79943901').success).toBe(false);
    expect(objectIdSchema.safeParse('zzzzzzzzzzzzzzzzzzzzzzzz').success).toBe(false);
    expect(objectIdSchema.safeParse('').success).toBe(false);
  });

  it('accepts UUIDs and rejects non-UUID strings', () => {
    expect(uuidSchema.safeParse('3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f').success).toBe(true);
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(uuidSchema.safeParse('').success).toBe(false);
  });

  it('accepts ISO-8601 UTC timestamps only', () => {
    expect(isoDateTimeSchema.safeParse('2026-11-10T10:00:00.000Z').success).toBe(true);
    expect(isoDateTimeSchema.safeParse('2026-11-10T10:00:00Z').success).toBe(true);
    expect(isoDateTimeSchema.safeParse('2026-11-10').success).toBe(false);
    expect(isoDateTimeSchema.safeParse('2026-11-10T10:00:00').success).toBe(false);
    expect(isoDateTimeSchema.safeParse('yesterday').success).toBe(false);
  });
});

describe('timezone', () => {
  it('accepts real IANA names', () => {
    for (const zone of ['Asia/Kolkata', 'Europe/London', 'America/New_York', 'UTC', 'Etc/GMT+5']) {
      expect(typeof zone).toBe('string');
      expect(timezoneSchema.safeParse(zone).success).toBe(true);
      expect(isValidIanaTimeZone(zone)).toBe(true);
    }
  });

  it('rejects unknown, offset and empty values', () => {
    for (const zone of ['Not/AZone', 'Mars/Olympus', '+05:30', '', ' ']) {
      expect(timezoneSchema.safeParse(zone).success).toBe(false);
      expect(isValidIanaTimeZone(zone)).toBe(false);
    }
  });
});

describe('duration and elapsed minutes', () => {
  it('durationMin is an integer in [1, 480]', () => {
    for (const value of [1, 25, 50, 60, 480]) {
      expect(durationMinSchema.safeParse(value).success).toBe(true);
    }
    for (const value of [0, -1, 481, 1.5, '60', null, NaN]) {
      expect(durationMinSchema.safeParse(value).success).toBe(false);
    }
  });

  it('actualMinutes allows 0 and fractional minutes up to 1440', () => {
    for (const value of [0, 0.1, 1, 60.5, 1440]) {
      expect(actualMinutesSchema.safeParse(value).success).toBe(true);
    }
    for (const value of [-1, 1441, '60']) {
      expect(actualMinutesSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('enumerations', () => {
  it('roles', () => {
    expect(roleSchema.safeParse('USER').success).toBe(true);
    expect(roleSchema.safeParse('ADMIN').success).toBe(true);
    expect(roleSchema.safeParse('GUEST').success).toBe(false);
    expect(roleSchema.safeParse('admin').success).toBe(false);
  });

  it('OS names match the DB spelling exactly', () => {
    for (const osName of ['macOS', 'windows', 'linux']) {
      expect(osSchema.safeParse(osName).success).toBe(true);
    }
    for (const osName of ['MacOS', 'Windows', 'darwin', 'win32']) {
      expect(osSchema.safeParse(osName).success).toBe(false);
    }
  });

  it('device presence status', () => {
    for (const value of ['CONNECTED', 'DISCONNECTED', 'FOCUSING']) {
      expect(deviceStatusSchema.safeParse(value).success).toBe(true);
    }
    expect(deviceStatusSchema.safeParse('IDLE').success).toBe(false);
  });

  it('session status: ACTIVE only while running, terminal subset for PATCH', () => {
    for (const value of ['ACTIVE', 'COMPLETED', 'CANCELLED']) {
      expect(sessionStatusSchema.safeParse(value).success).toBe(true);
    }
    expect(sessionStatusSchema.safeParse('PAUSED').success).toBe(false);
    expect(terminalSessionStatusSchema.safeParse('ACTIVE').success).toBe(false);
    expect(terminalSessionStatusSchema.safeParse('COMPLETED').success).toBe(true);
  });

  it('focus source and end reasons', () => {
    expect(focusSourceSchema.safeParse('MANUAL').success).toBe(true);
    expect(focusSourceSchema.safeParse('SCHEDULE').success).toBe(true);
    expect(focusSourceSchema.safeParse('POMODORO').success).toBe(false);
    for (const reason of [
      'COMPLETED',
      'USER',
      'AGENT',
      'SLEEP',
      'CRASH_RECOVERY',
      'UNPAIRED',
      'QUIT',
    ]) {
      expect(endReasonSchema.safeParse(reason).success).toBe(true);
    }
    expect(endReasonSchema.safeParse('TIMEOUT').success).toBe(false);
  });

  it('agent architecture and version', () => {
    for (const arch of ['x64', 'arm64', 'universal']) {
      expect(agentArchSchema.safeParse(arch).success).toBe(true);
    }
    expect(agentArchSchema.safeParse('ia32').success).toBe(false);
    for (const version of ['1.4.0', '1.4.0-beta.1', '0.0.1+build9']) {
      expect(agentVersionSchema.safeParse(version).success).toBe(true);
    }
    for (const version of ['v1.4.0', '1.4', 'latest', '']) {
      expect(agentVersionSchema.safeParse(version).success).toBe(false);
    }
  });

  it('nonce is opaque URL-safe material', () => {
    expect(nonceSchema.safeParse('abcdefghijklmnopqrstuvwxyz012345').success).toBe(true);
    expect(nonceSchema.safeParse('a'.repeat(15)).success).toBe(false);
    expect(nonceSchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(nonceSchema.safeParse('bad nonce with spaces!!').success).toBe(false);
  });
});

describe('pagination and search', () => {
  it('coerces query strings, applies defaults and enforces the bounds', () => {
    expect(pageSchema.parse(undefined)).toBe(1);
    expect(pageSchema.parse('3')).toBe(3);
    expect(pageSchema.parse(3)).toBe(3);
    expect(pageSchema.safeParse('0').success).toBe(false);
    expect(pageSchema.safeParse('-2').success).toBe(false);
    expect(pageSchema.safeParse('abc').success).toBe(false);

    expect(limitSchema.parse(undefined)).toBe(20);
    expect(limitSchema.parse('1')).toBe(1);
    expect(limitSchema.parse('100')).toBe(100);
    expect(limitSchema.safeParse('0').success).toBe(false);
    expect(limitSchema.safeParse('101').success).toBe(false);
  });

  it('search must be a non-empty string within 100 chars', () => {
    expect(searchSchema.safeParse('kabir').success).toBe(true);
    expect(searchSchema.safeParse('').success).toBe(false);
    expect(searchSchema.safeParse('x'.repeat(101)).success).toBe(false);
  });

  it('orders date ranges and treats one-sided ranges as valid', () => {
    expect(isOrderedDateRange({})).toBe(true);
    expect(isOrderedDateRange({ from: '2026-11-01T00:00:00.000Z' })).toBe(true);
    expect(isOrderedDateRange({ to: '2026-11-01T00:00:00.000Z' })).toBe(true);
    expect(
      isOrderedDateRange({
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-11-02T00:00:00.000Z',
      }),
    ).toBe(true);
    expect(
      isOrderedDateRange({
        from: '2026-11-02T00:00:00.000Z',
        to: '2026-11-01T00:00:00.000Z',
      }),
    ).toBe(false);
  });
});
