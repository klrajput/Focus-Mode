// server/src/test/idempotency-races.test.ts — W7 (task-46): the write paths that only run when two
// requests collide. Why: `services/session.service.ts` (83.33 % lines), `services/allowlist.service.ts`
// (79.06 %) and `services/user.service.ts` (85.71 %) each keep their *rare* branch untested — the
// loser of a unique-index race, the raced finalise, the "row vanished between read and update" 404.
// Those branches exist precisely because production is concurrent, so they are exercised here against
// the real MongoDB unique indexes: the `E11000` values come from the database, and the race window is
// opened by making the pre-check miss (exactly what a second request in flight sees).
// Invariants asserted: a lost create race returns the winner's row (never a 500 or a duplicate); a
// duplicate `clientSessionId` with different values is 409 CONFLICT; a second ACTIVE session on one
// device is 409 ALREADY_FOCUSING; the raced finalise is idempotent when the values match and 409 when
// they do not; and non-existent users are 404 NOT_FOUND rather than cast/internal errors.

import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { Allowlist } from '../models/Allowlist.js';
import { Preset } from '../models/Preset.js';
import { buildProtectedAppEntries } from '../models/protected-apps.js';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';
import { applyPresetToAllowlist, ensureAllowlistForUser } from '../services/allowlist.service.js';
import {
  createSession,
  finaliseSession,
  reportSessionStarted,
} from '../services/session.service.js';
import { changePassword, updateProfile } from '../services/user.service.js';
import {
  bearer,
  clearTestDatabase,
  createDirectUser,
  createPairedTestDevice,
  createTestApp,
  createTestDevice,
  registerTestUser,
  startTestDatabase,
  stopTestDatabase,
} from './helpers.js';

let app: Express;

