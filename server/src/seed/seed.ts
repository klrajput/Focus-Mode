// server/src/seed/seed.ts — idempotent demo seed for the exam walkthrough (T-013, FR-030, DEC-013).
// `npm run seed` must be safe to run twice: every document is upserted by a natural key (email,
// owner+device name, allow-list user, schedule name, preset name, os+arch, user+clientSessionId),
// so counts stay identical and no duplicate identities appear. It refuses to run with
// NODE_ENV=production unless `--force` is passed, because the seeded passwords are public.
// All generated session timestamps are in the past (days before today) and derived from a
// deterministic PRNG keyed on the UTC date, so two runs on the same day write identical data.
// Reads: MONGO_URI, NODE_ENV, SEED_ADMIN_EMAIL/PASSWORD, SEED_USER_EMAIL/PASSWORD (DEC-013).

import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compare, hash } from 'bcryptjs';
import { config as loadDotenv } from 'dotenv';
import mongoose from 'mongoose';
import {
  type AgentArch,
  type AppEntry,
  type EndReason,
  type FocusSource,
  type OsName,
  type SessionStatus,
} from '@focus-mode/shared';
import { AgentLink } from '../models/AgentLink.js';
import { Allowlist } from '../models/Allowlist.js';
import { Device, type DeviceDocument } from '../models/Device.js';
import { Notification } from '../models/Notification.js';
import { Preset } from '../models/Preset.js';
import { Schedule } from '../models/Schedule.js';
import { ScheduleRun } from '../models/ScheduleRun.js';
import { Session } from '../models/Session.js';
import { User, type UserDocument } from '../models/User.js';
import { buildProtectedAppEntries } from '../models/protected-apps.js';

/** SEC-1: bcrypt cost 12, same as the auth service. */
export const BCRYPT_COST = 12;

/** How many completed UTC days of session history the demo account gets (FR-030 requires ≥30). */
export const SESSION_HISTORY_DAYS = 32;

const DEFAULT_MONGO_URI = 'mongodb://127.0.0.1:27017/focus-mode';
const DEFAULT_AGENT_VERSION = '1.4.0';
/**
 * The Focus Agent installers do not exist yet (T-090 packages them). Rather than inventing asset
 * filenames, every seeded link points at the project's real GitHub Releases page; the release job
 * later updates `url` to the uploaded artifact. Never put a fabricated `/releases/download/...` URL
 * here — FR-025 users must not hit a dead, invented asset.
 */
const GITHUB_RELEASES_URL = 'https://github.com/klrajput/Focus-Mode/releases';

/** Options for one seed run (tests inject URI/env/log; the CLI uses the defaults). */
export interface SeedOptions {
  /** Overrides `MONGO_URI` (tests use mongodb-memory-server's URI). */
  mongoUri?: string;
  /** Required to seed when `NODE_ENV=production`. */
  force?: boolean;
  /** Environment source; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Progress sink (the CLI writes to stdout; tests can collect lines). */
  log?: (message: string) => void;
}

/** Document counts after a seed run — the idempotency assertion compares two of these. */
export interface SeedCounts {
  users: number;
  devices: number;
  allowlists: number;
  sessions: number;
  schedules: number;
  scheduleRuns: number;
  presets: number;
  notifications: number;
  agentLinks: number;
}

/** Demo login identities frozen by DEC-013 (also documented in server/.env.example and README). */
export interface SeedIdentityConfig {
  adminEmail: string;
  adminPassword: string;
  userEmail: string;
  userPassword: string;
}

/** A database model plus the index-build hook the seed awaits before upserting. */
interface InitialisableModel {
  init(): Promise<unknown>;
}

const ALL_MODELS: readonly InitialisableModel[] = [
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

// ---------------------------------------------------------------------------
// Deterministic date helpers (all seeded history is in the past; same UTC day → same rows)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function utcStartOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysBefore(anchor: Date, days: number): Date {
  return new Date(anchor.getTime() - days * DAY_MS);
}

