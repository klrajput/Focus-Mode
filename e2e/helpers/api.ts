// e2e/helpers/api.ts — typed HTTP helpers for arranging E2E fixtures against the real API
// (T-047 prep, owner A8).
// Why: specs need real accounts without replaying the signup UI for every arrangement, and they need
// the failure message the API actually returns. Playwright's APIRequestContext talks to the same
// Express app the browser uses — no mocks, no direct Mongo writes (the API is the only writer).
// Invariants: public/auth endpoints only (no admin backdoors); envelopes are unwrapped exactly like
// the dashboard does (NFR-002); every helper asserts the expected status, so a broken API fails the
// spec at the arrangement step with the real `{code, message}` instead of a confusing UI timeout.

import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';

import { API_BASE_URL, API_HEALTH_URL } from './config';

/** Public user shape the API returns (INTEGRATION_CONTRACTS §3.3) — never includes passwordHash. */
export interface ApiUser {
  id: string;
  name: string;
  email: string;
  role: 'USER' | 'ADMIN';
  timezone: string;
  defaultDurationMin: number;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

/** `{accessToken, user}` returned by register/login (INTEGRATION_CONTRACTS §1.4). */
export interface AuthResult {
  accessToken: string;
  user: ApiUser;
}

/** Credentials used by the UI and the API helpers. */
export interface Credentials {
  name: string;
  email: string;
  password: string;
}

interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string; details?: unknown[] };
}

interface HealthData {
  status: 'ok';
  db: string;
  uptimeSec: number;
}

/** Unwrap the NFR-002 success envelope, or fail with the API's own error code/message. */
async function unwrap<T>(response: APIResponse, expectedStatus: number): Promise<T> {
  const body = (await response.json()) as SuccessEnvelope<T> | ErrorEnvelope;

  if (response.status() !== expectedStatus || body.success !== true) {
    const detail =
      body.success === true ? 'unexpected success envelope' : JSON.stringify(body.error);
    expect(
      response.status(),
      `expected ${expectedStatus} from ${response.url()} but got ${response.status()}: ${detail}`,
    ).toBe(expectedStatus);
    throw new Error(`unexpected API envelope from ${response.url()}: ${detail}`);
  }

  return body.data;
}

/** GET /health — proves the API process and its MongoDB connection are up (TECHNICAL_DESIGN §11). */
export async function checkHealth(request: APIRequestContext): Promise<HealthData> {
  const response = await request.get(API_HEALTH_URL);
  const data = await unwrap<HealthData>(response, 200);
  expect(data.db, 'the E2E API must be connected to its in-memory MongoDB').toBe('ok');
  return data;
}

/** POST /auth/register — creates a fresh USER account and returns its token (FR-001). */
export async function registerUser(
  request: APIRequestContext,
  overrides: Partial<Credentials> = {},
): Promise<{ credentials: Credentials; auth: AuthResult }> {
  const credentials: Credentials = {
    name: 'E2E User',
    email: `${new Date().toISOString().replace(/\D/g, '').slice(-10)}.${Math.floor(
      Math.random() * 1_000_000,
    )}@example.com`,
    password: 'E2ePass123',
    ...overrides,
  };

  const response = await request.post(`${API_BASE_URL}/auth/register`, { data: credentials });
  const auth = await unwrap<AuthResult>(response, 201);
  expect(auth.user.email).toBe(credentials.email.toLowerCase());
  return { credentials, auth };
}

/** POST /auth/login — proves the credentials the spec is about to type into the UI are valid. */
export async function loginUser(
  request: APIRequestContext,
  credentials: Pick<Credentials, 'email' | 'password'>,
): Promise<AuthResult> {
  const response = await request.post(`${API_BASE_URL}/auth/login`, { data: credentials });
  return unwrap<AuthResult>(response, 200);
}

// ---------------------------------------------------------------------------------------------
// Devices (INTEGRATION_CONTRACTS §3.1 #9/#10, §3.3 `device`) — used to arrange and to assert the
// server-side truth of the pairing flow independently of what the dashboard renders.
// ---------------------------------------------------------------------------------------------

/** `device` object shape (contract §3.3). */
export interface ApiDevice {
  id: string;
  name: string;
  os: 'macOS' | 'windows' | 'linux';
  status: 'CONNECTED' | 'FOCUSING' | 'DISCONNECTED';
  agentVersion: string;
  pairedAt: string | null;
  lastSeenAt: string | null;
}

