// cloud/client.test.ts — end-to-end pairing/presence against a fake cloud (T-042, REC-001/002).
// A real `node:http` server + `ws` server implements `/agent/register`, `/agent/enroll/poll` and
// the `/agent-link` upgrade, so the agent is exercised over real HTTP/WebSocket I/O with no
// fakes in its own code. Covered: register→poll→paired, restored token, 15 s heartbeat, reconnect
// backoff, `revoked`/4401 restoring focus FIRST, and INV-2 (only `scheduleDue`/`revoked` acted on).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { heartbeatMessageSchema, type AgentState, type EndReason } from '@focus-mode/shared';
import { WebSocket, WebSocketServer } from 'ws';
import type { Logger } from '../log.js';
import { CloudClient, type CloudClientOptions } from './client.js';
import { computePairingCodeDigest } from './register.js';
import { agentLinkUrl, apiUrl } from './transport.js';
import type { CredentialStore, DeviceCredentials } from './storage.js';

const BASE_PATH = '/api/v1';
const DEVICE_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';
const DEVICE_TOKEN = 'f3b2'.repeat(16);
const ENROLL_SECRET = 'q8Zt3n0rG6mJ2xV5cB1kL9pA4sD7fH0wAbCdEfGh';
const RUN_ID = '507f1f77bcf86cd799439014';
const SCHEDULE_ID = '507f1f77bcf86cd799439013';
const SESSION_ID = '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f';

type LogFn = (message: string, ...meta: readonly unknown[]) => void;

const quietLogger: Logger = {
  error: vi.fn<LogFn>(),
  warn: vi.fn<LogFn>(),
  info: vi.fn<LogFn>(),
  debug: vi.fn<LogFn>(),
};

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length === 0 ? undefined : (JSON.parse(text) as unknown);
}

interface Waiter {
  readonly count: number;
  readonly resolve: () => void;
}

/**
 * Minimal fake cloud: exact contract paths, envelope shapes and the `Authorization` header on the
 * `/agent-link` upgrade. Behaviour (pending polls, forced closes, junk frames) is per test.
 */
class FakeCloud {
  readonly httpServer: Server;
  readonly wss: WebSocketServer;
  readonly sockets = new Set<WebSocket>();
  readonly registerBodies: unknown[] = [];
  readonly pollBodies: unknown[] = [];
  readonly authorizations: (string | undefined)[] = [];
  readonly heartbeats: { state: AgentState; sessionId?: string }[] = [];
  readonly junk: string[] = [];

  wsConnections = 0;
  /** How many polls answer "not paired yet" before the token is issued. */
  pendingPolls = 0;
  /** How a pending poll answers: a 200 without a token (default) or NOT_FOUND. */
  pendingMode: '200' | '404' = '200';

  #port = 0;
  #connectionWaiters: Waiter[] = [];
  #heartbeatWaiters: Waiter[] = [];

  private constructor() {
    this.httpServer = createServer((request, response) => {
      void this.#handleRequest(request, response);
    });
    this.wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
    this.httpServer.on('upgrade', (request, socket, head) => {
      this.#handleUpgrade(request, socket, head);
    });
    this.wss.on('connection', (socket) => {
      this.#trackSocket(socket);
    });
  }

  static async start(): Promise<FakeCloud> {
    const fake = new FakeCloud();
    await new Promise<void>((resolve) => fake.httpServer.listen(0, '127.0.0.1', resolve));
    const address = fake.httpServer.address() as AddressInfo;
    fake.#port = address.port;
    return fake;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.#port}${BASE_PATH}`;
  }

  get lastSocket(): WebSocket | undefined {
    return [...this.sockets].at(-1);
  }

  waitForConnections(count: number): Promise<void> {
    return this.#waitFor(this.#connectionWaiters, this.wsConnections, count);
  }

  waitForHeartbeats(count: number): Promise<void> {
    return this.#waitFor(this.#heartbeatWaiters, this.heartbeats.length, count);
  }

  send(message: unknown): void {
    this.lastSocket?.send(JSON.stringify(message));
  }