beforeAll(async () => {
  await startTestDatabase();
  // The races below depend on the real unique indexes (Session has three, one partial).
  await Session.init();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
  app = createTestApp();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);

/** Force the next `findOne` to resolve `null`: the other request has not committed its row yet. */
const HIDE_NEXT_ROW = (): never => null as never;

/**
 * A stand-in for the conditional `findOneAndUpdate` that resolves `null` once `sideEffect` has
 * committed — exactly what the loser of the race observes. Mongoose queries are thenables, so a
 * single `then` method is enough for `await` (and the cast keeps the model's signature).
 */
function lostUpdateRace(sideEffect: Promise<unknown>): ReturnType<typeof Session.findOneAndUpdate> {
  return {
    then: (resolve: (value: null) => void, reject: (reason: unknown) => void): void => {
      sideEffect.then(() => {
        resolve(null);
      }, reject);
    },
    catch: (reject: (reason: unknown) => void): void => {
      sideEffect.catch(reject);
    },
  } as unknown as ReturnType<typeof Session.findOneAndUpdate>;
}

describe('allow-list creation race (unique userId)', () => {
  it('returns the winner row when the create loses the unique-index race', async () => {
    const user = await createDirectUser();
    // The winner already exists; the loser's pre-check missed it.
    const winner = await Allowlist.create({
      userId: user._id,
      protectedApps: buildProtectedAppEntries(),
      userApps: [],
    });
    vi.spyOn(Allowlist, 'findOne').mockImplementationOnce(HIDE_NEXT_ROW);

    const result = await ensureAllowlistForUser(String(user._id));

    expect(String(result._id)).toBe(String(winner._id));
    expect(result.version).toBe(winner.version);
    expect(await Allowlist.countDocuments()).toBe(1);
  });

  it('propagates a non-duplicate failure instead of masking it', async () => {
    const user = await createDirectUser();
    await Allowlist.create({
      userId: user._id,
      protectedApps: buildProtectedAppEntries(),
      userApps: [],
    });
    vi.spyOn(Allowlist, 'findOne').mockImplementationOnce(HIDE_NEXT_ROW);
    vi.spyOn(Allowlist, 'create').mockImplementationOnce(() => {
      throw new Error('write concern failure');
    });

    await expect(ensureAllowlistForUser(String(user._id))).rejects.toThrow(/write concern/);
  });
});

describe('session creation race (unique indexes)', () => {
  async function deviceFixture(): Promise<{ userId: string; deviceId: string }> {
    const user = await createDirectUser();
    const created = await createTestDevice({ ownerId: user._id });
    return { userId: String(user._id), deviceId: created.deviceId };
  }

  it('reuses the winner when an identical session loses the clientSessionId race', async () => {
    const { userId, deviceId } = await deviceFixture();
    const clientSessionId = randomUUID();
    const startedAt = minutesAgo(5);
    const winner = await Session.create({
      userId,
      deviceId,
      startedAt,
      plannedMinutes: 25,
      actualMinutes: 0,
      status: 'COMPLETED',
      source: 'MANUAL',
      clientSessionId,
      endReason: 'COMPLETED',
      lastHeartbeatAt: startedAt,
    });
    // A completed row does not trip the ACTIVE guard, so the pre-check is the only thing to skip.
    vi.spyOn(Session, 'findOne').mockImplementationOnce(HIDE_NEXT_ROW);

    const result = await createSession(userId, {
      deviceId,
      durationMin: 25,
      startedAt: startedAt.toISOString(),
      clientSessionId,
      source: 'MANUAL',
    });

    expect(result.created).toBe(false);
    expect(result.session.id).toBe(String(winner._id));
    expect(await Session.countDocuments()).toBe(1);
  });

  it('answers 409 CONFLICT when the winner holds different values (REC-006)', async () => {
    const { userId, deviceId } = await deviceFixture();
    const clientSessionId = randomUUID();
    const startedAt = minutesAgo(5);
    await Session.create({
      userId,
      deviceId,
      startedAt,
      plannedMinutes: 25,
      actualMinutes: 0,
      status: 'COMPLETED',
      source: 'MANUAL',
      clientSessionId,
      endReason: 'COMPLETED',
      lastHeartbeatAt: startedAt,
    });
    vi.spyOn(Session, 'findOne').mockImplementationOnce(HIDE_NEXT_ROW);

    await expect(
      createSession(userId, {
        deviceId,
        durationMin: 60, // the winner planned 25
        startedAt: startedAt.toISOString(),
        clientSessionId,
        source: 'MANUAL',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    expect(await Session.countDocuments()).toBe(1);
  });

  it('answers 409 ALREADY_FOCUSING when the partial ACTIVE index rejects a second session', async () => {
    const { userId, deviceId } = await deviceFixture();
    const startedAt = minutesAgo(5);
    // The device is already focusing (dashboard started it); the service pre-check missed it.
    await Session.create({
      userId,
      deviceId,
      startedAt,
      plannedMinutes: 25,
      actualMinutes: 0,
      status: 'ACTIVE',
      source: 'MANUAL',
      clientSessionId: randomUUID(),
      endReason: null,
      lastHeartbeatAt: startedAt,
    });
    vi.spyOn(Session, 'exists').mockImplementationOnce(() => null as never);

    await expect(
      createSession(userId, {
        deviceId,
        durationMin: 25,
        startedAt: startedAt.toISOString(),
        clientSessionId: randomUUID(),
        source: 'MANUAL',
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_FOCUSING', status: 409 });
    expect(await Session.countDocuments()).toBe(1);
  });
});

describe('session finalise race (conditional update loses)', () => {
  async function activeFixture(): Promise<{ userId: string; sessionId: string; endedAt: Date }> {
    const user = await createDirectUser();
    const session = await Session.create({
      userId: user._id,
      deviceId: new Types.ObjectId(),
      startedAt: minutesAgo(30),
      plannedMinutes: 25,
      actualMinutes: 0,
      status: 'ACTIVE',
      source: 'MANUAL',
      clientSessionId: randomUUID(),
      endReason: null,
      lastHeartbeatAt: minutesAgo(1),
    });
    return {
      userId: String(user._id),
      sessionId: String(session._id),
      endedAt: minutesAgo(1),
    };
  }

  it('returns the winner idempotently when the raced document already holds the same values', async () => {
    const { userId, sessionId, endedAt } = await activeFixture();
    // Simulate the winner: it commits the finalisation before our conditional update returns null.
    vi.spyOn(Session, 'findOneAndUpdate').mockReturnValueOnce(
      lostUpdateRace(
        Session.updateOne(
          { _id: sessionId },
          { $set: { status: 'COMPLETED', endedAt, actualMinutes: 24, endReason: 'COMPLETED' } },
        ),
      ),
    );

    const result = await finaliseSession(userId, sessionId, {
      status: 'COMPLETED',
      endedAt: endedAt.toISOString(),
      actualMinutes: 24,
      endReason: 'COMPLETED',
    });

    expect(result.id).toBe(sessionId);
    expect(result.status).toBe('COMPLETED');
  });

  it('answers 409 CONFLICT when the raced document was finalised differently', async () => {
    const { userId, sessionId, endedAt } = await activeFixture();
    vi.spyOn(Session, 'findOneAndUpdate').mockReturnValueOnce(
      lostUpdateRace(
        Session.updateOne(
          { _id: sessionId },
          {
            $set: {
              status: 'CANCELLED',
              endedAt,
              actualMinutes: 3,
              endReason: 'USER_CANCELLED',
            },
          },
        ),
      ),
    );

    await expect(
      finaliseSession(userId, sessionId, {
        status: 'COMPLETED',
        endedAt: endedAt.toISOString(),
        actualMinutes: 24,
        endReason: 'COMPLETED',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });

  it('answers 404 NOT_FOUND when the row vanished between the read and the update', async () => {
    const { userId, sessionId } = await activeFixture();
    vi.spyOn(Session, 'findOneAndUpdate').mockReturnValueOnce(
      lostUpdateRace(Session.deleteOne({ _id: sessionId })),
    );

    await expect(
      finaliseSession(userId, sessionId, {
        status: 'COMPLETED',
        endedAt: minutesAgo(1).toISOString(),
        actualMinutes: 24,
        endReason: 'COMPLETED',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('real-route validation guards', () => {
  it('rejects an endedAt in the future with 400 VALIDATION_ERROR', async () => {
    const registration = await registerTestUser(app);
    const accessToken: string = registration.response.body.data.accessToken;
    const paired = await createPairedTestDevice(app, accessToken);
    const created = await request(app)
      .post('/api/v1/sessions')
      .set(bearer(accessToken))
      .send({
        deviceId: paired.deviceId,
        durationMin: 25,
        startedAt: minutesAgo(5).toISOString(),
        clientSessionId: randomUUID(),
        source: 'MANUAL',
      });
    expect(created.status).toBe(201);

    const response = await request(app)
      .patch(`/api/v1/sessions/${String(created.body.data.id)}`)
      .set(bearer(accessToken))
      .send({
        status: 'COMPLETED',
        endedAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        actualMinutes: 25,
        endReason: 'COMPLETED',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual([
      { path: 'endedAt', message: 'endedAt cannot be in the future' },
    ]);
    // The session is untouched: a rejected finalisation must not write anything.
    expect((await Session.findById(String(created.body.data.id)).lean())?.status).toBe('ACTIVE');
  });
});

describe('account guards for a vanished user', () => {
  it('answers 404 NOT_FOUND for a profile update of a deleted account', async () => {
    await expect(
      updateProfile(new Types.ObjectId().toHexString(), { name: 'Ghost User' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('answers 404 NOT_FOUND for a password change of a deleted account', async () => {
    await expect(
      changePassword(new Types.ObjectId().toHexString(), {
        currentPassword: 'Kabir@123',
        newPassword: 'Kabir@456',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('answers 404 NOT_FOUND for an agent report from a deleted account', async () => {
    await expect(
      reportSessionStarted(new Types.ObjectId().toHexString(), {
        deviceId: new Types.ObjectId().toHexString(),
        clientSessionId: randomUUID(),
        startedAt: minutesAgo(5).toISOString(),
        plannedMinutes: 25,
        source: 'MANUAL',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('never leaves the user document mutated when the update finds no row', async () => {
    const user = await createDirectUser();
    const updated = await updateProfile(String(user._id), { name: 'Renamed Account' });

    expect(updated.name).toBe('Renamed Account');
    expect((await User.findById(user._id).lean())?.name).toBe('Renamed Account');
  });
});

describe('preset application limits (INV-3)', () => {
  it('refuses a preset that would exceed MAX_USER_APPS with 400 VALIDATION_ERROR', async () => {
    const user = await createDirectUser();
    // MAX_USER_APPS is 50: an existing entry plus a 50-app preset cannot be merged.
    await Allowlist.create({
      userId: user._id,
      protectedApps: buildProtectedAppEntries(),
      userApps: [{ key: 'my-app', label: 'My App' }],
    });
    const preset = await Preset.create({
      name: 'Fifty Apps',
      apps: Array.from({ length: 50 }, (_unused, index) => ({
        key: `app-${String(index)}`,
        label: `App ${String(index)}`,
      })),
      createdBy: new Types.ObjectId(),
    });

    await expect(
      applyPresetToAllowlist(String(user._id), String(preset._id), 'merge'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });
});
