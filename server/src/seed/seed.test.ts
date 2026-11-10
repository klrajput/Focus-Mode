// server/src/seed/seed.test.ts — T-013 acceptance tests against a real in-memory MongoDB.
// Proves the requirements the demo depends on: the seed is idempotent (two runs → identical
// counts, no duplicate identities), creates the DEC-013 logins with bcrypt cost-12 hashes, the
// protected allow-list set (INV-3), ≥30 days of past-only session history with mixed statuses and
// sources, ≥2 schedules, 3 presets and 3 agent links, and refuses NODE_ENV=production without
// `--force`. Uses the shared test-db harness (KI-006 cache).

import { compare } from 'bcryptjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALL_PROTECTED_KEYS } from '@focus-mode/shared';
import { AgentLink } from '../models/AgentLink.js';
import { Allowlist } from '../models/Allowlist.js';
import { Device } from '../models/Device.js';
import { Notification } from '../models/Notification.js';
import { Preset } from '../models/Preset.js';
import { Schedule } from '../models/Schedule.js';
import { ScheduleRun } from '../models/ScheduleRun.js';
import { Session } from '../models/Session.js';
import { User } from '../models/User.js';
import { missingProtectedKeys } from '../models/protected-apps.js';
import { clearCollections, startTestDatabase, type TestDatabase } from '../models/test-db.js';
import { SESSION_HISTORY_DAYS, seedDatabase, type SeedCounts } from './seed.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await startTestDatabase();
}, 120_000);

afterAll(async () => {
  await database.stop();
});

beforeEach(async () => {
  await clearCollections();
});