  sendRaw(text: string): void {
    this.lastSocket?.send(text);
  }

  closeCurrent(code: number): void {
    this.lastSocket?.close(code);
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.terminate();
    this.sockets.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.httpServer.close(() => resolve()));
  }

  #waitFor(waiters: Waiter[], current: number, count: number): Promise<void> {
    if (current >= count) return Promise.resolve();
    return new Promise<void>((resolve) => {
      waiters.push({ count, resolve });
    });
  }

  #notify(waiters: Waiter[], current: number): void {
    for (const waiter of [...waiters]) {
      if (current < waiter.count) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  }

  async #handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');

    if (request.method === 'POST' && url.pathname === `${BASE_PATH}/agent/register`) {
      this.registerBodies.push(await readJsonBody(request));
      this.#respond(response, 201, {
        success: true,
        data: { deviceId: DEVICE_ID, enrollSecret: ENROLL_SECRET },
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === `${BASE_PATH}/agent/enroll/poll`) {
      this.pollBodies.push(await readJsonBody(request));
      if (this.pollBodies.length <= this.pendingPolls) {
        if (this.pendingMode === '404') {
          this.#respond(response, 404, {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Not paired yet' },
          });
        } else {
          this.#respond(response, 200, { success: true, data: { paired: false } });
        }
        return;
      }
      this.#respond(response, 200, {
        success: true,
        data: { deviceToken: DEVICE_TOKEN, userId: USER_ID, allowListVersion: 1 },
      });
      return;
    }

    this.#respond(response, 404, { success: false, error: { code: 'NOT_FOUND' } });
  }

  #handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const authorization = request.headers.authorization;
    this.authorizations.push(authorization);

    if (url.pathname !== `${BASE_PATH}/agent-link` || authorization !== `Bearer ${DEVICE_TOKEN}`) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(request, socket, head, (webSocket) => {
      this.wss.emit('connection', webSocket, request);
    });
  }

  #trackSocket(socket: WebSocket): void {
    this.wsConnections += 1;
    this.sockets.add(socket);
    socket.on('close', () => {
      this.sockets.delete(socket);
    });
    socket.on('message', (data) => {
      const text = data.toString();
      try {
        const parsed = heartbeatMessageSchema.safeParse(JSON.parse(text));
        if (parsed.success) {
          this.heartbeats.push({
            state: parsed.data.state,
            ...(parsed.data.sessionId === undefined ? {} : { sessionId: parsed.data.sessionId }),
          });
          this.#notify(this.#heartbeatWaiters, this.heartbeats.length);
          return;
        }
      } catch {
        // Fall through: record it below.
      }
      this.junk.push(text);
    });
    this.#notify(this.#connectionWaiters, this.wsConnections);
  }

  #respond(response: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(text),
    });
    response.end(text);
  }
}

class FakeController {
  state: AgentState = 'IDLE';
  readonly calls: string[] = [];

  getState(): { state: AgentState; session?: { sessionId: string } } {
    return this.state === 'FOCUSING'
      ? { state: this.state, session: { sessionId: SESSION_ID } }
      : { state: this.state };
  }

  markPaired(): void {
    this.calls.push('markPaired');
    this.state = 'PAIRED';
  }

  markUnpaired(): void {
    this.calls.push('markUnpaired');
    this.state = 'IDLE';
  }

  async exitFocus(reason: EndReason): Promise<null> {
    this.calls.push(`exitFocus:${reason}`);
    this.state = 'PAIRED';
    return null;
  }
}

class MemoryStore implements CredentialStore {
  saved: DeviceCredentials | null;
  loadCalls = 0;
  saveCalls = 0;
  clearCalls = 0;

  constructor(initial: DeviceCredentials | null = null) {
    this.saved = initial;
  }

  async load(): Promise<DeviceCredentials | null> {
    this.loadCalls += 1;
    return this.saved;
  }

  async save(credentials: DeviceCredentials): Promise<void> {
    this.saveCalls += 1;
    this.saved = credentials;
  }

  async clear(): Promise<void> {
    this.clearCalls += 1;
    this.saved = null;
  }
}