/** Paginated list envelope (contract §1.6). */
export interface ApiPaginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** Bearer header for owner-scoped API calls made outside the browser. */
export function bearer(accessToken: string): { Authorization: string } {
  return { Authorization: `Bearer ${accessToken}` };
}

/** GET /devices — the account's paired devices (contract §3.1 #9). */
export async function listDevices(
  request: APIRequestContext,
  accessToken: string,
): Promise<ApiPaginated<ApiDevice>> {
  const response = await request.get(`${API_BASE_URL}/devices`, {
    headers: bearer(accessToken),
    params: { limit: 20, sort: '-lastSeenAt' },
  });
  return unwrap<ApiPaginated<ApiDevice>>(response, 200);
}

/** DELETE /devices/:id — unpair/revoke a device (contract §3.1 #10). */
export async function revokeDevice(
  request: APIRequestContext,
  accessToken: string,
  deviceId: string,
): Promise<{ id: string; revoked: true }> {
  const response = await request.delete(`${API_BASE_URL}/devices/${encodeURIComponent(deviceId)}`, {
    headers: bearer(accessToken),
  });
  return unwrap<{ id: string; revoked: true }>(response, 200);
}

// ---------------------------------------------------------------------------------------------
// Raw request helper + sessions/allow-list (INTEGRATION_CONTRACTS §3.1 #12–#16, §3.3) — used by
// `e2e/api-sessions.spec.ts` to assert real HTTP status codes and error codes, not just the happy
// path. Everything goes through the production Express stack and the in-memory MongoDB.
// ---------------------------------------------------------------------------------------------

/** One raw HTTP result, for negative-path assertions (status + error envelope). */
export interface RawApiResult {
  status: number;
  body: unknown;
}

/** Call the real API and return `{status, body}` without throwing on 4xx (negative-path helper). */
export async function rawApiRequest(
  request: APIRequestContext,
  accessToken: string | null,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  params?: Record<string, string | number>,
): Promise<RawApiResult> {
  const response = await request.fetch(`${API_BASE_URL}${path}`, {
    method,
    ...(accessToken === null ? {} : { headers: bearer(accessToken) }),
    ...(body === undefined ? {} : { data: body }),
    ...(params === undefined ? {} : { params }),
  });
  return { status: response.status(), body: await response.json().catch(() => null) };
}

/** Error code from a raw result, or `'<no error envelope>'` for a non-error body. */
export function errorCodeOf(result: RawApiResult): string {
  const body = result.body as { success?: boolean; error?: { code?: string } } | null;
  if (body !== null && body.success === false && body.error?.code !== undefined) {
    return body.error.code;
  }
  return '<no error envelope>';
}

/** `session` object shape (contract §3.3). */
export interface ApiSession {
  id: string;
  deviceId: string;
  startedAt: string;
  endedAt: string | null;
  plannedMinutes: number;
  actualMinutes: number;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  source: 'MANUAL' | 'SCHEDULE';
  clientSessionId: string;
  endReason: string | null;
  lastHeartbeatAt: string | null;
}

/** `appEntry` object shape (contract §3.2 `appEntrySchema`). */
export interface ApiAppEntry {
  key: string;
  label: string;
  win?: string[];
  mac?: string[];
  linux?: string[];
}

/** `allow-list` object shape (contract §3.3). */
export interface ApiAllowList {
  protectedApps: ApiAppEntry[];
  userApps: ApiAppEntry[];
  version: number;
}

/** `sessionCreateSchema` input with a fresh idempotency key unless the caller overrides it. */
export function sessionInput(
  deviceId: string,
  overrides: Partial<{
    durationMin: number;
    startedAt: string;
    clientSessionId: string;
    source: 'MANUAL' | 'SCHEDULE';
  }> = {},
): {
  deviceId: string;
  durationMin: number;
  startedAt: string;
  clientSessionId: string;
  source: 'MANUAL' | 'SCHEDULE';
} {
  return {
    deviceId,
    durationMin: 25,
    startedAt: new Date().toISOString(),
    clientSessionId: randomUUID(),
    source: 'MANUAL',
    ...overrides,
  };
}

/** POST /sessions — 201 session (contract §3.1 #12). */
export async function createSession(
  request: APIRequestContext,
  accessToken: string,
  input: ReturnType<typeof sessionInput>,
): Promise<ApiSession> {
  const response = await request.post(`${API_BASE_URL}/sessions`, {
    headers: bearer(accessToken),
    data: input,
  });
  return unwrap<ApiSession>(response, 201);
}

