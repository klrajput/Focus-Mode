// server/src/test/insights.test.ts — T-070 acceptance (FR-013, REQUIREMENTS §6, FR-028).
// Why: insights are user-visible analytics; a wrong timezone/DST/streak calculation is a silent data
// lie. The service accepts a pinned clock for tests, so fixtures below are HAND-COMPUTED against a
// fixed NOW and assert exact numbers — not just "some number came back".
// Fixtures: user timezone Asia/Kolkata (+05:30, no DST) with COMPLETED/CANCELLED/ACTIVE sessions
// spread across local days/hours, plus an all-time session outside the 30d window; a Europe/London
// fixture around the 2026-10-25 DST fall-back proving Intl-only local day/hour attribution.
// Invariants asserted: only COMPLETED actualMinutes count as focus minutes; ACTIVE never counts;
// completionRate = completed/(completed+cancelled); daily is always the last 7 local days;
// weekly buckets only for 30d/90d; streaks use ≥10-minute local days; bestHours = top 3.

import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { Session } from '../models/Session.js';
import { getInsights } from '../services/insights.service.js';
import { localDayHour, addLocalDays, weekStartOf } from '../utils/timezone.js';
import {
  bearer,
  clearTestDatabase,
  createDirectUser,
  createTestApp,
  createTestDevice,
  startTestDatabase,
  stopTestDatabase,
  TEST_PASSWORD,
} from './helpers.js';

/** Pinned clock for every hand-computed fixture: Thu 2026-11-05 12:00 UTC. */
const NOW = new Date('2026-11-05T12:00:00.000Z');
const NOW_FN = (): Date => NOW;

let app: Express;

interface SessionFixture {
  startedAt: string;
  actualMinutes: number;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}

/** Asia/Kolkata fixture list (see the test comments for the hand-computed expectations). */
const KOLKATA_SESSIONS: SessionFixture[] = [
  { startedAt: '2026-11-05T03:30:00.000Z', actualMinutes: 30, status: 'COMPLETED' }, // IST Nov 5 09:00
  { startedAt: '2026-11-05T04:30:00.000Z', actualMinutes: 25, status: 'COMPLETED' }, // IST Nov 5 10:00
  { startedAt: '2026-11-04T20:00:00.000Z', actualMinutes: 7, status: 'COMPLETED' }, // IST Nov 5 01:30
  { startedAt: '2026-11-04T03:30:00.000Z', actualMinutes: 20, status: 'COMPLETED' }, // IST Nov 4 09:00
  { startedAt: '2026-11-03T03:30:00.000Z', actualMinutes: 15, status: 'COMPLETED' }, // IST Nov 3 09:00
  { startedAt: '2026-11-02T03:30:00.000Z', actualMinutes: 10, status: 'COMPLETED' }, // IST Nov 2 09:00
  { startedAt: '2026-11-01T03:30:00.000Z', actualMinutes: 5, status: 'CANCELLED' }, // IST Nov 1 09:00
  { startedAt: '2026-10-30T03:30:00.000Z', actualMinutes: 12, status: 'COMPLETED' }, // IST Oct 30 09:00
  { startedAt: '2026-09-01T03:30:00.000Z', actualMinutes: 100, status: 'COMPLETED' }, // outside 30d
  { startedAt: '2026-11-05T05:30:00.000Z', actualMinutes: 0, status: 'ACTIVE' }, // never counted
];

async function login(appInstance: Express, email: string): Promise<string> {
  const response = await request(appInstance)
    .post('/api/v1/auth/login')
    .send({ email, password: TEST_PASSWORD });
  expect(response.status).toBe(200);
  return response.body.data.accessToken as string;
}

beforeAll(async () => {
  await startTestDatabase();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
  app = createTestApp();
});

