// server/src/models/models.test.ts — integration tests for all nine Mongoose models against a real
// in-memory MongoDB (T-011). They prove the database-level guarantees the API relies on:
// unique email, unique {userId, clientSessionId}, the partial unique ACTIVE-session-per-device
// index (FR-024), partial unique pairing hashes (FR-026), the canonical protected allow-list set
// (INV-3) and the TECHNICAL_DESIGN §4 index table. Uses the shared test-db harness (KI-006 cache).

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type Types } from 'mongoose';
import { ALL_PROTECTED_KEYS, type AppEntry, type EndReason } from '@focus-mode/shared';
import { AgentLink } from './AgentLink.js';
import { Allowlist } from './Allowlist.js';
import { Device, type DeviceDocument } from './Device.js';
import { Notification } from './Notification.js';
import { Preset } from './Preset.js';
import { Schedule } from './Schedule.js';
import { ScheduleRun } from './ScheduleRun.js';
import { Session } from './Session.js';
import { User, type UserDocument } from './User.js';
import { NOTIFICATION_TYPES, SCHEDULE_RUN_STATUSES } from './enums.js';
import {
  buildProtectedAppEntries,
  hasCompleteProtectedSet,
  missingProtectedKeys,
  PROTECTED_APP_ENTRIES,
} from './protected-apps.js';
import { clearCollections, startTestDatabase, type TestDatabase } from './test-db.js';

const TEST_PASSWORD_HASH = '$2b$12$0123456789012345678901uZ2i8jW8Q0iW7s9p4sJ0a8f1j2k3l4m5n';
const NOW = new Date('2026-11-10T12:00:00.000Z');

let database: TestDatabase;
let userCounter = 0;

beforeAll(async () => {
  database = await startTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await clearCollections();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function createUser(
  overrides: Partial<{ name: string; email: string; role: 'USER' | 'ADMIN' }> = {},
): Promise<UserDocument> {
  userCounter += 1;
  return User.create({
    name: overrides.name ?? `Test User ${userCounter}`,
    email: overrides.email ?? `user${userCounter}@demo.test`,
    passwordHash: TEST_PASSWORD_HASH,
    role: overrides.role ?? 'USER',
  });
}

async function createDevice(
  ownerId: Types.ObjectId | null,
  overrides: Partial<{
    name: string;
    status: 'CONNECTED' | 'DISCONNECTED' | 'FOCUSING';
    pairTokenHash: string | null;
    pairExpiresAt: Date | null;
  }> = {},
): Promise<DeviceDocument> {
  return Device.create({
    ownerId,
    name: overrides.name ?? 'Kabir-MacBook',
    os: 'macOS',
    agentVersion: '1.4.0',
    status: overrides.status ?? (ownerId ? 'CONNECTED' : 'DISCONNECTED'),
    pairTokenHash: overrides.pairTokenHash ?? null,
    pairExpiresAt: overrides.pairExpiresAt ?? null,
  });
}

interface SessionOverrides {
  status?: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  clientSessionId?: string;
  plannedMinutes?: number;
  actualMinutes?: number;
  startedAt?: Date;
  endedAt?: Date | null;
  source?: 'MANUAL' | 'SCHEDULE';
  endReason?: EndReason | null;
}

function buildSession(
  userId: Types.ObjectId,
  deviceId: Types.ObjectId,
  overrides: SessionOverrides = {},
) {
  return {
    userId,
    deviceId,
    startedAt: overrides.startedAt ?? NOW,
    endedAt: overrides.endedAt ?? null,
    plannedMinutes: overrides.plannedMinutes ?? 60,
    actualMinutes: overrides.actualMinutes ?? 0,
    status: overrides.status ?? 'ACTIVE',
    source: overrides.source ?? 'MANUAL',
    clientSessionId: overrides.clientSessionId ?? randomUUID(),
    endReason: overrides.endReason ?? null,
    lastHeartbeatAt: NOW,
  };
}

/** Assert the write was rejected by a Mongo unique index (error code 11000). */
async function expectDuplicateKey(operation: Promise<unknown>, message: string): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect((error as { code?: number }).code, message).toBe(11000);
    return;
  }
  throw new Error(`Expected E11000 duplicate-key rejection: ${message}`);
}

