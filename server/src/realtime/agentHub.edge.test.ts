// server/src/realtime/agentHub.edge.test.ts — W7 (task-46): the agent-link hub's failure and
// ordering branches. Why: `realtime/agentHub.ts` (83.14 % lines) had only its happy paths proven —
// the upgrade refusals (404 non-agent-link path, 503 credential-lookup failure), the newest-wins
// duplicate connection, the strict-frame closes (binary/malformed JSON/wrong direction), an
// unexpected report failure (1011), report conflicts that must NOT drop the socket, and the
// heartbeat sweeper with an injected clock were all unexecuted. Those branches decide whether a
// Focus Agent reconnects (1001/1011) or gives up (4401) and whether presence can lie to the
// dashboard, so each one is asserted as observable behaviour over a real socket.
// Invariants asserted (TECHNICAL_DESIGN §6.3, INV-2/INV-6): presence never lingers for a superseded
// or stale socket; a domain conflict in an agent report is logged and the socket stays open; a
// cancelled/missed schedule run is never resurrected by a late report; and no frame other than the
// frozen agent→cloud union is accepted.

import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, revokedMessageSchema } from '@focus-mode/shared';
import { Types } from 'mongoose';
import { WebSocket } from 'ws';
import { Device } from '../models/Device.js';
import { ScheduleRun } from '../models/ScheduleRun.js';
import { Session } from '../models/Session.js';
import {
  clearTestDatabase,
  createDirectUser,
  startTestDatabase,
  stopTestDatabase,
} from '../test/helpers.js';
import {
  AGENT_LINK_PATH,
  AUTH_FAILURE_CLOSE_CODE,
  HEARTBEAT_TIMEOUT_CLOSE_CODE,
  attachAgentHub,
  closeAgentHub,
  getPresence,
  hashDeviceToken,
  isDeviceConnected,
  type AgentHubApi,
  type AgentHubOptions,
} from './agentHub.js';

const UNKNOWN_DEVICE_ID = '507f1f77bcf86cd799439099';

interface TestSocket {
  readonly socket: WebSocket;
  readonly closed: Promise<{ code: number; reason: string }>;
}

const httpServers: Server[] = [];
const sockets: WebSocket[] = [];

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(10);
  }
  throw new Error(`condition not met within ${timeoutMs} ms`);
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

interface HubContext {
  readonly hub: AgentHubApi;
  readonly port: number;
}

async function startHub(overrides: AgentHubOptions = {}): Promise<HubContext> {
  const server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('test HTTP server did not bind a TCP port');
  }
  const hub = attachAgentHub(server, {
    heartbeatTimeoutMs: 5_000,
    sweepIntervalMs: 1_000,
    ...overrides,
  });
  httpServers.push(server);
  return { hub, port: (address as AddressInfo).port };
}

function openAgentSocket(
  port: number,
  options: { token?: string; path?: string } = {},
): TestSocket {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers.Authorization = `Bearer ${options.token}`;
  const socket = new WebSocket(`ws://127.0.0.1:${port}${options.path ?? AGENT_LINK_PATH}`, {
    headers,
  });
  // Never let an unexpected ws error escape as an unhandled 'error' event.
  socket.on('error', () => undefined);
  sockets.push(socket);
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
  return { socket, closed };
}

/** Open a socket that the hub is expected to REFUSE at the HTTP level; resolves with the message. */
function refusalMessage(port: number, options: { token?: string; path?: string }): Promise<string> {
  const headers: Record<string, string> = {};
  if (options.token !== undefined) headers.Authorization = `Bearer ${options.token}`;
  const socket = new WebSocket(`ws://127.0.0.1:${port}${options.path ?? AGENT_LINK_PATH}`, {
    headers,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('error', (error: Error) => {
      resolve(error.message);
    });
    socket.once('open', () => {
      reject(new Error('expected the upgrade to be refused'));
    });
  });
}

interface CreatedDevice {
  deviceId: string;
  token: string;
  ownerId: Types.ObjectId;
}

