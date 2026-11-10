// shared/src/schemas/schedule-session.test.ts — schedule CRUD and session lifecycle payloads
// (FR-010, FR-012, FR-024, REC-006). Day/time structure, duration bounds, sort whitelists and
// the date-range refinement are asserted with valid and invalid fixtures.

import { describe, expect, it } from 'vitest';
import {
  scheduleCreateSchema,
  scheduleDaysSchema,
  scheduleStartTimeSchema,
  scheduleUpdateSchema,
} from './schedule.js';
import {
  sessionCreateSchema,
  sessionListQuerySchema,
  sessionPatchSchema,
  sessionsSortSchema,
} from './session.js';
import { insightsQuerySchema, insightsRangeSchema } from './insights.js';

const DEVICE_ID = '507f1f77bcf86cd799439011';
const CLIENT_SESSION_ID = '9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c';
const STARTED_AT = '2026-11-10T10:00:00.000Z';
const ENDED_AT = '2026-11-10T11:00:00.000Z';

const validSchedule = {
  name: 'Morning deep work',
  days: [1, 2, 3, 4, 5],
  startTime: '09:00',
  durationMin: 120,
};

describe('schedule days (REQUIREMENTS §7)', () => {
  it('accepts a non-empty unique subset of 0–6', () => {
    expect(scheduleDaysSchema.safeParse([1, 2, 3]).success).toBe(true);
    expect(scheduleDaysSchema.safeParse([0, 6]).success).toBe(true);
    expect(scheduleDaysSchema.safeParse([0, 1, 2, 3, 4, 5, 6]).success).toBe(true);
  });

  it('rejects empty, out-of-range, fractional and duplicate days', () => {
    for (const days of [[], [-1], [7], [1.5], [1, 1], ['1']]) {
      expect(scheduleDaysSchema.safeParse(days).success).toBe(false);
    }
  });
});