interface Harness {
  readonly cloud: CloudClient;
  readonly controller: FakeController;
  readonly store: MemoryStore;
}

const cleanups: Array<() => Promise<void>> = [];

function makeHarness(
  fake: FakeCloud,
  options: Partial<CloudClientOptions> = {},
  store: MemoryStore = new MemoryStore(),
): Harness {
  const controller = new FakeController();
  const cloud = new CloudClient({
    baseUrl: fake.baseUrl,
    agentVersion: '0.1.0',
    deviceName: 'Kabir-MacBook',
    os: 'macOS',
    controller,
    store,
    logger: quietLogger,
    requestTimeoutMs: 1_000,
    pollBackoff: { initialMs: 10, maxMs: 20, jitterRatio: 0 },
    registerBackoff: { initialMs: 10, maxMs: 20, jitterRatio: 0 },
    ...options,
  });
  cleanups.push(async () => {
    await cloud.stop();
  });
  return { cloud, controller, store };
}

async function startFake(): Promise<FakeCloud> {
  const fake = await FakeCloud.start();
  cleanups.push(async () => {
    await fake.stop();
  });
  return fake;
}

afterEach(async () => {
  vi.useRealTimers();
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) await cleanup();
  }
});

describe('cloud URL derivation (DEC-013, contract §5.1)', () => {
  it('joins the full API base with endpoint paths only', () => {
    expect(apiUrl('http://localhost:5000/api/v1', '/agent/register')).toBe(
      'http://localhost:5000/api/v1/agent/register',
    );
    expect(() => apiUrl('http://localhost:5000/api/v1', 'agent/register')).toThrow(/start with/);
  });

  it('derives wss for https and ws for local http', () => {
    expect(agentLinkUrl('https://api.example.com/api/v1')).toBe(
      'wss://api.example.com/api/v1/agent-link',
    );
    expect(agentLinkUrl('http://localhost:5000/api/v1')).toBe(
      'ws://localhost:5000/api/v1/agent-link',
    );
  });
});