function atUtcHour(date: Date, hour: number, minute = 0): Date {
  const result = new Date(date);
  result.setUTCHours(hour, minute, 0, 0);
  return result;
}

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Deterministic PRNG: the demo data must not change between two runs on the same day
// ---------------------------------------------------------------------------

/** FNV-1a: tiny stable string hash used only to derive a PRNG seed from a date key. */
function fnv1a(input: string): number {
  let hashValue = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hashValue ^= input.charCodeAt(index);
    hashValue = Math.imul(hashValue, 0x01000193);
  }
  return hashValue >>> 0;
}

/** mulberry32: 32-bit deterministic PRNG (not security-relevant — demo data only). */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** RFC-9562 v4-shaped UUID derived from a stable seed (idempotency key for seeded sessions). */
function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

// ---------------------------------------------------------------------------
// Demo content (app entries are keyed like shared appEntrySchema; no protected keys)
// ---------------------------------------------------------------------------

/** App entries the demo user allow-lists on top of the locked protected set (FR-020). */
export const DEMO_USER_APPS: readonly AppEntry[] = Object.freeze([
  {
    key: 'vscode',
    label: 'Visual Studio Code',
    win: ['Code.exe'],
    mac: ['com.microsoft.VSCode'],
    linux: ['code', 'code-insiders'],
  },
  {
    key: 'slack',
    label: 'Slack',
    win: ['slack.exe'],
    mac: ['com.tinyspeck.slackmacgap'],
    linux: ['slack'],
  },
  {
    key: 'iterm2',
    label: 'iTerm2',
    mac: ['com.googlecode.iterm2'],
  },
  {
    key: 'figma',
    label: 'Figma',
    win: ['Figma.exe'],
    mac: ['com.figma.Desktop'],
  },
  {
    key: 'notion',
    label: 'Notion',
    win: ['Notion.exe'],
    mac: ['notion.id'],
    linux: ['notion-desktop'],
  },
]);

const PRESET_DEFINITIONS: readonly { name: string; apps: readonly AppEntry[] }[] = [
  {
    name: 'Deep Work',
    apps: [
      {
        key: 'vscode',
        label: 'Visual Studio Code',
        win: ['Code.exe'],
        mac: ['com.microsoft.VSCode'],
        linux: ['code'],
      },
      {
        key: 'obsidian',
        label: 'Obsidian',
        win: ['Obsidian.exe'],
        mac: ['md.obsidian'],
        linux: ['obsidian'],
      },
    ],
  },
  {
    name: 'Coding Session',
    apps: [
      {
        key: 'vscode',
        label: 'Visual Studio Code',
        win: ['Code.exe'],
        mac: ['com.microsoft.VSCode'],
        linux: ['code'],
      },
      {
        key: 'terminal',
        label: 'Terminal',
        mac: ['com.apple.Terminal', 'com.googlecode.iterm2'],
        linux: ['gnome-terminal'],
      },
      {
        key: 'slack',
        label: 'Slack',
        win: ['slack.exe'],
        mac: ['com.tinyspeck.slackmacgap'],
        linux: ['slack'],
      },
    ],
  },
  {
    name: 'Study Block',
    apps: [
      {
        key: 'notion',
        label: 'Notion',
        win: ['Notion.exe'],
        mac: ['notion.id'],
        linux: ['notion-desktop'],
      },
      {
        key: 'anki',
        label: 'Anki',
        win: ['anki.exe'],
        mac: ['net.ankiweb.dtop'],
        linux: ['anki'],
      },
    ],
  },
];

/** Admin-published installer rows: one per supported OS/arch in the demo (FR-025). */
const AGENT_LINK_DEFINITIONS: readonly {
  os: OsName;
  arch: AgentArch;
  label: string;
}[] = [
  { os: 'macOS', arch: 'arm64', label: 'macOS (Apple silicon)' },
  { os: 'windows', arch: 'x64', label: 'Windows 10/11 (x64)' },
  { os: 'linux', arch: 'x64', label: 'Linux (Ubuntu 22.04/24.04 x64)' },
];

// ---------------------------------------------------------------------------
// User / device / allow-list upserts
// ---------------------------------------------------------------------------

