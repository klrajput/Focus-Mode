// server/src/realtime/agentHub.test.ts — the agent-link hub's auth, presence, heartbeat and INV-2
// contract (T-041). Why: presence drives the dashboard badge and the scheduler, so every path that
// can create or clear it is exercised with a real HTTP server, a real `ws` client and a real
// MongoDB (mongodb-memory-server, KI-006 cache): missing/unknown token, connection registration,
// heartbeat state transitions, the 45 s timeout (short injected intervals), scheduleDue delivery,
// revocation and socket close. The final test proves the module can emit only the two frozen
// cloud→agent messages (INV-2) and that no generic send method exists to bypass them.

import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CLOUD_MESSAGE_DIRECTIONS,
  CLOUD_MESSAGE_TYPES,
  PROTOCOL_VERSION,
  cloudMessageSchema,
  revokedMessageSchema,
  scheduleDueMessageSchema,
  type DeviceStatus,
} from '@focus-mode/shared';
import { Types } from 'mongoose';
import { WebSocket, type RawData } from 'ws';
import { Device, type DeviceDocument } from '../models/Device.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../test/helpers.js';
import {
  AGENT_LINK_CONTRACT_PATH,
  AGENT_LINK_PATH,
  AUTH_FAILURE_CLOSE_CODE,
  HEARTBEAT_TIMEOUT_CLOSE_CODE,
  attachAgentHub,
  closeAgentHub,
  getPresence,
  hashDeviceToken,
  isDeviceConnected,
  revokeDevice,
  sendScheduleDue,
  type AgentHubApi,
  type AgentHubOptions,
} from './agentHub.js';

const SESSION_ID = '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f';
const UNKNOWN_DEVICE_ID = '507f1f77bcf86cd799439099';
const SCHEDULE_PAYLOAD = {
  runId: '507f1f77bcf86cd799439011',
  scheduleId: '507f1f77bcf86cd799439012',
  durationMin: 25,
  allowListVersion: 3,
} as const;

/** Compile-time INV-2 guard: any new generic sender on the API fails `npm run typecheck`. */
type GenericSendKey = Extract<keyof AgentHubApi, 'send' | 'sendToDevice' | 'broadcast' | 'emit'>;
const NO_GENERIC_SEND: [GenericSendKey] extends [never] ? true : false = true;

interface HubContext {
  readonly hub: AgentHubApi;
  readonly server: Server;
  readonly port: number;
}

interface TestSocket {
  readonly socket: WebSocket;
  readonly closed: Promise<{ code: number; reason: string }>;
}

const httpServers: Server[] = [];
const sockets: WebSocket[] = [];

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

/** Poll a condition; mongodb-memory-server writes are asynchronous, so no fake timers here. */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error(`condition not met within ${timeoutMs} ms`);
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('timed out waiting for an agent-link frame'));
    }, 3_000);
    const onMessage = (data: RawData): void => {
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(JSON.parse(toBuffer(data).toString('utf8')) as unknown);
    };
    socket.on('message', onMessage);
  });
}

function collectFrames(socket: WebSocket): unknown[] {
  const frames: unknown[] = [];
  socket.on('message', (data: RawData) => {
    frames.push(JSON.parse(toBuffer(data).toString('utf8')) as unknown);
  });
  return frames;
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
  const bound: AddressInfo = address;
  return { hub, server, port: bound.port };
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
  sockets.push(socket);
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
  return { socket, closed };
}

async function createDevice(
  overrides: { token?: string; status?: DeviceStatus } = {},
): Promise<{ deviceId: string; token: string }> {
  const token = overrides.token ?? `device-token-${randomUUID()}`;
  const device = await Device.create({
    ownerId: new Types.ObjectId(),
    name: 'Test Mac',
    os: 'macOS',
    pairedAt: new Date('2026-11-10T10:00:00.000Z'),
    lastSeenAt: null,
    status: overrides.status ?? 'DISCONNECTED',
    deviceTokenHash: hashDeviceToken(token),
    agentVersion: '0.1.0',
  });
  return { deviceId: String(device._id), token };
}