describe('pairing flow (register → poll → paired → link)', () => {
  it('registers only the DEC-014 digest, polls, stores the token and opens the link', async () => {
    const fake = await startFake();
    fake.pendingPolls = 2;
    const { cloud, controller, store } = makeHarness(fake);
    const pairedEvent = new Promise<{ deviceId: string; userId: string }>((resolve) => {
      cloud.on('paired', resolve);
    });

    await cloud.start();

    const code = cloud.getState().pairingCode;
    expect(code).toMatch(/^\d{6}$/);
    expect(cloud.getState().paired).toBe(false);

    await fake.waitForConnections(1);
    await fake.waitForHeartbeats(1);
    await expect(pairedEvent).resolves.toEqual({ deviceId: DEVICE_ID, userId: USER_ID });

    // The register request carries the digest of the code shown in the agent UI (DEC-014) and
    // never the plaintext code itself.
    expect(fake.registerBodies).toHaveLength(1);
    const registerBody = fake.registerBodies[0] as Record<string, unknown>;
    expect(registerBody['codeHmac']).toBe(computePairingCodeDigest(code ?? ''));
    expect(registerBody['codeHmac']).toMatch(/^[a-f0-9]{64}$/);
    expect(registerBody['os']).toBe('macOS');
    expect(registerBody['name']).toBe('Kabir-MacBook');
    expect(registerBody['agentVersion']).toBe('0.1.0');
    expect(JSON.stringify(registerBody)).not.toContain(code);

    expect(fake.pollBodies).toHaveLength(3);
    for (const pollBody of fake.pollBodies) {
      expect(pollBody).toEqual({ deviceId: DEVICE_ID, enrollSecret: ENROLL_SECRET });
    }

    expect(store.saved).toEqual({
      deviceId: DEVICE_ID,
      deviceToken: DEVICE_TOKEN,
      userId: USER_ID,
    });
    expect(controller.calls).toEqual(['markPaired']);

    const state = cloud.getState();
    expect(state).toMatchObject({
      state: 'PAIRED',
      paired: true,
      connected: true,
      deviceId: DEVICE_ID,
      userId: USER_ID,
      pairingCode: null,
      pairingExpiresAt: null,
    });

    // Contract §5.1: the `/agent-link` upgrade carries the device token as a Bearer header.
    expect(fake.authorizations).toEqual([`Bearer ${DEVICE_TOKEN}`]);
    expect(fake.heartbeats[0]).toEqual({ state: 'PAIRED' });
  });

  it('restores a stored pairing at start without registering a new code', async () => {
    const fake = await startFake();
    const store = new MemoryStore({
      deviceId: DEVICE_ID,
      deviceToken: DEVICE_TOKEN,
      userId: USER_ID,
    });
    const { cloud, controller } = makeHarness(fake, {}, store);
    const pairedEvent = new Promise<{ deviceId: string; userId: string }>((resolve) => {
      cloud.on('paired', resolve);
    });

    await cloud.start();
    await fake.waitForConnections(1);
    await fake.waitForHeartbeats(1);

    expect(fake.registerBodies).toHaveLength(0);
    expect(fake.pollBodies).toHaveLength(0);
    expect(controller.calls).toEqual(['markPaired']);
    await expect(pairedEvent).resolves.toEqual({ deviceId: DEVICE_ID, userId: USER_ID });
    expect(cloud.getState().paired).toBe(true);
  });

  it('sends a heartbeat every 15 s (fake timers)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const fake = await startFake();
    const { cloud } = makeHarness(fake, { heartbeatIntervalMs: 15_000 });

    await cloud.start();
    await fake.waitForHeartbeats(1);

    await vi.advanceTimersByTimeAsync(45_000);
    await new Promise<void>((resolve) => setImmediate(resolve));

    // One immediate heartbeat on open + three interval ticks = 4; a 10 s interval would be 5+.
    expect(fake.heartbeats).toHaveLength(4);
    expect(fake.heartbeats.every((beat) => beat.state === 'PAIRED')).toBe(true);
  });

  it('reconnects with backoff after the cloud link drops', async () => {
    const fake = await startFake();
    const { cloud } = makeHarness(fake, {
      reconnectBackoff: { initialMs: 20, maxMs: 80, factor: 2, jitterRatio: 0 },
    });

    await cloud.start();
    await fake.waitForConnections(1);
    fake.closeCurrent(1011);

    await fake.waitForConnections(2);
    // The reconnect sends its first heartbeat as soon as the new socket opens.
    await fake.waitForHeartbeats(2);
    expect(fake.authorizations).toEqual([`Bearer ${DEVICE_TOKEN}`, `Bearer ${DEVICE_TOKEN}`]);
    expect(cloud.getState().connected).toBe(true);
  });
});