const APP_ENTRY: AppEntry = {
  key: 'vscode',
  label: 'Visual Studio Code',
  win: ['Code.exe'],
  mac: ['com.microsoft.VSCode'],
  linux: ['code'],
};

// ---------------------------------------------------------------------------
// users (TECHNICAL_DESIGN §4, FR-001)
// ---------------------------------------------------------------------------

describe('User model', () => {
  it('applies defaults, normalises the email and keeps passwordHash out of default queries', async () => {
    const created = await User.create({
      name: 'Kabir',
      email: 'Kabir@Demo.com',
      passwordHash: TEST_PASSWORD_HASH,
    });

    expect(created.email).toBe('kabir@demo.com');
    expect(created.role).toBe('USER');
    expect(created.defaultDurationMin).toBe(60);
    expect(created.timezone).toBe('UTC');
    expect(created.isActive).toBe(true);
    expect(created.lastLoginAt).toBeNull();
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);

    const withoutHash = await User.findById(created._id);
    expect(withoutHash).not.toBeNull();
    expect(withoutHash?.passwordHash).toBeUndefined();

    const withHash = await User.findById(created._id).select('+passwordHash');
    expect(withHash?.passwordHash).toBe(TEST_PASSWORD_HASH);
  });

  it('rejects a duplicate email (case-insensitive) with E11000', async () => {
    await createUser({ email: 'kabir@demo.com' });
    await expectDuplicateKey(
      createUser({ email: 'KABIR@DEMO.COM' }),
      'one account per email (FR-001 unique index)',
    );
  });

  it('validates required fields and the role enum', async () => {
    const missingName = new User({ email: 'noname@demo.com', passwordHash: TEST_PASSWORD_HASH });
    await expect(missingName.validate()).rejects.toThrow();

    const badRole = await createUser();
    badRole.set('role', 'SUPERADMIN');
    await expect(badRole.validate()).rejects.toThrow(/valid enum value/);

    const badDuration = await createUser();
    badDuration.set('defaultDurationMin', 0);
    await expect(badDuration.validate()).rejects.toThrow(/minimum allowed value/);
  });
});

// ---------------------------------------------------------------------------
// devices (TECHNICAL_DESIGN §4, FR-026, DEC-014)
// ---------------------------------------------------------------------------

describe('Device model', () => {
  it('defaults a pending device to DISCONNECTED with no owner', async () => {
    const pending = await createDevice(null);
    expect(pending.ownerId).toBeNull();
    expect(pending.status).toBe('DISCONNECTED');
    expect(pending.pairAttempts).toBe(0);
    expect(pending.pairedAt).toBeNull();
    expect(pending.deviceTokenHash).toBeNull();
  });

  it('rejects two pending devices sharing the same pairTokenHash (partial unique index)', async () => {
    const hash = 'a'.repeat(64);
    await createDevice(null, {
      pairTokenHash: hash,
      pairExpiresAt: new Date(NOW.getTime() + 600_000),
    });
    await expectDuplicateKey(
      createDevice(null, {
        pairTokenHash: hash,
        pairExpiresAt: new Date(NOW.getTime() + 600_000),
      }),
      'a pairing code hash points to at most one pending device (FR-026)',
    );
  });

  it('allows many paired devices without a pairTokenHash', async () => {
    const owner = await createUser();
    await createDevice(owner._id, { name: 'Kabir-MacBook', status: 'CONNECTED' });
    await createDevice(owner._id, { name: 'Kabir-Windows', status: 'DISCONNECTED' });
    expect(await Device.countDocuments({ ownerId: owner._id })).toBe(2);
  });

  it('validates the os enum and the SHA-256 shape of the pairing hash', async () => {
    const badOs = await createDevice(null);
    badOs.set('os', 'beOS');
    await expect(badOs.validate()).rejects.toThrow(/valid enum value/);

    const badHash = await createDevice(null);
    badHash.set('pairTokenHash', 'not-a-sha256-hash');
    await expect(badHash.validate()).rejects.toThrow(/Invalid hash/);
  });
});

// ---------------------------------------------------------------------------
// sessions (TECHNICAL_DESIGN §4, FR-024, REC-006)
// ---------------------------------------------------------------------------