describe('schedule start time', () => {
  it('accepts 24-hour HH:mm only', () => {
    for (const value of ['00:00', '09:00', '12:30', '23:59']) {
      expect(scheduleStartTimeSchema.safeParse(value).success).toBe(true);
    }
    for (const value of ['9:00', '24:00', '09:60', '09:00:00', '', '09-00']) {
      expect(scheduleStartTimeSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('scheduleCreateSchema', () => {
  it('accepts a valid schedule and defaults enabled to true', () => {
    const parsed = scheduleCreateSchema.parse(validSchedule);
    expect(parsed.enabled).toBe(true);
    expect(parsed.name).toBe('Morning deep work');
    expect(scheduleCreateSchema.safeParse({ ...validSchedule, enabled: false }).success).toBe(true);
  });

  it('trims the name and enforces duration bounds', () => {
    expect(scheduleCreateSchema.parse({ ...validSchedule, name: '  Deep work  ' }).name).toBe(
      'Deep work',
    );
    expect(scheduleCreateSchema.safeParse({ ...validSchedule, durationMin: 0 }).success).toBe(
      false,
    );
    expect(scheduleCreateSchema.safeParse({ ...validSchedule, durationMin: 481 }).success).toBe(
      false,
    );
    expect(scheduleCreateSchema.safeParse({ ...validSchedule, durationMin: 25.5 }).success).toBe(
      false,
    );
  });

  it('rejects missing fields and unknown fields (NFR-013)', () => {
    expect(scheduleCreateSchema.safeParse({ ...validSchedule, name: undefined }).success).toBe(
      false,
    );
    expect(scheduleCreateSchema.safeParse({ ...validSchedule, days: undefined }).success).toBe(
      false,
    );
    expect(scheduleCreateSchema.safeParse({ ...validSchedule, timezone: 'UTC' }).success).toBe(
      false,
    );
    expect(
      scheduleCreateSchema.safeParse({ ...validSchedule, lastRunAt: STARTED_AT }).success,
    ).toBe(false);
  });
});

describe('scheduleUpdateSchema', () => {
  it('accepts any non-empty subset', () => {
    expect(scheduleUpdateSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(scheduleUpdateSchema.safeParse({ durationMin: 25 }).success).toBe(true);
    expect(scheduleUpdateSchema.safeParse({ days: [0, 6] }).success).toBe(true);
  });

  it('rejects empty, invalid and unknown-field patches', () => {
    expect(scheduleUpdateSchema.safeParse({}).success).toBe(false);
    expect(scheduleUpdateSchema.safeParse({ days: [] }).success).toBe(false);
    expect(scheduleUpdateSchema.safeParse({ startTime: '9:00' }).success).toBe(false);
    expect(scheduleUpdateSchema.safeParse({ lastRunAt: STARTED_AT }).success).toBe(false);
  });
});

describe('sessionCreateSchema (REC-006 idempotency key)', () => {
  const validSession = {
    deviceId: DEVICE_ID,
    durationMin: 60,
    startedAt: STARTED_AT,
    clientSessionId: CLIENT_SESSION_ID,
  };

  it('accepts a valid session and defaults source to MANUAL', () => {
    const parsed = sessionCreateSchema.parse(validSession);
    expect(parsed.source).toBe('MANUAL');
    expect(sessionCreateSchema.safeParse({ ...validSession, source: 'SCHEDULE' }).success).toBe(
      true,
    );
  });

  it('rejects bad device ids, durations, timestamps, UUIDs and sources', () => {
    expect(sessionCreateSchema.safeParse({ ...validSession, deviceId: 'nope' }).success).toBe(
      false,
    );
    expect(sessionCreateSchema.safeParse({ ...validSession, durationMin: 0 }).success).toBe(false);
    expect(sessionCreateSchema.safeParse({ ...validSession, durationMin: 481 }).success).toBe(
      false,
    );
    expect(
      sessionCreateSchema.safeParse({ ...validSession, startedAt: '2026-11-10' }).success,
    ).toBe(false);
    expect(
      sessionCreateSchema.safeParse({ ...validSession, clientSessionId: 'not-a-uuid' }).success,
    ).toBe(false);
    expect(sessionCreateSchema.safeParse({ ...validSession, source: 'POMODORO' }).success).toBe(
      false,
    );
    expect(sessionCreateSchema.safeParse({ ...validSession, endedAt: ENDED_AT }).success).toBe(
      false,
    );
  });
});

describe('sessionPatchSchema', () => {
  const validPatch = {
    status: 'COMPLETED',
    endedAt: ENDED_AT,
    actualMinutes: 60,
    endReason: 'COMPLETED',
  };

  it('accepts a complete finalisation body', () => {
    expect(sessionPatchSchema.safeParse(validPatch).success).toBe(true);
    expect(sessionPatchSchema.safeParse({ ...validPatch, status: 'CANCELLED' }).success).toBe(true);
    expect(sessionPatchSchema.safeParse({ ...validPatch, actualMinutes: 0.1 }).success).toBe(true);
  });

  it('rejects ACTIVE, missing fields, negative minutes and unknown reasons', () => {
    expect(sessionPatchSchema.safeParse({ ...validPatch, status: 'ACTIVE' }).success).toBe(false);
    expect(sessionPatchSchema.safeParse({ status: 'COMPLETED', endedAt: ENDED_AT }).success).toBe(
      false,
    );
    expect(sessionPatchSchema.safeParse({ ...validPatch, actualMinutes: -1 }).success).toBe(false);
    expect(sessionPatchSchema.safeParse({ ...validPatch, endReason: 'TIMEOUT' }).success).toBe(
      false,
    );
    expect(sessionPatchSchema.safeParse({ ...validPatch, extra: true }).success).toBe(false);
  });
});

describe('sessionListQuerySchema (NFR-009)', () => {
  it('applies pagination/sort defaults', () => {
    const parsed = sessionListQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
    expect(parsed.sort).toBe('-startedAt');
  });

  it('enforces the sort whitelist and pagination bounds', () => {
    expect(sessionsSortSchema.safeParse('-actualMinutes').success).toBe(true);
    expect(sessionsSortSchema.safeParse('passwordHash').success).toBe(false);
    expect(sessionListQuerySchema.safeParse({ sort: 'email' }).success).toBe(false);
    expect(sessionListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(sessionListQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('validates filters and the from≤to refinement', () => {
    expect(
      sessionListQuerySchema.safeParse({
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-11-10T00:00:00.000Z',
        status: 'COMPLETED',
        source: 'SCHEDULE',
      }).success,
    ).toBe(true);
    expect(
      sessionListQuerySchema.safeParse({
        from: '2026-11-10T00:00:00.000Z',
        to: '2026-11-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(sessionListQuerySchema.safeParse({ status: 'PAUSED' }).success).toBe(false);
    expect(sessionListQuerySchema.safeParse({ unknown: 'x' }).success).toBe(false);
  });
});

describe('insightsQuerySchema (FR-013)', () => {
  it('accepts only 7d/30d/90d and defaults to 7d', () => {
    for (const range of ['7d', '30d', '90d']) {
      expect(insightsRangeSchema.safeParse(range).success).toBe(true);
      expect(insightsQuerySchema.safeParse({ range }).success).toBe(true);
    }
    expect(insightsQuerySchema.parse({}).range).toBe('7d');
    expect(insightsRangeSchema.safeParse('1y').success).toBe(false);
    expect(insightsRangeSchema.safeParse('7D').success).toBe(false);
  });

  it('accepts an optional IANA timezone and rejects unknown fields', () => {
    expect(insightsQuerySchema.safeParse({ timezone: 'Asia/Kolkata' }).success).toBe(true);
    expect(insightsQuerySchema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(insightsQuerySchema.safeParse({ range: '7d', extra: 1 }).success).toBe(false);
  });
});
