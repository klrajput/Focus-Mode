/*
 * Schedule wall-clock tests (FR-012): the dashboard must show the next run in the user's IANA
 * timezone and never shift a 09:00 block by an hour across a DST boundary.
 */

import { describe, expect, it } from 'vitest';

import type { Schedule } from '../api/types';
import {
  describeNextRunDay,
  localDateParts,
  localDayRangeIso,
  nextScheduleRun,
  zonedWallTimeToDate,
} from './schedule-next';

const KOLKATA = 'Asia/Kolkata';
const NEW_YORK = 'America/New_York';

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: '507f1f77bcf86cd799439030',
    name: 'Coding block',
    days: [1, 2, 3, 4, 5],
    startTime: '09:00',
    durationMin: 60,
    enabled: true,
    lastRunAt: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('localDateParts', () => {
  it('returns the local calendar day and contract weekday (0 = Sunday)', () => {
    // 2026-11-10T10:00Z is Tuesday 15:30 in Kolkata.
    const parts = localDateParts(new Date('2026-11-10T10:00:00.000Z'), KOLKATA);
    expect(parts).toEqual({ year: 2026, month: 11, day: 10, weekday: 2 });
  });

  it('rolls to the next local day when UTC is still the day before', () => {
    // 2026-11-10T20:00Z is Wednesday 01:30 in Kolkata.
    const parts = localDateParts(new Date('2026-11-10T20:00:00.000Z'), KOLKATA);
    expect(parts).toEqual({ year: 2026, month: 11, day: 11, weekday: 3 });
  });
});

describe('zonedWallTimeToDate', () => {
  it('converts a Kolkata wall time to the matching UTC instant', () => {
    const date = zonedWallTimeToDate(2026, 11, 10, 9, 0, KOLKATA);
    expect(date.toISOString()).toBe('2026-11-10T03:30:00.000Z');
  });

  it('honours the DST offset on the day it changes (US spring forward)', () => {
    // 2026-03-08 09:00 is already EDT (UTC-4), not EST (UTC-5).
    const date = zonedWallTimeToDate(2026, 3, 8, 9, 0, NEW_YORK);
    expect(date.toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });
});

describe('localDayRangeIso', () => {
  it('is the inclusive UTC window of the local calendar day', () => {
    const range = localDayRangeIso(KOLKATA, new Date('2026-11-10T10:00:00.000Z'));
    expect(range).toEqual({
      from: '2026-11-09T18:30:00.000Z',
      to: '2026-11-10T18:29:59.999Z',
    });
  });
});

describe('nextScheduleRun', () => {
  it('finds the next enabled weekday occurrence in the user timezone', () => {
    // Tuesday 15:30 in Kolkata, so the 09:00 Mon–Fri block is next on Wednesday.
    const run = nextScheduleRun([makeSchedule()], KOLKATA, new Date('2026-11-10T10:00:00.000Z'));

    expect(run).not.toBeNull();
    expect(run?.startsAt.toISOString()).toBe('2026-11-11T03:30:00.000Z');
    expect(run?.dayOffset).toBe(1);
    if (run !== null) expect(describeNextRunDay(run, KOLKATA)).toBe('tomorrow');
  });

  it('keeps a later run today instead of jumping to tomorrow', () => {
    // Tuesday 08:00 in Kolkata (02:30Z): today's 09:00 block is still ahead.
    const now = new Date('2026-11-10T02:30:00.000Z');
    const run = nextScheduleRun([makeSchedule()], KOLKATA, now);

    expect(run?.startsAt.toISOString()).toBe('2026-11-10T03:30:00.000Z');
    expect(run?.dayOffset).toBe(0);
    if (run !== null) expect(describeNextRunDay(run, KOLKATA)).toBe('today');
  });

  it('chooses the earliest day, then the earliest time on that day', () => {
    const later = makeSchedule({
      id: '507f1f77bcf86cd799439031',
      name: 'Later',
      startTime: '17:00',
    });
    const sooner = makeSchedule({
      id: '507f1f77bcf86cd799439032',
      name: 'Sooner',
      startTime: '08:00',
    });
    // Tuesday 06:00 in Kolkata: both of today's blocks are still ahead, so 08:00 wins.
    const run = nextScheduleRun([later, sooner], KOLKATA, new Date('2026-11-10T00:30:00.000Z'));

    expect(run?.schedule.name).toBe('Sooner');
    expect(run?.startsAt.toISOString()).toBe('2026-11-10T02:30:00.000Z');
  });

  it('maps Sunday to day 0 and labels the run by weekday', () => {
    const sunday = makeSchedule({ days: [0], startTime: '09:00' });
    const now = new Date('2026-11-09T10:00:00.000Z'); // Monday 15:30 in Kolkata
    const run = nextScheduleRun([sunday], KOLKATA, now);

    expect(run?.startsAt.toISOString()).toBe('2026-11-15T03:30:00.000Z');
    expect(run?.dayOffset).toBe(6);
    if (run !== null) expect(describeNextRunDay(run, KOLKATA)).toBe('Sunday');
  });

  it('ignores disabled schedules and returns null when nothing can run', () => {
    expect(
      nextScheduleRun(
        [makeSchedule({ enabled: false })],
        KOLKATA,
        new Date('2026-11-10T10:00:00.000Z'),
      ),
    ).toBeNull();
    expect(nextScheduleRun([], KOLKATA, new Date('2026-11-10T10:00:00.000Z'))).toBeNull();
  });

  it('keeps 09:00 at 09:00 local on the US spring-forward day', () => {
    const now = new Date('2026-03-07T12:00:00.000Z'); // Saturday in New York
    const run = nextScheduleRun([makeSchedule({ days: [0] })], NEW_YORK, now);

    expect(run?.startsAt.toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });

  it('skips a malformed startTime instead of inventing a run', () => {
    const run = nextScheduleRun(
      [makeSchedule({ startTime: '9:00' })],
      KOLKATA,
      new Date('2026-11-10T10:00:00.000Z'),
    );
    expect(run).toBeNull();
  });
});