describe('INV-2 — the cloud can only announce or revoke', () => {
  it('emits scheduleDue as a typed event and starts no session', async () => {
    const fake = await startFake();
    const { cloud, controller } = makeHarness(fake);
    await cloud.start();
    await fake.waitForConnections(1);
    await fake.waitForHeartbeats(1);

    const scheduleDue = new Promise<Record<string, unknown>>((resolve) => {
      cloud.on('scheduleDue', resolve);
    });
    fake.send({
      v: 1,
      id: 'c-004',
      type: 'scheduleDue',
      runId: RUN_ID,
      scheduleId: SCHEDULE_ID,
      durationMin: 25,
      allowListVersion: 3,
    });

    await expect(scheduleDue).resolves.toMatchObject({
      type: 'scheduleDue',
      runId: RUN_ID,
      scheduleId: SCHEDULE_ID,
      durationMin: 25,
      allowListVersion: 3,
    });
    // The fake controller has no enterFocus() at all: the cloud path cannot start a session.
    expect(controller.calls).toEqual(['markPaired']);
  });

  it('ignores wrong-direction and unknown cloud messages without touching the agent', async () => {
    const fake = await startFake();
    const { cloud, controller } = makeHarness(fake, { heartbeatIntervalMs: 25 });
    let scheduleDueCount = 0;
    let revokedCount = 0;
    cloud.on('scheduleDue', () => {
      scheduleDueCount += 1;
    });
    cloud.on('revoked', () => {
      revokedCount += 1;
    });

    await cloud.start();
    await fake.waitForConnections(1);
    await fake.waitForHeartbeats(1);

    // A buggy/hostile cloud echoing agent→cloud messages, an unknown control message and junk.
    fake.send({ v: 1, id: 'c-100', type: 'heartbeat', state: 'FOCUSING', sessionId: SESSION_ID });
    fake.send({
      v: 1,
      id: 'c-101',
      type: 'enterFocus',
      durationMin: 25,
      allowList: [],
      consent: { acceptedAt: '2026-11-10T10:00:00.000Z', version: 'consent-v1' },
      clientSessionId: SESSION_ID,
    });
    fake.send({ v: 1, id: 'c-102', type: 'session.ended', clientSessionId: SESSION_ID });
    fake.sendRaw('{not json');

    // The socket stays usable: heartbeats keep arriving and nothing was acted on.
    await fake.waitForHeartbeats(3);
    expect(scheduleDueCount).toBe(0);
    expect(revokedCount).toBe(0);
    expect(controller.calls).toEqual(['markPaired']);
    expect(cloud.getState().state).toBe('PAIRED');
    expect(cloud.getState().connected).toBe(true);
    expect(fake.junk).toHaveLength(0);
  });
});

describe('revocation (FR-029, INV-5)', () => {
  it('restores focus before unpairing when a revoked frame arrives', async () => {
    const fake = await startFake();
    const { cloud, controller, store } = makeHarness(fake);
    const revoked = new Promise<{ reason: string }>((resolve) => {
      cloud.on('revoked', resolve);
    });

    await cloud.start();
    await fake.waitForConnections(1);
    await fake.waitForHeartbeats(1);

    // Simulate an active session started by the (future) authenticated local control path.
    controller.state = 'FOCUSING';
    // The fake cloud must not pair the fresh code automatically: no user typed it.
    fake.pendingPolls = 1_000;
    fake.send({ v: 1, id: 'c-005', type: 'revoked' });

    await expect(revoked).resolves.toEqual({ reason: 'REVOKED' });
    expect(controller.calls).toEqual(['markPaired', 'exitFocus:UNPAIRED', 'markUnpaired']);
    expect(store.clearCalls).toBe(1);
    expect(store.saved).toBeNull();

    const state = cloud.getState();
    expect(state.paired).toBe(false);
    expect(state.state).toBe('IDLE');
    expect(state.deviceId).toBeNull();

    // The unpaired flow resumes with a fresh code and a new registration.
    await vi.waitFor(() => {
      expect(fake.registerBodies).toHaveLength(2);
    });
    expect(cloud.getState().pairingCode).toMatch(/^\d{6}$/);
  });

  it('treats a 4401 close as a revoked token (TOKEN_INVALID)', async () => {
    const fake = await startFake();
    const { cloud, controller, store } = makeHarness(fake);
    const revoked = new Promise<{ reason: string }>((resolve) => {
      cloud.on('revoked', resolve);
    });

    await cloud.start();
    await fake.waitForConnections(1);
    await fake.waitForHeartbeats(1);

    fake.pendingPolls = 1_000;
    fake.closeCurrent(4401);

    await expect(revoked).resolves.toEqual({ reason: 'TOKEN_INVALID' });
    expect(store.clearCalls).toBe(1);
    expect(controller.calls).toEqual(['markPaired', 'markUnpaired']);
    expect(cloud.getState().paired).toBe(false);
  });

  it('keeps polling a still-valid code when the poll answers NOT_FOUND', async () => {
    const fake = await startFake();
    fake.pendingPolls = 1;
    fake.pendingMode = '404';
    const { cloud } = makeHarness(fake);

    await cloud.start();
    await fake.waitForConnections(1);

    expect(fake.registerBodies).toHaveLength(1);
    expect(fake.pollBodies).toHaveLength(2);
    expect(cloud.getState().paired).toBe(true);
  });
});