describe('timezone primitives (Intl only, DST-correct)', () => {
  it('maps instants to local day/hour through a DST fall-back (Europe/London 2026-10-25)', () => {
    // BST (UTC+1) until 02:00 local, then GMT (UTC+0): 00:30Z = 01:30 BST, 01:30Z = 01:30 GMT.
    expect(localDayHour(new Date('2026-10-25T00:30:00.000Z'), 'Europe/London')).toEqual({
      dateKey: '2026-10-25',
      hour: 1,
      minute: 30,
    });
    expect(localDayHour(new Date('2026-10-25T01:30:00.000Z'), 'Europe/London')).toEqual({
      dateKey: '2026-10-25',
      hour: 1,
      minute: 30,
    });
  });

  it('maps instants through the spring-forward gap (Europe/London 2026-03-29)', () => {
    // 00:30Z = 00:30 GMT; 01:30Z = 02:30 BST (the 01:00–02:00 local hour does not exist).
    expect(localDayHour(new Date('2026-03-29T00:30:00.000Z'), 'Europe/London')).toMatchObject({
      dateKey: '2026-03-29',
      hour: 0,
    });
    expect(localDayHour(new Date('2026-03-29T01:30:00.000Z'), 'Europe/London')).toMatchObject({
      dateKey: '2026-03-29',
      hour: 2,
    });
  });

  it('shift calendar dates without offsets and finds Monday week starts', () => {
    expect(addLocalDays('2026-11-05', -6)).toBe('2026-10-30');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addLocalDays('2024-03-01', -1)).toBe('2024-02-29'); // leap year
    expect(weekStartOf('2026-11-05')).toBe('2026-11-02'); // Thursday → Monday
    expect(weekStartOf('2026-11-02')).toBe('2026-11-02'); // Monday → itself
  });
});