async function readDevice(deviceId: string): Promise<DeviceDocument> {
  const device = await Device.findById(deviceId);
  if (device === null) throw new Error(`Device ${deviceId} disappeared from the test database`);
  return device;
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

describe('agent-link hub lifecycle', () => {
  it('exposes safe no-op helpers before a hub is attached', async () => {
    await expect(closeAgentHub()).resolves.toBeUndefined();
    await expect(revokeDevice(UNKNOWN_DEVICE_ID)).resolves.toBe(false);
    expect(sendScheduleDue(UNKNOWN_DEVICE_ID, SCHEDULE_PAYLOAD)).toBe(false);
    expect(getPresence(UNKNOWN_DEVICE_ID)).toBeNull();
    expect(isDeviceConnected(UNKNOWN_DEVICE_ID)).toBe(false);
  });

  it('refuses to attach a second hub in the same process', async () => {
    await startHub();
    expect(() => attachAgentHub(createServer())).toThrow(/already attached/);
  });

  it('closeAgentHub terminates live sockets so graceful shutdown cannot hang', async () => {
    const { hub, port } = await startHub();
    const { deviceId, token } = await createDevice();
    const client = openAgentSocket(port, { token });
    await waitForOpen(client.socket);
    await waitFor(() => isDeviceConnected(deviceId));

    await closeAgentHub();

    await client.closed;
    expect(hub.connectionCount).toBe(0);
    expect(getPresence(deviceId)).toBeNull();
    expect(sendScheduleDue(deviceId, SCHEDULE_PAYLOAD)).toBe(false);
  });
});

describe('agent-link authentication', () => {
  it('closes a socket without an Authorization header with code 4401', async () => {
    const { hub, port } = await startHub();
    const client = openAgentSocket(port);

    const closed = await client.closed;
    expect(closed.code).toBe(AUTH_FAILURE_CLOSE_CODE);
    await waitFor(() => hub.connectionCount === 0);
    expect(getPresence(UNKNOWN_DEVICE_ID)).toBeNull();
  });

  it('rejects an unknown token with 4401 and leaves the device row untouched', async () => {
    const { hub, port } = await startHub();
    const { deviceId, token } = await createDevice();
    const client = openAgentSocket(port, { token: `${token}-wrong` });

    expect((await client.closed).code).toBe(AUTH_FAILURE_CLOSE_CODE);
    await waitFor(() => hub.connectionCount === 0);
    expect(getPresence(deviceId)).toBeNull();
    expect(isDeviceConnected(deviceId)).toBe(false);
    const device = await readDevice(deviceId);
    expect(device.status).toBe('DISCONNECTED');
    expect(device.lastSeenAt).toBeNull();
  });

  it('registers presence and marks the device CONNECTED for a valid token', async () => {
    const { hub, port } = await startHub();
    const { deviceId, token } = await createDevice();
    const client = openAgentSocket(port, { token });

    await waitForOpen(client.socket);
    await waitFor(() => isDeviceConnected(deviceId));
    expect(hub.connectionCount).toBe(1);
    const presence = getPresence(deviceId);
    expect(presence?.deviceId).toBe(deviceId);
    expect(presence?.state).toBe('IDLE');
    expect(presence?.sessionId).toBeNull();
    expect(presence?.lastHeartbeatAt).toEqual(expect.any(Number));

    await waitFor(async () => (await readDevice(deviceId)).status === 'CONNECTED');
    expect((await readDevice(deviceId)).lastSeenAt).toBeInstanceOf(Date);
  });

  it('accepts the /api/v1/agent-link spelling the Focus Agent derives from its API base', async () => {
    const { port } = await startHub();
    const { deviceId, token } = await createDevice();
    const client = openAgentSocket(port, { token, path: AGENT_LINK_CONTRACT_PATH });

    await waitForOpen(client.socket);
    await waitFor(() => isDeviceConnected(deviceId));
    expect(getPresence(deviceId)?.state).toBe('IDLE');
  });
});

describe('heartbeats', () => {
  it('applies heartbeat state and sessionId to presence and the device row', async () => {
    const { port } = await startHub();
    const { deviceId, token } = await createDevice();
    const client = openAgentSocket(port, { token });
    await waitForOpen(client.socket);
    await waitFor(() => isDeviceConnected(deviceId));
    const connectedAt = (await readDevice(deviceId)).lastSeenAt?.getTime() ?? 0;

    client.socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        id: 'hb-1',
        type: 'heartbeat',
        state: 'FOCUSING',
        sessionId: SESSION_ID,
      }),
    );

    await waitFor(() => getPresence(deviceId)?.state === 'FOCUSING');
    expect(getPresence(deviceId)?.sessionId).toBe(SESSION_ID);
    await waitFor(async () => (await readDevice(deviceId)).status === 'FOCUSING');
    expect((await readDevice(deviceId)).lastSeenAt?.getTime()).toBeGreaterThanOrEqual(connectedAt);

    client.socket.send(
      JSON.stringify({ v: PROTOCOL_VERSION, id: 'hb-2', type: 'heartbeat', state: 'PAIRED' }),
    );
    await waitFor(async () => (await readDevice(deviceId)).status === 'CONNECTED');
    expect(getPresence(deviceId)?.sessionId).toBeNull();
  });

  it('closes the socket with 1008 for a heartbeat that fails the shared schema', async () => {
    const { port } = await startHub();
    const { deviceId, token } = await createDevice();
    const client = openAgentSocket(port, { token });
    await waitForOpen(client.socket);
    await waitFor(() => isDeviceConnected(deviceId));

    client.socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        id: 'hb-bad',
        type: 'heartbeat',
        state: 'DAYDREAMING',
      }),
    );

    expect((await client.closed).code).toBe(1008);
    await waitFor(() => getPresence(deviceId) === null);
  });
});