describe('Session model', () => {
  it('enforces one ACTIVE session per device (partial unique index, FR-024)', async () => {
    const owner = await createUser();
    const device = await createDevice(owner._id);
    await Session.create(buildSession(owner._id, device._id));
    await expectDuplicateKey(
      Session.create(buildSession(owner._id, device._id)),
      'second ACTIVE session for the same device must be rejected',
    );
  });

  it('allows a finished session and a new ACTIVE session on the same device', async () => {
    const owner = await createUser();
    const device = await createDevice(owner._id);
    const finished = await Session.create(
      buildSession(owner._id, device._id, {
        status: 'COMPLETED',
        endedAt: new Date(NOW.getTime() + 3_600_000),
        actualMinutes: 60,
        endReason: 'COMPLETED',
      }),
    );
    await Session.create(buildSession(owner._id, device._id));
    expect(await Session.countDocuments({ deviceId: device._id })).toBe(2);
    expect(finished.status).toBe('COMPLETED');
  });

  it('allows one ACTIVE session on each different device', async () => {
    const owner = await createUser();
    const macbook = await createDevice(owner._id, { name: 'Kabir-MacBook' });
    const windows = await createDevice(owner._id, { name: 'Kabir-Windows' });
    await Session.create(buildSession(owner._id, macbook._id));
    await Session.create(buildSession(owner._id, windows._id));
    expect(await Session.countDocuments({ status: 'ACTIVE' })).toBe(2);
  });

  it('rejects a duplicate clientSessionId for the same user but allows it for another user', async () => {
    const owner = await createUser();
    const other = await createUser();
    const deviceA = await createDevice(owner._id, { name: 'Device A' });
    const deviceB = await createDevice(owner._id, { name: 'Device B' });
    const deviceC = await createDevice(other._id, { name: 'Device C' });
    const clientSessionId = randomUUID();
    await Session.create(
      buildSession(owner._id, deviceA._id, {
        clientSessionId,
        status: 'COMPLETED',
        endedAt: NOW,
        endReason: 'COMPLETED',
      }),
    );
    await expectDuplicateKey(
      Session.create(
        buildSession(owner._id, deviceB._id, {
          clientSessionId,
          status: 'COMPLETED',
          endedAt: NOW,
          endReason: 'COMPLETED',
        }),
      ),
      'clientSessionId is the per-user idempotency key (REC-006)',
    );
    await Session.create(
      buildSession(other._id, deviceC._id, {
        clientSessionId,
        status: 'COMPLETED',
        endedAt: NOW,
        endReason: 'COMPLETED',
      }),
    );
    expect(await Session.countDocuments({ clientSessionId })).toBe(2);
  });

  it('validates clientSessionId as a UUID and plannedMinutes bounds', async () => {
    const owner = await createUser();
    const device = await createDevice(owner._id);
    const badUuid = new Session(
      buildSession(owner._id, device._id, { clientSessionId: 'not-a-uuid' }),
    );
    await expect(badUuid.validate()).rejects.toThrow(/clientSessionId must be a UUID/);

    const badDuration = new Session(buildSession(owner._id, device._id, { plannedMinutes: 0 }));
    await expect(badDuration.validate()).rejects.toThrow(/minimum allowed value/);
  });
});

// ---------------------------------------------------------------------------
// allowlists (TECHNICAL_DESIGN §4, FR-008, INV-3)
// ---------------------------------------------------------------------------