describe('getInsights — hand-computed Asia/Kolkata fixtures', () => {
  it('7d: exact totals, daily series, best hours and streaks', async () => {
    const user = await createDirectUser({ timezone: 'Asia/Kolkata' });
    const { deviceId } = await createTestDevice({ ownerId: user._id });
    for (const session of KOLKATA_SESSIONS) {
      await Session.create({
        userId: user._id,
        deviceId,
        startedAt: new Date(session.startedAt),
        plannedMinutes: 60,
        actualMinutes: session.actualMinutes,
        status: session.status,
        source: 'MANUAL',
        clientSessionId: randomUUID(),
        endReason:
          session.status === 'COMPLETED'
            ? 'COMPLETED'
            : session.status === 'CANCELLED'
              ? 'USER'
              : null,
        lastHeartbeatAt: new Date(session.startedAt),
      });
    }

    const insights = await getInsights(String(user._id), { range: '7d' }, { now: NOW_FN });

    expect(insights.range).toBe('7d');
    expect(insights.timezone).toBe('Asia/Kolkata');
    expect(insights.totals).toEqual({
      focusMinutes: 119,
      sessions: 8, // 7 COMPLETED + 1 CANCELLED inside Oct 30 – Nov 5
      completed: 7,
      cancelled: 1,
      completionRate: 0.875,
      currentStreak: 4, // Nov 2,3,4,5 have ≥10 minutes; Nov 1 broke the run
      longestStreak: 4,
    });
    expect(insights.daily).toEqual([
      { date: '2026-10-30', minutes: 12 },
      { date: '2026-10-31', minutes: 0 },
      { date: '2026-11-01', minutes: 0 },
      { date: '2026-11-02', minutes: 10 },
      { date: '2026-11-03', minutes: 15 },
      { date: '2026-11-04', minutes: 20 },
      { date: '2026-11-05', minutes: 62 }, // 30 + 25 + 7 (01:30 IST session)
    ]);
    expect(insights.bestHours).toEqual([
      { hour: 9, minutes: 87 },
      { hour: 10, minutes: 25 },
      { hour: 1, minutes: 7 },
    ]);
    expect(insights.weekly).toBeUndefined(); // 7d uses the daily series only
  });

  it('30d: same window values plus Monday weekly buckets (zero-filled)', async () => {
    const user = await createDirectUser({ timezone: 'Asia/Kolkata' });
    const { deviceId } = await createTestDevice({ ownerId: user._id });
    for (const session of KOLKATA_SESSIONS) {
      await Session.create({
        userId: user._id,
        deviceId,
        startedAt: new Date(session.startedAt),
        plannedMinutes: 60,
        actualMinutes: session.actualMinutes,
        status: session.status,
        source: 'MANUAL',
        clientSessionId: randomUUID(),
        endReason:
          session.status === 'COMPLETED'
            ? 'COMPLETED'
            : session.status === 'CANCELLED'
              ? 'USER'
              : null,
        lastHeartbeatAt: new Date(session.startedAt),
      });
    }

    const insights = await getInsights(String(user._id), { range: '30d' }, { now: NOW_FN });

    expect(insights.totals.focusMinutes).toBe(119);
    expect(insights.weekly).toEqual([
      { weekStart: '2026-10-05', minutes: 0 },
      { weekStart: '2026-10-12', minutes: 0 },
      { weekStart: '2026-10-19', minutes: 0 },
      { weekStart: '2026-10-26', minutes: 12 },
      { weekStart: '2026-11-02', minutes: 107 },
    ]);
  });

  it('90d: includes older history, keeps the 7-day daily series and totals honest', async () => {
    const user = await createDirectUser({ timezone: 'Asia/Kolkata' });
    const { deviceId } = await createTestDevice({ ownerId: user._id });
    for (const session of KOLKATA_SESSIONS) {
      await Session.create({
        userId: user._id,
        deviceId,
        startedAt: new Date(session.startedAt),
        plannedMinutes: 60,
        actualMinutes: session.actualMinutes,
        status: session.status,
        source: 'MANUAL',
        clientSessionId: randomUUID(),
        endReason:
          session.status === 'COMPLETED'
            ? 'COMPLETED'
            : session.status === 'CANCELLED'
              ? 'USER'
              : null,
        lastHeartbeatAt: new Date(session.startedAt),
      });
    }

    const insights = await getInsights(String(user._id), { range: '90d' }, { now: NOW_FN });

    expect(insights.totals).toMatchObject({
      focusMinutes: 219, // + 100 from Sep 1
      sessions: 9,
      completed: 8,
      cancelled: 1,
      completionRate: 0.889,
    });
    expect(insights.bestHours?.[0]).toEqual({ hour: 9, minutes: 187 });
    expect(insights.weekly).toHaveLength(14);
    const sepWeek = insights.weekly?.find((bucket) => bucket.weekStart === '2026-08-31');
    expect(sepWeek?.minutes).toBe(100);
    expect(insights.weekly?.reduce((sum, bucket) => sum + bucket.minutes, 0)).toBe(219);
  });

  it('honours the query timezone override (UTC shifts local day/hour attribution)', async () => {
    const user = await createDirectUser({ timezone: 'Asia/Kolkata' });
    const { deviceId } = await createTestDevice({ ownerId: user._id });
    for (const session of KOLKATA_SESSIONS) {
      await Session.create({
        userId: user._id,
        deviceId,
        startedAt: new Date(session.startedAt),
        plannedMinutes: 60,
        actualMinutes: session.actualMinutes,
        status: session.status,
        source: 'MANUAL',
        clientSessionId: randomUUID(),
        endReason:
          session.status === 'COMPLETED'
            ? 'COMPLETED'
            : session.status === 'CANCELLED'
              ? 'USER'
              : null,
        lastHeartbeatAt: new Date(session.startedAt),
      });
    }

    const insights = await getInsights(
      String(user._id),
      { range: '7d', timezone: 'UTC' },
      { now: NOW_FN },
    );

    expect(insights.timezone).toBe('UTC');
    expect(insights.totals.focusMinutes).toBe(119); // same sessions, same minutes
    expect(insights.daily.at(-2)).toEqual({ date: '2026-11-04', minutes: 27 }); // 20 + the 7-minute one
    expect(insights.daily.at(-1)).toEqual({ date: '2026-11-05', minutes: 55 });
    expect(insights.bestHours).toEqual([
      { hour: 3, minutes: 87 },
      { hour: 4, minutes: 25 },
      { hour: 20, minutes: 7 },
    ]);
  });

  it('is empty-safe: zero totals/rate, zero-filled 7-day series, 90d weekly buckets', async () => {
    const user = await createDirectUser({ timezone: 'Asia/Kolkata' });

    const insights = await getInsights(String(user._id), { range: '90d' }, { now: NOW_FN });

    expect(insights.totals).toEqual({
      focusMinutes: 0,
      sessions: 0,
      completed: 0,
      cancelled: 0,
      completionRate: 0,
      currentStreak: 0,
      longestStreak: 0,
    });
    expect(insights.daily).toHaveLength(7);
    expect(insights.daily.every((point) => point.minutes === 0)).toBe(true);
    expect(insights.weekly).toHaveLength(14);
    expect(insights.bestHours).toEqual([]);
  });

  it('attributes a Europe/London DST fall-back correctly (both 01:30s are one local day/hour)', async () => {
    const user = await createDirectUser({ timezone: 'Europe/London' });
    const { deviceId } = await createTestDevice({ ownerId: user._id });
    const londonSessions: SessionFixture[] = [
      { startedAt: '2026-10-24T23:30:00.000Z', actualMinutes: 10, status: 'COMPLETED' }, // 00:30 BST Oct 25
      { startedAt: '2026-10-25T00:30:00.000Z', actualMinutes: 30, status: 'COMPLETED' }, // 01:30 BST Oct 25
      { startedAt: '2026-10-25T01:30:00.000Z', actualMinutes: 20, status: 'COMPLETED' }, // 01:30 GMT Oct 25
    ];
    for (const session of londonSessions) {
      await Session.create({
        userId: user._id,
        deviceId,
        startedAt: new Date(session.startedAt),
        plannedMinutes: 60,
        actualMinutes: session.actualMinutes,
        status: session.status,
        source: 'MANUAL',
        clientSessionId: randomUUID(),
        endReason: 'COMPLETED',
        lastHeartbeatAt: new Date(session.startedAt),
      });
    }

    const insights = await getInsights(String(user._id), { range: '30d' }, { now: NOW_FN });

    expect(insights.timezone).toBe('Europe/London');
    expect(insights.totals.focusMinutes).toBe(60);
    expect(insights.totals.sessions).toBe(3);
    expect(insights.bestHours).toEqual([
      { hour: 1, minutes: 50 }, // both 01:30 instants collapse into the same local hour
      { hour: 0, minutes: 10 },
    ]);
    expect(insights.daily.every((point) => point.minutes === 0)).toBe(true); // Oct 25 is outside the last 7 local days
    expect(insights.weekly?.reduce((sum, bucket) => sum + bucket.minutes, 0)).toBe(60);
    expect(insights.weekly?.find((bucket) => bucket.weekStart === '2026-10-19')).toEqual({
      weekStart: '2026-10-19',
      minutes: 60,
    });
  });
});