describe('INV-2 cloud → agent messages', () => {
  it('delivers scheduleDue with the frozen shared shape', async () => {
    const { port } = await startHub();
    const { deviceId, token } = await createDevice();
    const client = openAgentSocket(port, { token });
    await waitForOpen(client.socket);
    await waitFor(() => isDeviceConnected(deviceId));

    const frame = nextMessage(client.socket);
    expect(sendScheduleDue(deviceId, SCHEDULE_PAYLOAD)).toBe(true);
    const parsed = scheduleDueMessageSchema.parse(await frame);
    expect(parsed).toMatchObject({ ...SCHEDULE_PAYLOAD, v: PROTOCOL_VERSION, type: 'scheduleDue' });
    expect(parsed.id.length).toBeGreaterThan(0);
  });

  it('returns false instead of queueing when the device is offline or the payload is invalid', async () => {
    const { port } = await startHub();
    const offline = await createDevice();
    expect(sendScheduleDue(offline.deviceId, SCHEDULE_PAYLOAD)).toBe(false);
    expect(sendScheduleDue(UNKNOWN_DEVICE_ID, SCHEDULE_PAYLOAD)).toBe(false);

    const online = await createDevice();
    const client = openAgentSocket(port, { token: online.token });
    await waitForOpen(client.socket);
    await waitFor(() => isDeviceConnected(online.deviceId));
    expect(sendScheduleDue(online.deviceId, { ...SCHEDULE_PAYLOAD, durationMin: 0 })).toBe(false);
  });

  it('revokes a connected device, closes it 1000 and marks it DISCONNECTED', async () => {
    const { port } = await startHub();
    const { deviceId, token } = await createDevice();
    const client = openAgentSocket(port, { token });
    await waitForOpen(client.socket);
    await waitFor(() => isDeviceConnected(deviceId));

    const frame = nextMessage(client.socket);
    await expect(revokeDevice(deviceId)).resolves.toBe(true);
    expect(revokedMessageSchema.parse(await frame)).toMatchObject({
      v: PROTOCOL_VERSION,
      type: 'revoked',
    });
    expect((await client.closed).code).toBe(1000);
    expect(getPresence(deviceId)).toBeNull();
    expect(isDeviceConnected(deviceId)).toBe(false);
    await waitFor(async () => (await readDevice(deviceId)).status === 'DISCONNECTED');
  });

  it('returns false when revoking an unknown or malformed device id', async () => {
    await startHub();
    await expect(revokeDevice(UNKNOWN_DEVICE_ID)).resolves.toBe(false);
    await expect(revokeDevice('not-an-object-id')).resolves.toBe(false);
  });

  it('can only ever emit the two frozen cloud → agent message types', async () => {
    expect(NO_GENERIC_SEND).toBe(true);
    const cloudToAgentTypes = [...CLOUD_MESSAGE_TYPES]
      .filter((type) => CLOUD_MESSAGE_DIRECTIONS[type] === 'CLOUD_TO_AGENT')
      .sort();
    expect(cloudToAgentTypes).toEqual(['revoked', 'scheduleDue']);

    const { port } = await startHub();
    const { deviceId, token } = await createDevice();
    const client = openAgentSocket(port, { token });
    const frames = collectFrames(client.socket);
    await waitForOpen(client.socket);
    await waitFor(() => isDeviceConnected(deviceId));

    expect(sendScheduleDue(deviceId, SCHEDULE_PAYLOAD)).toBe(true);
    await expect(revokeDevice(deviceId)).resolves.toBe(true);
    await client.closed;

    const emitted = frames.map((frame) => cloudMessageSchema.parse(frame));
    expect(emitted.map((message) => message.type)).toEqual(['scheduleDue', 'revoked']);
    for (const message of emitted) expect(cloudToAgentTypes).toContain(message.type);
  });
});

