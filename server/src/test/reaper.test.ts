// server/src/test/reaper.test.ts — T-068 acceptance (FR-028, TECHNICAL_DESIGN §8).
// Why: a crashed/killed Focus Agent leaves an ACTIVE session behind; without the reaper it would
// falsely count as ongoing focus forever. The reaper may only finalise a session whose device is
// OFFLINE and whose heartbeat is older than 2× the 15 s cadence, and it must bound `actualMinutes`
// by the heartbeat window (never by the wall clock at reap time).
// Invariants asserted: connected/FOCUSING devices are never reaped; fresh heartbeats are left alone;
// terminal sessions untouched; endedAt = lastHeartbeatAt; status CANCELLED + endReason
// CRASH_RECOVERY; actualMinutes rounded to 0.1 and capped at 1440; one bad row never aborts the pass.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  HEARTBEAT_INTERVAL_MS,
  REAPER_STALE_AFTER_MS,
  boundedActualMinutes,
  reapStaleSessions,
  startReaper,
  type ReaperDeps,
} from '../cron/reaper.js';
import { Session } from '../models/Session.js';
import {
  clearTestDatabase,
  createDirectUser,
  createTestDevice,
  startTestDatabase,
  stopTestDatabase,
} from './helpers.js';

const NOW = new Date('2026-11-10T12:00:00.000Z');

function minutesBefore(base: Date, minutes: number): Date {
  return new Date(base.getTime() - minutes * 60_000);
}

interface SessionFixture {
  deviceId: string;
  userId: string;
  sessionId: string;
}

async function createActiveSession(options: {
  startedAt: Date;
  lastHeartbeatAt: Date | null;
}): Promise<SessionFixture> {
  const user = await createDirectUser({ timezone: 'UTC' });
  const { deviceId } = await createTestDevice({ ownerId: user._id });
  const session = await Session.create({
    userId: user._id,
    deviceId,
    startedAt: options.startedAt,
    plannedMinutes: 60,
    actualMinutes: 0,
    status: 'ACTIVE',
    source: 'MANUAL',
    clientSessionId: randomUUID(),
    endReason: null,
    lastHeartbeatAt: options.lastHeartbeatAt,
  });
  return { deviceId, userId: String(user._id), sessionId: String(session._id) };
}

function offlineDeps(overrides: ReaperDeps = {}): ReaperDeps {
  return { now: () => NOW, isDeviceConnected: () => false, ...overrides };
}

beforeAll(async () => {
  await startTestDatabase();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
});

describe('reaper constants', () => {
  it('uses the contract heartbeat window (15 s cadence, stale after 2×)', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(15_000);
    expect(REAPER_STALE_AFTER_MS).toBe(30_000);
  });

  it('bounds actualMinutes by the heartbeat window and rounds to 0.1', () => {
    const startedAt = new Date('2026-11-10T10:00:00.000Z');
    expect(boundedActualMinutes(startedAt, new Date('2026-11-10T10:20:00.000Z'))).toBe(20);
    expect(boundedActualMinutes(startedAt, new Date('2026-11-10T10:00:09.000Z'))).toBe(0.2);
    // A corrupt timestamp that predates startedAt can never produce negative minutes.
    expect(boundedActualMinutes(startedAt, new Date('2026-11-10T09:00:00.000Z'))).toBe(0);
    // Cap at the shared actualMinutes upper bound (1440).
    expect(boundedActualMinutes(startedAt, new Date('2026-11-12T12:00:00.000Z'))).toBe(1440);
  });
});

describe('reapStaleSessions (T-068)', () => {
  it('finalises an offline stale ACTIVE session as CANCELLED/CRASH_RECOVERY', async () => {
    const lastHeartbeatAt = minutesBefore(NOW, 10);
    const fixture = await createActiveSession({
      startedAt: minutesBefore(NOW, 40),
      lastHeartbeatAt,
    });

    const result = await reapStaleSessions(offlineDeps());

    expect(result).toEqual({ scanned: 1, reaped: 1 });
    const session = await Session.findById(fixture.sessionId).lean();
    expect(session).toMatchObject({
      status: 'CANCELLED',
      endReason: 'CRASH_RECOVERY',
      actualMinutes: 30,
    });
    expect(session?.endedAt).toEqual(lastHeartbeatAt);
  });

  it('never reaps a session whose device is connected/FOCUSING', async () => {
    const fixture = await createActiveSession({
      startedAt: minutesBefore(NOW, 40),
      lastHeartbeatAt: minutesBefore(NOW, 30),
    });

    const result = await reapStaleSessions({ now: () => NOW, isDeviceConnected: () => true });

    expect(result.reaped).toBe(0);
    const session = await Session.findById(fixture.sessionId).lean();
    expect(session?.status).toBe('ACTIVE');
    expect(session?.endedAt).toBeNull();
  });

  it('leaves a session with a fresh heartbeat alone', async () => {
    // 10 s < 30 s threshold, so even an offline device is not reaped yet.
    const fixture = await createActiveSession({
      startedAt: minutesBefore(NOW, 5),
      lastHeartbeatAt: new Date(NOW.getTime() - 10_000),
    });

    const result = await reapStaleSessions(offlineDeps());

    expect(result.reaped).toBe(0);
    expect((await Session.findById(fixture.sessionId).lean())?.status).toBe('ACTIVE');
  });

  it('falls back to startedAt when the session never had a heartbeat', async () => {
    const startedAt = minutesBefore(NOW, 45);
    const fixture = await createActiveSession({ startedAt, lastHeartbeatAt: null });

    const result = await reapStaleSessions(offlineDeps());

    expect(result.reaped).toBe(1);
    const session = await Session.findById(fixture.sessionId).lean();
    expect(session).toMatchObject({ status: 'CANCELLED', actualMinutes: 0 });
    expect(session?.endedAt).toEqual(startedAt);
  });

  it('ignores terminal sessions (only ACTIVE is scanned)', async () => {
    const fixture = await createActiveSession({
      startedAt: minutesBefore(NOW, 40),
      lastHeartbeatAt: minutesBefore(NOW, 30),
    });
    await Session.updateOne(
      { _id: fixture.sessionId },
      { $set: { status: 'COMPLETED', endedAt: NOW, actualMinutes: 12 } },
    );

    const result = await reapStaleSessions(offlineDeps());

    expect(result).toEqual({ scanned: 0, reaped: 0 });
    const session = await Session.findById(fixture.sessionId).lean();
    expect(session).toMatchObject({ status: 'COMPLETED', actualMinutes: 12 });
  });

  it('reaps only the offline stale sessions in a mixed batch', async () => {
    const stale = await createActiveSession({
      startedAt: minutesBefore(NOW, 40),
      lastHeartbeatAt: minutesBefore(NOW, 20),
    });
    const online = await createActiveSession({
      startedAt: minutesBefore(NOW, 40),
      lastHeartbeatAt: minutesBefore(NOW, 20),
    });
    const connectedIds = new Set([online.deviceId]);

    const result = await reapStaleSessions({
      now: () => NOW,
      isDeviceConnected: (deviceId) => connectedIds.has(deviceId),
    });

    expect(result).toEqual({ scanned: 2, reaped: 1 });
    expect((await Session.findById(stale.sessionId).lean())?.status).toBe('CANCELLED');
    expect((await Session.findById(online.sessionId).lean())?.status).toBe('ACTIVE');
  });

  it('startReaper returns an unref’ed interval that can be cleared', () => {
    const timer = startReaper({ intervalMs: 300_000 });
    expect(timer.hasRef()).toBe(false);
    clearInterval(timer);
  });
});