describe('GET /api/v1/insights — HTTP contract (contract §3.1 #21)', () => {
  it('returns 200 for a USER token with the frozen query/response shape', async () => {
    await createDirectUser({ timezone: 'Asia/Kolkata', email: 'insights@demo.com' });
    const token = await login(app, 'insights@demo.com');

    const response = await request(app).get('/api/v1/insights?range=30d').set(bearer(token));

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      range: '30d',
      timezone: 'Asia/Kolkata',
      totals: expect.objectContaining({ sessions: 0, completionRate: 0 }),
      daily: expect.any(Array),
      bestHours: [],
    });
    expect(response.body.data.daily).toHaveLength(7);
    expect(response.body.data.totals.sessions).toBe(0);
  });

  it('defaults the range to 7d and rejects unknown ranges/timezones with 400', async () => {
    await createDirectUser({ timezone: 'UTC', email: 'insights2@demo.com' });
    const token = await login(app, 'insights2@demo.com');

    const defaultRange = await request(app).get('/api/v1/insights').set(bearer(token));
    const badRange = await request(app).get('/api/v1/insights?range=1y').set(bearer(token));
    const badZone = await request(app)
      .get('/api/v1/insights?range=7d&timezone=Mars/Olympus')
      .set(bearer(token));

    expect(defaultRange.status).toBe(200);
    expect(defaultRange.body.data.range).toBe('7d');
    expect(badRange.status).toBe(400);
    expect(badZone.status).toBe(400);
  });

  it('requires authentication (401) and rejects ADMIN tokens (403)', async () => {
    await createDirectUser({ timezone: 'UTC', email: 'admin.insights@demo.com', role: 'ADMIN' });
    const adminToken = await login(app, 'admin.insights@demo.com');

    const unauthenticated = await request(app).get('/api/v1/insights');
    const asAdmin = await request(app).get('/api/v1/insights').set(bearer(adminToken));

    expect(unauthenticated.status).toBe(401);
    expect(asAdmin.status).toBe(403);
    expect(asAdmin.body.error.code).toBe('FORBIDDEN');
  });
});