describe('seedDatabase (T-013, FR-030, DEC-013)', () => {
  it('refuses to seed NODE_ENV=production without --force', async () => {
    await expect(
      seedDatabase({ env: { NODE_ENV: 'production' }, mongoUri: database.uri }),
    ).rejects.toThrow(/--force/);
    expect(await User.countDocuments()).toBe(0);
  });

  it('allows a production seed with --force', async () => {
    const counts = await seedDatabase({
      env: { NODE_ENV: 'production' },
      force: true,
      mongoUri: database.uri,
    });
    expect(counts.users).toBe(2);
  });

  it('creates the DEC-013 demo identities with bcrypt cost-12 password hashes', async () => {
    await seedDatabase({ mongoUri: database.uri });
    expect(await User.countDocuments()).toBe(2);

    const admin = await User.findOne({ email: 'admin@demo.com' }).select('+passwordHash');
    expect(admin).not.toBeNull();
    expect(admin?.role).toBe('ADMIN');
    expect(admin?.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(await compare('Admin@123', admin?.passwordHash ?? '')).toBe(true);

    const kabir = await User.findOne({ email: 'kabir@demo.com' }).select('+passwordHash');
    expect(kabir).not.toBeNull();
    expect(kabir?.role).toBe('USER');
    expect(kabir?.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(await compare('Kabir@123', kabir?.passwordHash ?? '')).toBe(true);
    expect(kabir?.timezone).toBe('Asia/Kolkata');
  });

  it('seeds the protected allow-list set plus VS Code/Slack user apps', async () => {
    await seedDatabase({ mongoUri: database.uri });
    const kabir = await User.findOne({ email: 'kabir@demo.com' });
    const allowlist = await Allowlist.findOne({ userId: kabir?._id });
    expect(allowlist).not.toBeNull();
    expect(missingProtectedKeys(allowlist?.protectedApps ?? [])).toEqual([]);
    expect((allowlist?.protectedApps ?? []).length).toBe(ALL_PROTECTED_KEYS.length);
    const userAppKeys = (allowlist?.userApps ?? []).map((entry) => entry.key);
    expect(userAppKeys).toEqual(expect.arrayContaining(['vscode', 'slack']));
    expect(allowlist?.version).toBe(1);
  });

  it('seeds ≥30 days of past-only session history with mixed statuses and sources', async () => {
    await seedDatabase({ mongoUri: database.uri });
    const sessions = await Session.find();
    expect(sessions.length).toBeGreaterThanOrEqual(SESSION_HISTORY_DAYS);

    const now = new Date();
    const utcDays = new Set<string>();
    const statuses = new Set<string>();
    const sources = new Set<string>();
    for (const session of sessions) {
      expect(session.startedAt.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(session.endedAt).not.toBeNull();
      expect(session.endedAt?.getTime()).toBeLessThanOrEqual(now.getTime());
      expect(session.endedAt?.getTime()).toBeGreaterThanOrEqual(session.startedAt.getTime());
      utcDays.add(session.startedAt.toISOString().slice(0, 10));
      statuses.add(session.status);
      sources.add(session.source);
      if (session.status === 'COMPLETED') {
        expect(session.actualMinutes).toBe(session.plannedMinutes);
        expect(session.endReason).toBe('COMPLETED');
      } else {
        expect(session.actualMinutes).toBeLessThan(session.plannedMinutes);
      }
    }
    expect(utcDays.size).toBeGreaterThanOrEqual(30);
    expect([...statuses].sort()).toEqual(['CANCELLED', 'COMPLETED']);
    expect([...sources].sort()).toEqual(['MANUAL', 'SCHEDULE']);

    // clientSessionId is unique per user: no duplicate history rows.
    const clientSessionIds = await Session.distinct('clientSessionId');
    expect(clientSessionIds).toHaveLength(sessions.length);
  });

  it('is idempotent: a second run produces identical collection counts', async () => {
    const first = await seedDatabase({ mongoUri: database.uri });
    const second = await seedDatabase({ mongoUri: database.uri });
    expect(second).toEqual(first);
    expect(await User.countDocuments({ email: 'admin@demo.com' })).toBe(1);
    expect(await User.countDocuments({ email: 'kabir@demo.com' })).toBe(1);
  });

  it('seeds 2 devices, ≥2 schedules, 3 presets, 3 agent links and notifications', async () => {
    const counts = await seedDatabase({ mongoUri: database.uri });
    expect(counts.devices).toBe(2);
    expect(await Device.countDocuments({ status: 'CONNECTED' })).toBeGreaterThanOrEqual(1);

    expect(counts.schedules).toBeGreaterThanOrEqual(2);
    expect(await Schedule.countDocuments({ enabled: true })).toBeGreaterThanOrEqual(1);

    expect(counts.presets).toBe(3);
    expect(await Preset.countDocuments()).toBe(3);
    const admin = await User.findOne({ email: 'admin@demo.com' });
    expect(await Preset.countDocuments({ createdBy: admin?._id })).toBe(3);

    expect(counts.agentLinks).toBe(3);
    const links = await AgentLink.find();
    expect(links.map((link) => link.os).sort()).toEqual(['linux', 'macOS', 'windows']);
    for (const link of links) {
      // Placeholder must be the real releases page, never an invented artifact path.
      expect(link.url).toBe('https://github.com/klrajput/Focus-Mode/releases');
      expect(link.version).toBe('1.4.0');
      expect(link.publishedAt).toBeInstanceOf(Date);
    }

    expect(counts.notifications).toBe(2);
    expect(await Notification.countDocuments({ readAt: null })).toBeGreaterThanOrEqual(1);
    expect(counts.scheduleRuns).toBe(5);
    expect(await ScheduleRun.countDocuments({ status: 'MISSED' })).toBeGreaterThanOrEqual(1);
    expect(await ScheduleRun.countDocuments({ status: 'STARTED' })).toBeGreaterThanOrEqual(1);
  });

  it('honours SEED_* env overrides (DEC-013 defaults stay untouched)', async () => {
    const counts: SeedCounts = await seedDatabase({
      mongoUri: database.uri,
      env: {
        SEED_ADMIN_EMAIL: 'root@example.com',
        SEED_ADMIN_PASSWORD: 'Root@1234',
        SEED_USER_EMAIL: 'asha@example.com',
        SEED_USER_PASSWORD: 'Asha@1234',
      },
    });
    expect(counts.users).toBe(2);
    expect(await User.countDocuments({ email: 'admin@demo.com' })).toBe(0);
    const root = await User.findOne({ email: 'root@example.com' }).select('+passwordHash');
    expect(root?.role).toBe('ADMIN');
    expect(await compare('Root@1234', root?.passwordHash ?? '')).toBe(true);
    const asha = await User.findOne({ email: 'asha@example.com' }).select('+passwordHash');
    expect(asha?.role).toBe('USER');
    expect(await compare('Asha@1234', asha?.passwordHash ?? '')).toBe(true);
  });
});
