// e2e/helpers/api.ts — typed HTTP helpers for arranging E2E fixtures against the real API
// (T-047 prep, owner A8).
// Why: specs need real accounts without replaying the signup UI for every arrangement, and they need
// the failure message the API actually returns. Playwright's APIRequestContext talks to the same
// Express app the browser uses — no mocks, no direct Mongo writes (the API is the only writer).
// Invariants: public/auth endpoints only (no admin backdoors); envelopes are unwrapped exactly like
// the dashboard does (NFR-002); every helper asserts the expected status, so a broken API fails the
// spec at the arrangement step with the real `{code, message}` instead of a confusing UI timeout.

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