function readIdentityConfig(env: NodeJS.ProcessEnv): SeedIdentityConfig {
  return {
    adminEmail: (env.SEED_ADMIN_EMAIL ?? 'admin@demo.com').trim().toLowerCase(),
    adminPassword: env.SEED_ADMIN_PASSWORD ?? 'Admin@123',
    userEmail: (env.SEED_USER_EMAIL ?? 'kabir@demo.com').trim().toLowerCase(),
    userPassword: env.SEED_USER_PASSWORD ?? 'Kabir@123',
  };
}

/**
 * Upsert one demo user by email. The bcrypt hash is only rewritten when the configured password
 * no longer matches (so two runs with the same env cause no write and no new document).
 */
async function upsertUser(
  log: (message: string) => void,
  input: {
    name: string;
    email: string;
    password: string;
    role: 'USER' | 'ADMIN';
    timezone: string;
    defaultDurationMin: number;
  },
): Promise<UserDocument> {
  const existing = await User.findOne({ email: input.email }).select('+passwordHash');
  if (!existing) {
    const passwordHash = await hash(input.password, BCRYPT_COST);
    const created = await User.create({
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role,
      timezone: input.timezone,
      defaultDurationMin: input.defaultDurationMin,
      isActive: true,
    });
    log(`user created: ${input.email} (${input.role})`);
    return created;
  }
  let changed = false;
  if (!(await compare(input.password, existing.passwordHash))) {
    existing.passwordHash = await hash(input.password, BCRYPT_COST);
    changed = true;
  }
  if (existing.name !== input.name) {
    existing.name = input.name;
    changed = true;
  }
  if (existing.role !== input.role) {
    existing.role = input.role;
    changed = true;
  }
  if (existing.timezone !== input.timezone) {
    existing.timezone = input.timezone;
    changed = true;
  }
  if (existing.defaultDurationMin !== input.defaultDurationMin) {
    existing.defaultDurationMin = input.defaultDurationMin;
    changed = true;
  }
  if (existing.isActive !== true) {
    existing.isActive = true;
    changed = true;
  }
  if (changed) {
    await existing.save();
    log(`user updated: ${input.email}`);
  }
  return existing;
}

