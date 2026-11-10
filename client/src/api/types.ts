/*
 * Response shapes for the Focus Mode REST API (INTEGRATION_CONTRACTS §3.3).
 * Request payloads come from `@focus-mode/shared` zod schemas and are never re-declared here.
 * Response bodies are documented but not zod-schema'd (contract C-04), so this module types them
 * once for every endpoint module and query hook. Enum fields reuse the shared inferred types so a
 * contract change breaks the client build instead of silently drifting.
 */

import type {
  AgentArch,
  AppEntry,
  DeviceStatus,
  EndReason,
  FocusSource,
  InsightsRange,
  OsName,
  Role,
  SessionStatus,
  ValidationIssue,
} from '@focus-mode/shared';

/** `public user` (§3.3) — never contains `passwordHash` (FR-001). */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  timezone: string;
  defaultDurationMin: number;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

/** `auth result` — login and register success data. */
export interface AuthResult {
  accessToken: string;
  user: PublicUser;
}

/** Device capability summary carried on `GET /devices` (mirrors the local `hello` message). */
export interface DeviceCapabilities {
  focus: 'full' | 'partial' | 'unsupported';
  reasons?: string[];
}

/** `device` (§3.3). */
export interface Device {
  id: string;
  name: string;
  os: OsName;
  status: DeviceStatus;
  agentVersion: string;
  pairedAt: string | null;
  lastSeenAt: string | null;
  capabilities?: DeviceCapabilities;
}

/** `session` (§3.3). `actualMinutes` is what the UI calls "focused time". */
export interface FocusSession {
  id: string;
  deviceId: string;
  startedAt: string;
  endedAt: string | null;
  plannedMinutes: number;
  actualMinutes: number;
  status: SessionStatus;
  source: FocusSource;
  clientSessionId: string;
  endReason: EndReason | null;
  lastHeartbeatAt: string | null;
}

/** `allow-list` (§3.3). `protectedApps` is server-seeded and never editable (INV-3). */
export interface AllowList {
  protectedApps: AppEntry[];
  userApps: AppEntry[];
  version: number;
}

/** `schedule` (§3.3). `days` are 0–6 with 0 = Sunday; `startTime` is `HH:mm`. */
export interface Schedule {
  id: string;
  name: string;
  days: number[];
  startTime: string;
  durationMin: number;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

/** `notification` (§3.3). */
export interface NotificationItem {
  id: string;
  type: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

/** `preset` (§3.3). */
export interface Preset {
  id: string;
  name: string;
  apps: AppEntry[];
  createdAt: string;
}

/** `agent link` (§3.3) — installer download published by an admin. */
export interface AgentLink {
  id: string;
  os: OsName;
  arch: AgentArch;
  label: string;
  url: string;
  version: string;
  publishedAt: string;
}

export interface InsightsTotals {
  focusMinutes: number;
  sessions: number;
  completed: number;
  cancelled: number;
  completionRate: number;
  currentStreak: number;
  longestStreak: number;
}

export interface InsightsDailyPoint {
  date: string;
  minutes: number;
}

export interface InsightsBestHour {
  hour: number;
  minutes: number;
}

/** `insights` (§3.3). Analytics definitions live in REQUIREMENTS §6. */
export interface Insights {
  range: InsightsRange;
  timezone: string;
  totals: InsightsTotals;
  daily: InsightsDailyPoint[];
  bestHours: InsightsBestHour[];
}

/** `admin stats` (§3.3) — aggregates only, never per-user session detail (PDF §6). */
export interface AdminStats {
  users: number;
  activeUsers: number;
  devices: number;
  connectedDevices: number;
  sessions: number;
  activeSessions: number;
  focusMinutes: number;
}

export interface LogoutResult {
  loggedOut: boolean;
}

export interface PasswordChanged {
  changed: boolean;
}

/** `POST /devices/pair` success data. */
export interface PairedDevice {
  device: Device;
}

/** `DELETE /devices/:id` success data — the token is revoked server-side. */
export interface RevokedDevice {
  id: string;
  revoked: true;
}

/**
 * `POST /devices/unpair-all` success data (FR-029). The body is not one of the frozen §3.3
 * shapes, so the UI reads at most the count and never derives state from it.
 */
export interface UnpairedAllDevices {
  unpaired: number;
}

/** `POST /devices/:id/attest` success data (REC-003) — consumed by the local channel only. */
export interface AttestationResult {
  attestation: string;
  expiresAt: string;
  algorithm: string;
}

/** `DELETE`-style success data used by schedules, presets and agent links. */
export interface DeletedResource {
  id: string;
}

// ---------------------------------------------------------------------------
// Query parameter types (TS-only; the shared zod schemas validate on the server)
// ---------------------------------------------------------------------------

export type PageParams = {
  page?: number;
  limit?: number;
};

export type DeviceListParams = PageParams & {
  sort?: string;
  search?: string;
};

export type SessionListParams = PageParams & {
  sort?: string;
  search?: string;
  from?: string;
  to?: string;
  status?: SessionStatus;
  source?: FocusSource;
};

export type AdminUserListParams = PageParams & {
  sort?: string;
  search?: string;
};

/** Convenience alias for the error `details[]` array (NFR-002). */
export type ApiValidationDetails = readonly ValidationIssue[];