describe('presence teardown', () => {
  it('marks the device DISCONNECTED when the socket closes', async () => {
    const { port } = await startHub();
    const { deviceId, token } = await createDevice();
    const client = openAgentSocket(port, { token });
    await waitForOpen(client.socket);
    await waitFor(() => isDeviceConnected(deviceId));

    client.socket.close(1000, 'test done');

    await waitFor(async () => (await readDevice(deviceId)).status === 'DISCONNECTED');
    expect(getPresence(deviceId)).toBeNull();
    expect(isDeviceConnected(deviceId)).toBe(false);
  });

  it('sweeps a silent connection once the heartbeat timeout has elapsed', async () => {
    // Short injected intervals keep the 45 s contract timeout verifiable; generous enough that a
    // loaded CI runner still registers the connection before the first sweep can call it stale.
    const { port } = await startHub({ heartbeatTimeoutMs: 300, sweepIntervalMs: 10 });
    const { deviceId, token } = await createDevice();
    const client = openAgentSocket(port, { token });
    await waitForOpen(client.socket);
    await waitFor(() => isDeviceConnected(deviceId));

    await waitFor(() => getPresence(deviceId) === null);
    expect((await client.closed).code).toBe(HEARTBEAT_TIMEOUT_CLOSE_CODE);
    await waitFor(async () => (await readDevice(deviceId)).status === 'DISCONNECTED');
    expect(isDeviceConnected(deviceId)).toBe(false);
  });

  it('keeps a heartbeat-refreshed connection out of the sweeper', async () => {
    // 1 s timeout, one heartbeat every 300 ms: the test window outlives the timeout while the
    // connection never goes 300 ms without a heartbeat, so it must still be present at the end.
    const { port } = await startHub({ heartbeatTimeoutMs: 1_000, sweepIntervalMs: 20 });
    const { deviceId, token } = await createDevice();
    const client = openAgentSocket(port, { token });
    await waitForOpen(client.socket);
    await waitFor(() => isDeviceConnected(deviceId));

    const beats = [
      { id: 'hb-keep-1', sessionId: '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e61' },
      { id: 'hb-keep-2', sessionId: '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e62' },
      { id: 'hb-keep-3', sessionId: '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e63' },
      { id: 'hb-keep-4', sessionId: '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e64' },
      { id: 'hb-keep-5', sessionId: '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e65' },
    ];
    const gapMs = 300;

    for (const [index, beat] of beats.entries()) {
      client.socket.send(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          id: beat.id,
          type: 'heartbeat',
          state: 'FOCUSING',
          sessionId: beat.sessionId,
        }),
      );
      // Each distinct sessionId proves the server processed that exact heartbeat.
      await waitFor(() => getPresence(deviceId)?.sessionId === beat.sessionId);
      if (index < beats.length - 1) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, gapMs);
        });
      }
    }

    expect((beats.length - 1) * gapMs).toBeGreaterThan(1_000);
    expect(isDeviceConnected(deviceId)).toBe(true);
    expect(getPresence(deviceId)?.state).toBe('FOCUSING');
  });
});