/** Upsert one paired demo device by `{ownerId, name}` (natural key per owner). */
async function upsertDevice(
  log: (message: string) => void,
  input: {
    ownerId: mongoose.Types.ObjectId;
    name: string;
    os: OsName;
    status: 'CONNECTED' | 'DISCONNECTED';
    lastSeenAt: Date;
    pairedAt: Date;
  },
): Promise<DeviceDocument> {
  const device = await Device.findOneAndUpdate(
    { ownerId: input.ownerId, name: input.name },
    {
      $set: {
        os: input.os,
        status: input.status,
        agentVersion: DEFAULT_AGENT_VERSION,
        capabilities: { focus: 'full', reasons: [] },
        pairedAt: input.pairedAt,
        lastSeenAt: input.lastSeenAt,
        pairTokenHash: null,
        pairExpiresAt: null,
        pairAttempts: 0,
      },
      $setOnInsert: { deviceTokenHash: null, enrollSecretHash: null },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  if (!device) throw new Error(`seed: device upsert failed for ${input.name}`);
  log(`device ready: ${input.name} (${input.status})`);
  return device;
}

/**
 * Ensure the demo allow-list. `protectedApps` is always re-synced to the canonical shared set
 * (INV-3 — a stale or tampered protected list must heal on seed); `userApps`/`version` are written
 * only on insert so a human's later edits are never destroyed by re-running the seed.
 */
async function upsertAllowlist(
  log: (message: string) => void,
  userId: mongoose.Types.ObjectId,
): Promise<void> {
  const protectedApps = buildProtectedAppEntries();
  const existing = await Allowlist.findOne({ userId });
  if (!existing) {
    await Allowlist.create({
      userId,
      protectedApps,
      userApps: DEMO_USER_APPS.map((entry) => ({ ...entry })),
      version: 1,
    });
    log('allowlist created with protected set + demo apps');
    return;
  }
  await Allowlist.updateOne({ _id: existing._id }, { $set: { protectedApps } });
  log('allowlist protected set verified');
}

// ---------------------------------------------------------------------------
// Session history
// ---------------------------------------------------------------------------

const SESSION_START_HOURS = [7, 8, 9, 10, 11, 14, 15, 16, 20, 21] as const;
const PLANNED_DURATIONS = [25, 50, 60, 90] as const;

interface GeneratedSession {
  clientSessionId: string;
  deviceIndex: 0 | 1;
  startedAt: Date;
  endedAt: Date;
  plannedMinutes: number;
  actualMinutes: number;
  status: SessionStatus;
  source: FocusSource;
  endReason: EndReason;
  lastHeartbeatAt: Date;
}

/**
 * Generate the demo history for the `SESSION_HISTORY_DAYS` UTC days strictly before today.
 * Because every day is offset by at least one full day, `endedAt` is always in the past — a seed
 * can never create a future session (which would corrupt insights/streaks).
 */
function generateDemoSessions(anchor: Date, userId: string): GeneratedSession[] {
  const today = utcStartOfDay(anchor);
  const sessions: GeneratedSession[] = [];
  for (let offset = 1; offset <= SESSION_HISTORY_DAYS; offset += 1) {
    const day = daysBefore(today, offset);
    const dayKey = utcDateKey(day);
    const random = mulberry32(fnv1a(`focus-mode-seed|sessions|${dayKey}`));
    const count = 1 + Math.floor(random() * 3); // 1–3 sessions per day
    const availableHours = [...SESSION_START_HOURS];
    for (let index = 0; index < count; index += 1) {
      const hourIndex = Math.floor(random() * availableHours.length);
      const hour = availableHours.splice(hourIndex, 1)[0] ?? 9;
      const minute = random() < 0.5 ? 0 : 30;
      const plannedMinutes =
        PLANNED_DURATIONS[Math.floor(random() * PLANNED_DURATIONS.length)] ?? 60;
      const completed = random() < 0.78;
      const source: FocusSource = random() < 0.45 ? 'SCHEDULE' : 'MANUAL';
      const startedAt = atUtcHour(day, hour, minute);
      const actualMinutes = completed
        ? plannedMinutes
        : roundToTenth(plannedMinutes * (0.15 + random() * 0.65));
      const endedAt = new Date(startedAt.getTime() + actualMinutes * 60_000);
      sessions.push({
        clientSessionId: deterministicUuid(`focus-mode-seed|session|${userId}|${dayKey}|${index}`),
        deviceIndex: random() < 0.85 ? 0 : 1,
        startedAt,
        endedAt,
        plannedMinutes,
        actualMinutes,
        status: completed ? 'COMPLETED' : 'CANCELLED',
        source,
        endReason: completed ? 'COMPLETED' : 'USER',
        lastHeartbeatAt: completed ? new Date(endedAt.getTime() - 30_000) : endedAt,
      });
    }
  }
  return sessions;
}

// ---------------------------------------------------------------------------
// Main seed routine
// ---------------------------------------------------------------------------

function assertMongoUri(uri: string): void {
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new Error(
      `MONGO_URI must start with mongodb:// or mongodb+srv:// (received ${JSON.stringify(uri)})`,
    );
  }
}

/** Hide credentials before a URI is logged. */
function maskMongoUri(uri: string): string {
  return uri.replace(/\/\/([^@/]+)@/, '//***@');
}

/** Build every collection's indexes (unique/partial ones included) before the first upsert. */
async function ensureIndexes(): Promise<void> {
  for (const model of ALL_MODELS) await model.init();
}

/**
 * Seed the demo dataset. Idempotent: safe to call repeatedly against the same database (the test
 * suite asserts two runs produce identical counts). Returns the post-run collection counts.
 */
export async function seedDatabase(options: SeedOptions = {}): Promise<SeedCounts> {
  const env = options.env ?? process.env;
  const log = options.log ?? (() => undefined);
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (nodeEnv === 'production' && !options.force) {
    throw new Error(
      'Refusing to seed NODE_ENV=production without --force: the demo passwords are public. ' +
        'Pass --force only for an intentional, disposable production demo database.',
    );
  }
  const mongoUri = options.mongoUri ?? (env.MONGO_URI?.trim() || DEFAULT_MONGO_URI);
  assertMongoUri(mongoUri);
  const identities = readIdentityConfig(env);

  const ownsConnection = mongoose.connection.readyState === 0;
  if (ownsConnection) {
    log(`connecting to ${maskMongoUri(mongoUri)}`);
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10_000 });
  }
  try {
    await ensureIndexes();

    const anchor = new Date();
    const today = utcStartOfDay(anchor);
    const admin = await upsertUser(log, {
      name: 'Focus Admin',
      email: identities.adminEmail,
      password: identities.adminPassword,
      role: 'ADMIN',
      timezone: 'Asia/Kolkata',
      defaultDurationMin: 60,
    });
    const user = await upsertUser(log, {
      name: 'Kabir',
      email: identities.userEmail,
      password: identities.userPassword,
      role: 'USER',
      timezone: 'Asia/Kolkata',
      defaultDurationMin: 60,
    });

    await upsertAllowlist(log, user._id);

    const macbook = await upsertDevice(log, {
      ownerId: user._id,
      name: 'Kabir-MacBook',
      os: 'macOS',
      status: 'CONNECTED',
      pairedAt: daysBefore(today, 45),
      lastSeenAt: new Date(anchor.getTime() - 60_000),
    });
    const windowsLaptop = await upsertDevice(log, {
      ownerId: user._id,
      name: 'Kabir-Windows',
      os: 'windows',
      status: 'DISCONNECTED',
      pairedAt: daysBefore(today, 20),
      lastSeenAt: daysBefore(today, 3),
    });

    const schedules = await Promise.all([
      Schedule.findOneAndUpdate(
        { userId: user._id, name: 'Deep Work Morning' },
        {
          $set: {
            days: [1, 2, 3, 4, 5],
            startTime: '09:00',
            durationMin: 60,
            enabled: true,
            lastRunAt: atUtcHour(daysBefore(today, 1), 9),
          },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      ),
      Schedule.findOneAndUpdate(
        { userId: user._id, name: 'Evening Reading' },
        {
          $set: {
            days: [1, 3, 5],
            startTime: '20:00',
            durationMin: 25,
            enabled: false,
            lastRunAt: atUtcHour(daysBefore(today, 3), 20),
          },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      ),
    ]);
    const morningSchedule = schedules[0];
    if (!morningSchedule) throw new Error('seed: morning schedule upsert failed');
    log(`schedules ready: ${schedules.length}`);

    await Promise.all(
      PRESET_DEFINITIONS.map((preset) =>
        Preset.findOneAndUpdate(
          { name: preset.name },
          {
            $set: {
              apps: preset.apps.map((entry) => ({ ...entry })),
              createdBy: admin._id,
            },
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        ),
      ),
    );
    log(`presets ready: ${PRESET_DEFINITIONS.length}`);

    await Promise.all(
      AGENT_LINK_DEFINITIONS.map((link) =>
        AgentLink.findOneAndUpdate(
          { os: link.os, arch: link.arch },
          {
            $set: {
              label: link.label,
              url: GITHUB_RELEASES_URL,
              version: DEFAULT_AGENT_VERSION,
              publishedBy: admin._id,
            },
            $setOnInsert: { publishedAt: daysBefore(today, 10) },
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        ),
      ),
    );
    log(`agent links ready: ${AGENT_LINK_DEFINITIONS.length}`);

    // --- Session history (deterministic per UTC day; ids are the idempotency key) ----------
    const devices = [macbook, windowsLaptop];
    const generated = generateDemoSessions(anchor, user._id.toString());
    const sessionOperations = generated.map((session) => {
      const device = devices[session.deviceIndex];
      if (!device) throw new Error('seed: missing demo device');
      return {
        updateOne: {
          filter: { userId: user._id, clientSessionId: session.clientSessionId },
          update: {
            $set: {
              userId: user._id,
              deviceId: device._id,
              startedAt: session.startedAt,
              endedAt: session.endedAt,
              plannedMinutes: session.plannedMinutes,
              actualMinutes: session.actualMinutes,
              status: session.status,
              source: session.source,
              endReason: session.endReason,
              lastHeartbeatAt: session.lastHeartbeatAt,
            },
          },
          upsert: true,
        },
      };
    });
    await Session.bulkWrite(sessionOperations, { ordered: false });
    log(`sessions ready: ${generated.length} across ${SESSION_HISTORY_DAYS} days`);

    // --- Schedule runs (STARTED when a device acted, MISSED when none was available) -------
    const runOffsets = [1, 2, 3, 4, 5];
    await Promise.all(
      runOffsets.map((offset) => {
        const firedAt = atUtcHour(daysBefore(today, offset), 9);
        const missed = offset === 2 || offset === 4;
        return ScheduleRun.findOneAndUpdate(
          { scheduleId: morningSchedule._id, firedAt },
          {
            $setOnInsert: {
              userId: user._id,
              deviceId: missed ? null : macbook._id,
              status: missed ? 'MISSED' : 'STARTED',
            },
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        );
      }),
    );
    log(`schedule runs ready: ${runOffsets.length}`);

    // --- Notifications (one unread missed-run alert + one read device alert) --------------
    const missedDay = daysBefore(today, 2);
    await Promise.all([
      Notification.findOneAndUpdate(
        {
          userId: user._id,
          type: 'SCHEDULE_MISSED',
          message: `Missed "Deep Work Morning" on ${utcDateKey(missedDay)}`,
        },
        { $setOnInsert: { readAt: null, createdAt: atUtcHour(missedDay, 9, 5) } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      ),
      Notification.findOneAndUpdate(
        {
          userId: user._id,
          type: 'DEVICE_DISCONNECTED',
          message: 'Kabir-Windows has been offline for 3 days',
        },
        {
          $setOnInsert: {
            readAt: atUtcHour(daysBefore(today, 3), 12),
            createdAt: atUtcHour(daysBefore(today, 3), 10),
          },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      ),
    ]);
    log('notifications ready: 2');

    const counts: SeedCounts = {
      users: await User.countDocuments(),
      devices: await Device.countDocuments(),
      allowlists: await Allowlist.countDocuments(),
      sessions: await Session.countDocuments(),
      schedules: await Schedule.countDocuments(),
      scheduleRuns: await ScheduleRun.countDocuments(),
      presets: await Preset.countDocuments(),
      notifications: await Notification.countDocuments(),
      agentLinks: await AgentLink.countDocuments(),
    };
    log(
      `seeded: ${Object.entries(counts)
        .map(([collection, count]) => `${collection}=${count}`)
        .join(' ')}`,
    );
    return counts;
  } finally {
    if (ownsConnection) await mongoose.disconnect();
  }
}

// ---------------------------------------------------------------------------
// CLI entry: `tsx src/seed/seed.ts [--force]` (wired as `npm run seed`)
// ---------------------------------------------------------------------------

function isDirectRun(): boolean {
  const invokedPath = process.argv[1];
  if (!invokedPath) return false;
  return pathToFileURL(path.resolve(invokedPath)).href === import.meta.url;
}

/** Run the CLI, loading `server/.env` first (dotenv never overrides real process env). */
async function runCli(): Promise<void> {
  loadDotenv({ quiet: true });
  const counts = await seedDatabase({
    force: process.argv.includes('--force'),
    log: (message) => process.stdout.write(`[seed] ${message}\n`),
  });
  process.stdout.write(
    `[seed] done — demo logins (DEC-013): ` +
      `${process.env.SEED_ADMIN_EMAIL ?? 'admin@demo.com'} / Admin@123, ` +
      `${process.env.SEED_USER_EMAIL ?? 'kabir@demo.com'} / Kabir@123 ` +
      `(sessions=${counts.sessions}, schedules=${counts.schedules}, presets=${counts.presets}, ` +
      `agentLinks=${counts.agentLinks})\n`,
  );
}

if (isDirectRun()) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[seed] failed: ${message}\n`);
    process.exitCode = 1;
  });
}
