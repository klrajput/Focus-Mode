// server/src/models/enums.ts — Mongo enum value lists for every model in TECHNICAL_DESIGN §4.
// The vocabulary is frozen in `@focus-mode/shared`; each list is declared with `satisfies` so a
// renamed/added shared union member becomes a type error here instead of silent DB drift. Mongoose
// only accepts these arrays, so a bad enum string is rejected at write time (same value the REST
// schemas and the local/cloud channel already speak).

import type {
  AgentArch,
  DeviceStatus,
  EndReason,
  FocusSource,
  OsName,
  Role,
  SessionStatus,
  TerminalSessionStatus,
} from '@focus-mode/shared';

/** users.role — FR-001/FR-019; never accepted from a user request body. */
export const ROLES = ['USER', 'ADMIN'] as const satisfies readonly Role[];

/** devices.os / agentLinks.os — DB spelling from TECHNICAL_DESIGN §4. */
export const OS_NAMES = ['macOS', 'windows', 'linux'] as const satisfies readonly OsName[];

/** devices.status — presence as shown on `/devices`. */
export const DEVICE_STATUSES = [
  'CONNECTED',
  'DISCONNECTED',
  'FOCUSING',
] as const satisfies readonly DeviceStatus[];

/** sessions.status — ACTIVE until finalised, then terminal (FR-024, FR-013). */
export const SESSION_STATUSES = [
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
] as const satisfies readonly SessionStatus[];

/** sessions.status values a session can be finalised to (PATCH /sessions/:id). */
export const TERMINAL_SESSION_STATUSES = [
  'COMPLETED',
  'CANCELLED',
] as const satisfies readonly TerminalSessionStatus[];

/** sessions.source — FR-010 (who started the focus session). */
export const FOCUS_SOURCES = ['MANUAL', 'SCHEDULE'] as const satisfies readonly FocusSource[];

/** sessions.endReason — TECHNICAL_DESIGN §6.2 (shared with the local channel). */
export const END_REASONS = [
  'COMPLETED',
  'USER',
  'AGENT',
  'SLEEP',
  'CRASH_RECOVERY',
  'UNPAIRED',
  'QUIT',
] as const satisfies readonly EndReason[];

/** agentLinks.arch — installer architecture for admin-published downloads. */
export const AGENT_ARCHES = ['x64', 'arm64', 'universal'] as const satisfies readonly AgentArch[];

/**
 * scheduleRuns.status — REC addition in TECHNICAL_DESIGN §4. This vocabulary is only in the
 * blueprint table (not the shared REST schemas yet), so it is declared here and exported for the
 * scheduler (A5) to import instead of re-typing strings.
 */
export const SCHEDULE_RUN_STATUSES = ['STARTED', 'MISSED', 'CANCELLED_BY_USER'] as const;
export type ScheduleRunStatus = (typeof SCHEDULE_RUN_STATUSES)[number];

/**
 * notifications.type — REC addition (missed-run alerts, FR-012). Kept as a closed enum so the
 * dashboard can switch on it; exported for the scheduler that creates notifications.
 */
export const NOTIFICATION_TYPES = [
  'SCHEDULE_MISSED',
  'SCHEDULE_STARTED',
  'DEVICE_DISCONNECTED',
  'SYSTEM',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