async function createDevice(): Promise<CreatedDevice> {
  const token = `device-token-${randomUUID()}`;
  const ownerId = (await createDirectUser())._id;
  const device = await Device.create({
    ownerId,
    name: 'Edge Test Mac',
    os: 'macOS',
    pairedAt: new Date('2026-11-10T10:00:00.000Z'),
    lastSeenAt: null,
    status: 'DISCONNECTED',
    deviceTokenHash: hashDeviceToken(token),
    agentVersion: '0.1.0',
  });
  return { deviceId: String(device._id), token, ownerId };
}

async function deviceStatus(deviceId: string): Promise<string | undefined> {
  return (await Device.findById(deviceId))?.status;
}

function sendFrame(socket: WebSocket, payload: Record<string, unknown>): void {
  socket.send(JSON.stringify(payload));
}

/** Connect a device and wait until presence + DB status are established. */
async function connect(
  port: number,
  device: CreatedDevice,
): Promise<TestSocket & { socket: WebSocket }> {
  const client = openAgentSocket(port, { token: device.token });
  await waitForOpen(client.socket);
  await waitFor(() => isDeviceConnected(device.deviceId));
  return client;
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

afterEach(async () => {
  await closeAgentHub();
  vi.restoreAllMocks();
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(
    httpServers.splice(0).map(
      async (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
});

describe('constructor validation', () => {
  it('refuses non-positive tuning values with a RangeError', () => {
    // A zero/negative interval or NaN heartbeat window would silently disable presence sweeping.
    for (const options of [
      { heartbeatTimeoutMs: 0 },
      { sweepIntervalMs: -1 },
      { maxPayloadBytes: Number.NaN },
    ]) {
      expect(() => attachAgentHub(createServer(), options)).toThrow(RangeError);
    }
  });

  it('close() is idempotent and detaches the upgrade listener', async () => {
    const { hub } = await startHub();
    await hub.close();
    await expect(hub.close()).resolves.toBeUndefined();
    expect(hub.connectionCount).toBe(0);
  });
});

describe('upgrade refusals', () => {
  it('refuses a non-agent-link path with an HTTP 404 (no presence, no DB write)', async () => {
    const { hub, port } = await startHub();
    const device = await createDevice();

    await expect(
      refusalMessage(port, { token: device.token, path: '/not-agent-link' }),
    ).resolves.toContain('404');
    await waitFor(() => hub.connectionCount === 0);
    expect(getPresence(device.deviceId)).toBeNull();
    expect(await deviceStatus(device.deviceId)).toBe('DISCONNECTED');
  });

  it('answers 503 when the credential lookup itself fails (never 401: the token may be valid)', async () => {
    const { hub, port } = await startHub();
    const device = await createDevice();
    vi.spyOn(Device, 'findOne').mockImplementationOnce(() => {
      throw new Error('mongo unavailable');
    });

    await expect(refusalMessage(port, { token: device.token })).resolves.toContain('503');
    await waitFor(() => hub.connectionCount === 0);
    expect(getPresence(device.deviceId)).toBeNull();
  });

  it('treats an over-long bearer token as missing and closes with 4401', async () => {
    const { port } = await startHub();
    const client = openAgentSocket(port, { token: 'x'.repeat(513) });

    expect((await client.closed).code).toBe(AUTH_FAILURE_CLOSE_CODE);
  });
});

describe('duplicate connections', () => {
  it('keeps the newest socket and replaces the older one without marking the device offline', async () => {
    const { hub, port } = await startHub();
    const device = await createDevice();
    const first = await connect(port, device);
    const second = await connect(port, device);

    const closed = await first.closed;
    expect(closed.code).toBe(1000);
    expect(closed.reason).toMatch(/newer/i);
    await waitFor(() => hub.connectionCount === 1);
    // The superseded socket's close must not write DISCONNECTED over the live presence.
    expect(getPresence(device.deviceId)).not.toBeNull();
    expect(isDeviceConnected(device.deviceId)).toBe(true);
    expect(await deviceStatus(device.deviceId)).toBe('CONNECTED');
    expect(second.socket.readyState).toBe(WebSocket.OPEN);
  });
});

describe('strict frame validation (INV-6)', () => {
  it('closes 1008 on a binary frame', async () => {
    const { port } = await startHub();
    const device = await createDevice();
    const client = await connect(port, device);

    client.socket.send(Buffer.from([0x7b, 0x7d]));

    expect((await client.closed).code).toBe(1008);
    await waitFor(() => getPresence(device.deviceId) === null);
    expect(await deviceStatus(device.deviceId)).toBe('DISCONNECTED');
  });

  it('closes 1008 on malformed JSON', async () => {
    const { port } = await startHub();
    const device = await createDevice();
    const client = await connect(port, device);

    client.socket.send('{not-json');

    expect((await client.closed).code).toBe(1008);
  });

  it('closes 1008 on a cloud→agent frame sent in the agent→cloud direction', async () => {
    const { port } = await startHub();
    const device = await createDevice();
    const client = await connect(port, device);

    // Structurally valid (the `revoked` envelope) but the hub must never accept it inbound
    // (INV-2: nothing on this channel may look like a command from the agent).
    const revoked = revokedMessageSchema.parse({
      v: PROTOCOL_VERSION,
      id: 'cloud-only-frame',
      type: 'revoked',
    });
    sendFrame(client.socket, revoked);

    expect((await client.closed).code).toBe(1008);
  });

  it('closes 1011 when an unexpected internal failure escapes a report', async () => {
    const { port } = await startHub();
    const device = await createDevice();
    const client = await connect(port, device);
    // `#deviceOwnerId` runs outside the report try/catch: an infrastructure error must close the
    // socket (the agent reconnects) rather than leave it half-alive.
    vi.spyOn(Device, 'findById').mockImplementationOnce(() => {
      throw new Error('database connection lost');
    });

    sendFrame(client.socket, {
      v: PROTOCOL_VERSION,
      id: 'report-owner-lookup-failure',
      type: 'session.started',
      clientSessionId: randomUUID(),
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      plannedMinutes: 25,
      source: 'MANUAL',
    });

    expect((await client.closed).code).toBe(1011);
  });
});

describe('report conflicts never drop a healthy socket', () => {
  it('keeps the socket open when the device already has an active session (409)', async () => {
    const { port } = await startHub();
    const device = await createDevice();
    const client = await connect(port, device);

    // Another dashboard-started session is already ACTIVE for this device (FR-024).
    await Session.create({
      userId: device.ownerId,
      deviceId: new Types.ObjectId(device.deviceId),
      startedAt: new Date(Date.now() - 120_000),
      plannedMinutes: 25,
      actualMinutes: 0,
      status: 'ACTIVE',
      source: 'MANUAL',
      clientSessionId: randomUUID(),
      endReason: null,
      lastHeartbeatAt: new Date(Date.now() - 120_000),
    });

    sendFrame(client.socket, {
      v: PROTOCOL_VERSION,
      id: 'report-already-focusing',
      type: 'session.started',
      clientSessionId: randomUUID(),
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      plannedMinutes: 25,
      source: 'MANUAL',
    });
    await sleep(200);

    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    expect(await Session.countDocuments()).toBe(1);
    expect(isDeviceConnected(device.deviceId)).toBe(true);
  });

  it('keeps the socket open when session.ended conflicts with a finalised session (409)', async () => {
    const { port } = await startHub();
    const device = await createDevice();
    const client = await connect(port, device);

    const clientSessionId = randomUUID();
    const startedAt = new Date(Date.now() - 120_000).toISOString();
    sendFrame(client.socket, {
      v: PROTOCOL_VERSION,
      id: 'conflict-report-start',
      type: 'session.started',
      clientSessionId,
      startedAt,
      plannedMinutes: 25,
      source: 'MANUAL',
    });
    await waitFor(async () => (await Session.countDocuments({ clientSessionId })) === 1);

    const endedAt = new Date(Date.now() - 60_000);
    sendFrame(client.socket, {
      v: PROTOCOL_VERSION,
      id: 'conflict-report-end-1',
      type: 'session.ended',
      clientSessionId,
      endedAt: endedAt.toISOString(),
      actualMinutes: 1,
      status: 'COMPLETED',
      endReason: 'COMPLETED',
    });
    await waitFor(
      async () => (await Session.findOne({ clientSessionId }).lean())?.status === 'COMPLETED',
    );

    // A second, contradictory report is a 409 from the session service — logged, not fatal.
    sendFrame(client.socket, {
      v: PROTOCOL_VERSION,
      id: 'conflict-report-end-2',
      type: 'session.ended',
      clientSessionId,
      endedAt: new Date(endedAt.getTime() + 1_000).toISOString(),
      actualMinutes: 5,
      status: 'COMPLETED',
      endReason: 'COMPLETED',
    });
    await sleep(200);

    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    const session = await Session.findOne({ clientSessionId }).lean();
    expect(session).toMatchObject({ status: 'COMPLETED', actualMinutes: 1 });
    expect(isDeviceConnected(device.deviceId)).toBe(true);
  });

  it('ignores reports from a device row that no longer exists (nothing is fabricated)', async () => {
    const { port } = await startHub();
    const device = await createDevice();
    const client = await connect(port, device);
    // Unpaired while the socket is still open (e.g. revoked from another dashboard tab).
    await Device.deleteOne({ _id: device.deviceId });

    sendFrame(client.socket, {
      v: PROTOCOL_VERSION,
      id: 'unowned-start',
      type: 'session.started',
      clientSessionId: randomUUID(),
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      plannedMinutes: 25,
      source: 'MANUAL',
    });
    sendFrame(client.socket, {
      v: PROTOCOL_VERSION,
      id: 'unowned-end',
      type: 'session.ended',
      clientSessionId: randomUUID(),
      endedAt: new Date().toISOString(),
      actualMinutes: 1,
      status: 'COMPLETED',
      endReason: 'COMPLETED',
    });
    await sleep(250);

    expect(await Session.countDocuments()).toBe(0);
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });
});

describe('schedule-run ordering (DEC-021)', () => {
  async function createRun(
    deviceId: string,
    ownerId: Types.ObjectId,
    status: 'STARTED' | 'MISSED' = 'STARTED',
  ): Promise<string> {
    const run = await ScheduleRun.create({
      scheduleId: new Types.ObjectId(),
      userId: ownerId,
      deviceId: new Types.ObjectId(deviceId),
      firedAt: new Date(Date.now() - 30_000),
      status,
      sessionId: null,
    });
    return String(run._id);
  }

  it('never resurrects a run the user already cancelled (cancel wins over a late start)', async () => {
    const { port } = await startHub();
    const device = await createDevice();
    const client = await connect(port, device);
    const runId = await createRun(device.deviceId, device.ownerId);

    sendFrame(client.socket, {
      v: PROTOCOL_VERSION,
      id: 'cancel-before-start',
      type: 'scheduleRunCancelled',
      runId,
      at: new Date().toISOString(),
    });
    await waitFor(
      async () => (await ScheduleRun.findById(runId).lean())?.status === 'CANCELLED_BY_USER',
    );

    // The agent reports the start anyway (race with a user cancel): the run stays cancelled...
    const clientSessionId = randomUUID();
    sendFrame(client.socket, {
      v: PROTOCOL_VERSION,
      id: 'start-after-cancel',
      type: 'session.started',
      clientSessionId,
      startedAt: new Date(Date.now() - 30_000).toISOString(),
      plannedMinutes: 25,
      source: 'SCHEDULE',
      scheduleRunId: runId,
    });
    await waitFor(async () => (await Session.countDocuments({ clientSessionId })) === 1);

    // ...and is never linked to the session (nothing is fabricated on the cancelled run).
    const run = await ScheduleRun.findById(runId).lean();
    expect(run?.status).toBe('CANCELLED_BY_USER');
    expect(run?.sessionId).toBeNull();
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('does not confirm a run that was already MISSED', async () => {
    const { port } = await startHub();
    const device = await createDevice();
    const client = await connect(port, device);
    const runId = await createRun(device.deviceId, device.ownerId, 'MISSED');

    const clientSessionId = randomUUID();
    sendFrame(client.socket, {
      v: PROTOCOL_VERSION,
      id: 'start-after-missed',
      type: 'session.started',
      clientSessionId,
      startedAt: new Date(Date.now() - 30_000).toISOString(),
      plannedMinutes: 25,
      source: 'SCHEDULE',
      scheduleRunId: runId,
    });
    await waitFor(async () => (await Session.countDocuments({ clientSessionId })) === 1);

    const run = await ScheduleRun.findById(runId).lean();
    expect(run?.status).toBe('MISSED');
    expect(run?.sessionId).toBeNull();
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });
});

describe('heartbeat sweep with an injected clock', () => {
  it('closes a silent connection with 1001 once the timeout passes, and spares a refreshed one', async () => {
    // The module's own clock seam keeps this deterministic without fake timers fighting real sockets.
    let clock = Date.parse('2026-11-10T10:00:00.000Z');
    const { hub, port } = await startHub({
      now: () => clock,
      heartbeatTimeoutMs: 45_000,
      sweepIntervalMs: 10,
    });
    const device = await createDevice();
    const client = await connect(port, device);

    // Move 40 s forward and refresh: still inside the 45 s window from the new heartbeat.
    clock += 40_000;
    sendFrame(client.socket, {
      v: PROTOCOL_VERSION,
      id: 'clock-heartbeat-1',
      type: 'heartbeat',
      state: 'FOCUSING',
    });
    await waitFor(() => getPresence(device.deviceId)?.state === 'FOCUSING');
    clock += 40_000;
    await sleep(120);
    expect(isDeviceConnected(device.deviceId)).toBe(true);

    // Now let the full window elapse with no heartbeat: the sweep must drop presence and close 1001.
    clock += 46_000;
    await waitFor(() => getPresence(device.deviceId) === null);
    expect((await client.closed).code).toBe(HEARTBEAT_TIMEOUT_CLOSE_CODE);
    await waitFor(async () => (await deviceStatus(device.deviceId)) === 'DISCONNECTED');
    expect(hub.connectionCount).toBe(0);
  });

  it('keeps the socket and later writes working after a presence write fails', async () => {
    const { port } = await startHub();
    const device = await createDevice();
    const client = await connect(port, device);
    // KI-023: the CONNECTED status write is queued behind the auth handshake, so on slower CI
    // runners it can land a tick after the client resolves — wait for it instead of racing it.
    await waitFor(async () => (await deviceStatus(device.deviceId)) === 'CONNECTED');

    // A transient Mongo failure on the presence write is logged, never fatal (INV: presence stays
    // authoritative in memory) and must not poison the per-device write chain.
    vi.spyOn(Device, 'updateOne').mockImplementationOnce(() => {
      throw new Error('transient write failure');
    });
    sendFrame(client.socket, {
      v: PROTOCOL_VERSION,
      id: 'heartbeat-write-fails',
      type: 'heartbeat',
      state: 'FOCUSING',
    });
    await waitFor(() => getPresence(device.deviceId)?.state === 'FOCUSING');
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    // KI-023: still the old status; poll in case the failed write's chain is still settling.
    await waitFor(async () => (await deviceStatus(device.deviceId)) === 'CONNECTED');

    sendFrame(client.socket, {
      v: PROTOCOL_VERSION,
      id: 'heartbeat-after-failure',
      type: 'heartbeat',
      state: 'FOCUSING',
    });
    // The chain is intact: the next heartbeat reaches Mongo.
    await waitFor(async () => (await deviceStatus(device.deviceId)) === 'FOCUSING');
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });
});

describe('revocation is authoritative while offline', () => {
  it('marks a device DISCONNECTED even when it has no live socket', async () => {
    const { hub } = await startHub();
    const device = await createDevice();
    await Device.updateOne({ _id: device.deviceId }, { $set: { status: 'CONNECTED' } });

    await expect(hub.revokeDevice(device.deviceId)).resolves.toBe(true);
    expect(await deviceStatus(device.deviceId)).toBe('DISCONNECTED');
    expect(getPresence(device.deviceId)).toBeNull();
  });

  it('returns false for an unknown device id and never throws', async () => {
    const { hub } = await startHub();
    await expect(hub.revokeDevice(UNKNOWN_DEVICE_ID)).resolves.toBe(false);
    await expect(hub.revokeDevice('not-an-object-id')).resolves.toBe(false);
  });
});