describe('Allowlist model', () => {
  it('enforces one allow-list per user (unique userId)', async () => {
    const owner = await createUser();
    await Allowlist.create({ userId: owner._id, protectedApps: buildProtectedAppEntries() });
    await expectDuplicateKey(
      Allowlist.create({ userId: owner._id, protectedApps: buildProtectedAppEntries() }),
      'exactly one allow-list per user',
    );
  });

  it('stores the complete protected set from shared/protected.ts (INV-3)', async () => {
    expect(missingProtectedKeys(buildProtectedAppEntries())).toEqual([]);
    expect(hasCompleteProtectedSet(PROTECTED_APP_ENTRIES)).toBe(true);
    expect(
      buildProtectedAppEntries()
        .map((entry) => entry.key)
        .sort(),
    ).toEqual([...ALL_PROTECTED_KEYS].sort());

    const owner = await createUser();
    const allowlist = await Allowlist.create({
      userId: owner._id,
      protectedApps: buildProtectedAppEntries(),
      userApps: [APP_ENTRY],
    });
    expect(allowlist.protectedApps).toHaveLength(ALL_PROTECTED_KEYS.length);
    expect(allowlist.userApps.map((entry) => entry.key)).toEqual([APP_ENTRY.key]);
    expect(allowlist.userApps[0]?.label).toBe(APP_ENTRY.label);
    expect(allowlist.userApps[0]?.mac).toEqual(APP_ENTRY.mac);
    expect(allowlist.version).toBe(1);
    expect(hasCompleteProtectedSet(allowlist.protectedApps)).toBe(true);
  });

  it('rejects an empty protected set, duplicate user-app keys and more than 50 user apps', async () => {
    const owner = await createUser();
    const emptyProtected = new Allowlist({ userId: owner._id, protectedApps: [] });
    await expect(emptyProtected.validate()).rejects.toThrow();

    const duplicated: AppEntry[] = [APP_ENTRY, { ...APP_ENTRY, label: 'Vs Code again' }];
    const duplicateApps = new Allowlist({
      userId: owner._id,
      protectedApps: buildProtectedAppEntries(),
      userApps: duplicated,
    });
    await expect(duplicateApps.validate()).rejects.toThrow(/unique keys/);

    const tooMany: AppEntry[] = Array.from({ length: 51 }, (_, index) => ({
      key: `test-app-${String(index).padStart(2, '0')}`,
      label: `Test app ${index}`,
    }));
    const tooManyApps = new Allowlist({
      userId: owner._id,
      protectedApps: buildProtectedAppEntries(),
      userApps: tooMany,
    });
    await expect(tooManyApps.validate()).rejects.toThrow(/unique keys|At most/);
  });
});

// ---------------------------------------------------------------------------
// schedules / presets / scheduleRuns / notifications / agentLinks
// ---------------------------------------------------------------------------

describe('Schedule model', () => {
  it('creates an enabled schedule with sane defaults', async () => {
    const owner = await createUser();
    const schedule = await Schedule.create({
      userId: owner._id,
      name: 'Deep Work Morning',
      days: [1, 2, 3, 4, 5],
      startTime: '09:00',
      durationMin: 60,
    });
    expect(schedule.enabled).toBe(true);
    expect(schedule.lastRunAt).toBeNull();
    expect(schedule.createdAt).toBeInstanceOf(Date);
  });

  it('validates days, startTime and durationMin', async () => {
    const owner = await createUser();
    const noDays = new Schedule({
      userId: owner._id,
      name: 'No days',
      days: [],
      startTime: '09:00',
      durationMin: 60,
    });
    await expect(noDays.validate()).rejects.toThrow(/non-empty/);

    const badDay = new Schedule({
      userId: owner._id,
      name: 'Bad day',
      days: [7],
      startTime: '09:00',
      durationMin: 60,
    });
    await expect(badDay.validate()).rejects.toThrow(/non-empty/);

    const badTime = new Schedule({
      userId: owner._id,
      name: 'Bad time',
      days: [1],
      startTime: '9:00',
      durationMin: 60,
    });
    await expect(badTime.validate()).rejects.toThrow(/HH:mm/);
  });
});

describe('Preset model', () => {
  it('enforces a unique name (admin create returns 409 on E11000)', async () => {
    const admin = await createUser({ role: 'ADMIN' });
    await Preset.create({ name: 'Coding Session', apps: [APP_ENTRY], createdBy: admin._id });
    await expectDuplicateKey(
      Preset.create({ name: 'Coding Session', apps: [APP_ENTRY], createdBy: admin._id }),
      'preset names are unique',
    );
  });

  it('rejects an empty app list', async () => {
    const admin = await createUser({ role: 'ADMIN' });
    const empty = new Preset({ name: 'Empty', apps: [], createdBy: admin._id });
    await expect(empty.validate()).rejects.toThrow(/1-50/);
  });
});