/** PATCH /sessions/:id — 200 session (contract §3.1 #13). */
export async function patchSession(
  request: APIRequestContext,
  accessToken: string,
  sessionId: string,
  input: {
    status: 'COMPLETED' | 'CANCELLED';
    endedAt: string;
    actualMinutes: number;
    endReason: string;
  },
): Promise<ApiSession> {
  const response = await request.patch(
    `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}`,
    {
      headers: bearer(accessToken),
      data: input,
    },
  );
  return unwrap<ApiSession>(response, 200);
}

/** GET /sessions — paginated list with filters (contract §3.1 #14, §1.6). */
export async function listSessions(
  request: APIRequestContext,
  accessToken: string,
  params: Record<string, string | number> = {},
): Promise<ApiPaginated<ApiSession>> {
  const response = await request.get(`${API_BASE_URL}/sessions`, {
    headers: bearer(accessToken),
    params: { limit: 100, ...params },
  });
  return unwrap<ApiPaginated<ApiSession>>(response, 200);
}

/** GET /allowlist — protected + user apps (contract §3.1 #15). */
export async function getAllowlist(
  request: APIRequestContext,
  accessToken: string,
): Promise<ApiAllowList> {
  const response = await request.get(`${API_BASE_URL}/allowlist`, { headers: bearer(accessToken) });
  return unwrap<ApiAllowList>(response, 200);
}

/** PUT /allowlist — replaces user apps; protected changes are rejected (contract §3.1 #16). */
export async function putAllowlist(
  request: APIRequestContext,
  accessToken: string,
  body: { userApps: ApiAppEntry[]; protectedApps?: ApiAppEntry[] },
): Promise<ApiAllowList> {
  const response = await request.put(`${API_BASE_URL}/allowlist`, {
    headers: bearer(accessToken),
    data: body,
  });
  return unwrap<ApiAllowList>(response, 200);
}

// ---------------------------------------------------------------------------------------------
// Schedules + notifications (INTEGRATION_CONTRACTS §3.1 #17–#20, #22; FR-012/FR-025, DEC-021) — the
// scheduled-session E2E creates a real schedule through the API and reads the missed-run notification.
// ---------------------------------------------------------------------------------------------

/** `schedule` object shape (contract §3.3). */
export interface ApiSchedule {
  id: string;
  name: string;
  days: number[];
  startTime: string;
  durationMin: number;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
}

/** `notification` object shape (contract §3.3). */
export interface ApiNotification {
  id: string;
  type: string;
  message: string;
  readAt: string | null;
  createdAt: string;
}

/** POST /schedules — 201 schedule (contract §3.1 #18). */
export async function createSchedule(
  request: APIRequestContext,
  accessToken: string,
  input: {
    name: string;
    days: number[];
    startTime: string;
    durationMin: number;
    enabled?: boolean;
  },
): Promise<ApiSchedule> {
  const response = await request.post(`${API_BASE_URL}/schedules`, {
    headers: bearer(accessToken),
    data: input,
  });
  return unwrap<ApiSchedule>(response, 201);
}

/** GET /schedules — the account's schedules (contract §3.1 #17). */
export async function listSchedules(
  request: APIRequestContext,
  accessToken: string,
): Promise<ApiPaginated<ApiSchedule>> {
  const response = await request.get(`${API_BASE_URL}/schedules`, {
    headers: bearer(accessToken),
    params: { limit: 100 },
  });
  return unwrap<ApiPaginated<ApiSchedule>>(response, 200);
}

/** DELETE /schedules/:id — cleanup helper (contract §3.1 #20). */
export async function deleteSchedule(
  request: APIRequestContext,
  accessToken: string,
  scheduleId: string,
): Promise<{ id: string }> {
  const response = await request.delete(
    `${API_BASE_URL}/schedules/${encodeURIComponent(scheduleId)}`,
    { headers: bearer(accessToken) },
  );
  return unwrap<{ id: string }>(response, 200);
}

/** GET /notifications — missed-run alerts (contract §3.1 #22, FR-025). */
export async function listNotifications(
  request: APIRequestContext,
  accessToken: string,
): Promise<ApiPaginated<ApiNotification>> {
  const response = await request.get(`${API_BASE_URL}/notifications`, {
    headers: bearer(accessToken),
    params: { limit: 100 },
  });
  return unwrap<ApiPaginated<ApiNotification>>(response, 200);
}