describe('ScheduleRun model', () => {
  it('records a MISSED run without a device and validates the status enum', async () => {
    const owner = await createUser();
    const schedule = await Schedule.create({
      userId: owner._id,
      name: 'Deep Work Morning',
      days: [1],
      startTime: '09:00',
      durationMin: 60,
    });
    const missed = await ScheduleRun.create({
      scheduleId: schedule._id,
      userId: owner._id,
      deviceId: null,
      firedAt: atHour(NOW, 9),
      status: 'MISSED',
    });
    expect(missed.status).toBe('MISSED');
    expect(missed.deviceId).toBeNull();
    expect(missed.sessionId).toBeNull();
    expect(SCHEDULE_RUN_STATUSES).toContain('CANCELLED_BY_USER');

    const badStatus = new ScheduleRun({
      scheduleId: schedule._id,
      userId: owner._id,
      firedAt: atHour(NOW, 9),
      status: 'STARTED',
    });
    badStatus.set('status', 'EXPLODED');
    await expect(badStatus.validate()).rejects.toThrow(/valid enum value/);
  });

  it('links a run to its confirming session and defaults sessionId to null (DEC-021)', async () => {
    const owner = await createUser();
    const device = await createDevice(owner._id);
    const schedule = await Schedule.create({
      userId: owner._id,
      name: 'Deep Work Morning',
      days: [1],
      startTime: '09:00',
      durationMin: 60,
    });
    const confirmedSession = await Session.create(
      buildSession(owner._id, device._id, {
        status: 'COMPLETED',
        endedAt: new Date(NOW.getTime() + 3_600_000),
        actualMinutes: 60,
        endReason: 'COMPLETED',
        source: 'SCHEDULE',
      }),
    );

    // Dispatched but not yet confirmed: null sessionId (scheduleDue sent, no focus started).
    const dispatched = await ScheduleRun.create({
      scheduleId: schedule._id,
      userId: owner._id,
      deviceId: device._id,
      firedAt: atHour(NOW, 9),
      status: 'STARTED',
    });
    expect(dispatched.sessionId).toBeNull();

    // Confirmed by session.started carrying this runId (DEC-021).
    const confirmed = await ScheduleRun.create({
      scheduleId: schedule._id,
      userId: owner._id,
      deviceId: device._id,
      firedAt: atHour(NOW, 9),
      status: 'STARTED',
      sessionId: confirmedSession._id,
    });
    expect(confirmed.sessionId?.toString()).toBe(confirmedSession._id.toString());

    // DEC-021 adds no lifecycle status: the frozen enum is unchanged.
    expect([...SCHEDULE_RUN_STATUSES]).toEqual(['STARTED', 'MISSED', 'CANCELLED_BY_USER']);
  });
});

describe('Notification model', () => {
  it('defaults to unread and validates the notification type enum', async () => {
    const owner = await createUser();
    const notification = await Notification.create({
      userId: owner._id,
      type: 'SCHEDULE_MISSED',
      message: 'Missed "Deep Work Morning"',
    });
    expect(notification.readAt).toBeNull();
    expect(NOTIFICATION_TYPES).toContain('SCHEDULE_MISSED');

    const badType = new Notification({
      userId: owner._id,
      type: 'SCHEDULE_MISSED',
      message: 'x',
    });
    badType.set('type', 'NOT_A_TYPE');
    await expect(badType.validate()).rejects.toThrow(/valid enum value/);
  });
});

describe('AgentLink model', () => {
  it('accepts an https installer URL and defaults publishedAt', async () => {
    const admin = await createUser({ role: 'ADMIN' });
    const link = await AgentLink.create({
      os: 'macOS',
      arch: 'arm64',
      label: 'macOS (Apple silicon)',
      url: 'https://github.com/klrajput/Focus-Mode/releases',
      version: '1.4.0',
      publishedBy: admin._id,
    });
    expect(link.publishedAt).toBeInstanceOf(Date);
    expect(link.arch).toBe('arm64');
  });

  it('rejects a non-http url and a non-semver version', async () => {
    const admin = await createUser({ role: 'ADMIN' });
    const badUrl = new AgentLink({
      os: 'windows',
      arch: 'x64',
      label: 'Windows build',
      url: 'javascript:alert(1)',
      version: '1.4.0',
      publishedBy: admin._id,
    });
    await expect(badUrl.validate()).rejects.toThrow(/absolute http\(s\) URL/);

    const badVersion = new AgentLink({
      os: 'linux',
      arch: 'x64',
      label: 'Linux build',
      url: 'https://github.com/klrajput/Focus-Mode/releases',
      version: 'latest',
      publishedBy: admin._id,
    });
    await expect(badVersion.validate()).rejects.toThrow(/semver/);
  });
});

// ---------------------------------------------------------------------------
// TECHNICAL_DESIGN §4 index table — the contract A5's queries rely on
// ---------------------------------------------------------------------------

interface IndexedSchema {
  schema: { indexes(): ReadonlyArray<readonly [unknown, unknown]> };
}

function schemaIndexes(
  model: IndexedSchema,
): ReadonlyArray<readonly [Record<string, unknown>, Record<string, unknown>]> {
  return model.schema
    .indexes()
    .map(([fields, options]) => [
      fields as Record<string, unknown>,
      options as Record<string, unknown>,
    ]);
}

function expectIndex(
  model: IndexedSchema,
  fields: Record<string, number>,
  options: Record<string, unknown> = {},
): void {
  const found = schemaIndexes(model).find(([definition, indexOptions]) => {
    const sameFields =
      Object.keys(definition).length === Object.keys(fields).length &&
      Object.keys(fields).every((key) => definition[key] === fields[key]);
    const sameOptions = Object.keys(options).every(
      (key) => JSON.stringify(indexOptions[key]) === JSON.stringify(options[key]),
    );
    return sameFields && sameOptions;
  });
  expect(found, `missing index ${JSON.stringify(fields)} ${JSON.stringify(options)}`).toBeDefined();
}

describe('TECHNICAL_DESIGN §4 indexes', () => {
  it('users.email is unique', () => {
    expectIndex(User, { email: 1 }, { unique: true });
  });

  it('devices: owner lookup, partial unique pairing hash, pending-code TTL', () => {
    expectIndex(Device, { ownerId: 1 });
    expectIndex(
      Device,
      { pairTokenHash: 1 },
      { unique: true, partialFilterExpression: { pairTokenHash: { $type: 'string' } } },
    );
    expectIndex(
      Device,
      { pairExpiresAt: 1 },
      {
        expireAfterSeconds: 0,
        partialFilterExpression: { pairTokenHash: { $type: 'string' } },
      },
    );
  });

  it('sessions: user/device compound, idempotency key, recent-first and ACTIVE partial unique', () => {
    expectIndex(Session, { userId: 1, deviceId: 1 });
    expectIndex(Session, { userId: 1, clientSessionId: 1 }, { unique: true });
    expectIndex(Session, { userId: 1, startedAt: -1 });
    expectIndex(
      Session,
      { deviceId: 1 },
      { unique: true, partialFilterExpression: { status: 'ACTIVE' } },
    );
  });

  it('allowlists.userId is unique', () => {
    expectIndex(Allowlist, { userId: 1 }, { unique: true });
  });

  it('schedules supports the scheduler scan and presets.name is unique', () => {
    expectIndex(Schedule, { enabled: 1, days: 1 });
    expectIndex(Preset, { name: 1 }, { unique: true });
  });

  it('scheduleRuns, notifications and agentLinks use their blueprint indexes', () => {
    expectIndex(ScheduleRun, { scheduleId: 1, firedAt: 1 });
    // DEC-021 stale-run sweep: dispatched-but-unconfirmed runs by age.
    expectIndex(ScheduleRun, { status: 1, firedAt: 1 });
    expectIndex(Notification, { userId: 1, createdAt: -1 });
    expectIndex(AgentLink, { os: 1 });
  });

  it('uses the plural lower-case collection names from the blueprint', () => {
    expect(User.collection.name).toBe('users');
    expect(Device.collection.name).toBe('devices');
    expect(Session.collection.name).toBe('sessions');
    expect(Allowlist.collection.name).toBe('allowlists');
    expect(Schedule.collection.name).toBe('schedules');
    expect(Preset.collection.name).toBe('presets');
    expect(ScheduleRun.collection.name).toBe('scheduleRuns');
    expect(Notification.collection.name).toBe('notifications');
    expect(AgentLink.collection.name).toBe('agentLinks');
  });

  it('keeps schema validation strict for every model (no strict:false)', () => {
    const models: readonly { schema: { get(path: string): unknown } }[] = [
      User,
      Device,
      Session,
      Allowlist,
      Schedule,
      Preset,
      ScheduleRun,
      Notification,
      AgentLink,
    ];
    for (const model of models) expect(model.schema.get('strict')).not.toBe(false);
  });
});

/** Small date helper: the same UTC instant at `hour` o'clock. */
function atHour(date: Date, hour: number): Date {
  const result = new Date(date);
  result.setUTCHours(hour, 0, 0, 0);
  return result;
}
