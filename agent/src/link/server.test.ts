// link/server.test.ts — the loopback link's security and protocol contract (T-031, NFR-010).
// Every rejection is exercised with a real `ws` client: foreign/missing Origin, DNS-rebinding
// Host, missing subprotocol, oversized frame, fourth connection, rate limit, malformed frames
// and unauthenticated control messages. The hello frame carries state but never the pairing
// code (DEC-003). The server is Electron-free, so this runs in plain Node.
// It also pins the two pairing transitions of KI-010 (agent half): a dashboard that connected
// before pairing receives a fresh `hello {paired:true}` + `challenge` with no page reload, and
// unpairing policy-closes every dashboard socket so it re-handshakes as unpaired.

import { createServer, type Server as NetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authErrorMessageSchema,
  authOkMessageSchema,
  challengeMessageSchema,
  focusRejectedMessageSchema,
  helloMessageSchema,
  localMessageSchema,
  stateMessageSchema,
  type AppEntry,
  type SessionInfo,
} from '@focus-mode/shared';
import { WebSocket } from 'ws';
import {
  LINK_PATH,
  LinkServer,
  MAX_CONNECTIONS,
  MAX_MESSAGES_PER_SECOND,
  MAX_PAYLOAD_BYTES,
  type LinkAddress,
  type LinkServerOptions,
} from './server.js';
import type { LinkSnapshot } from './messages.js';

const ORIGIN = 'http://localhost:5173';
const SESSION_ID = '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f';
const CHROME: AppEntry = { key: 'chrome', label: 'Google Chrome', mac: ['com.google.Chrome'] };
const VSCODE: AppEntry = {
  key: 'vscode',
  label: 'Visual Studio Code',
  mac: ['com.microsoft.VSCode'],
};

const servers: LinkServer[] = [];
const sockets: WebSocket[] = [];
const netServers: NetServer[] = [];

const SNAPSHOT: LinkSnapshot = {
  state: 'PAIRED',
  paired: false,
  protected: [CHROME],
  allowList: [VSCODE],
};

const SESSION: SessionInfo = {
  sessionId: SESSION_ID,
  startedAt: '2026-11-10T10:00:00.000Z',
  endsAt: '2026-11-10T11:00:00.000Z',
  plannedMinutes: 60,
  source: 'MANUAL',
};

async function startLink(overrides: Partial<LinkServerOptions> = {}): Promise<{
  server: LinkServer;
  address: LinkAddress;
}> {
  const server = new LinkServer({
    port: 0,
    allowedOrigins: [ORIGIN],
    identity: {
      agentId: 'agent-test',
      agentVersion: '1.0.0',
      os: 'macOS',
      capabilities: { focus: 'full' },
    },
    getSnapshot: () => SNAPSHOT,
    ...overrides,
  });
  const address = await server.start();
  servers.push(server);
  return { server, address };
}

function linkUrl(port: number): string {
  return `ws://127.0.0.1:${port}${LINK_PATH}`;
}

interface TestClient {
  readonly socket: WebSocket;
  /** Next server frame, buffered from the moment the socket was created (no hello race). */
  next(): Promise<unknown>;
  readonly closed: Promise<{ code: number; reason: string }>;
}

function connect(
  port: number,
  options: {
    origin?: string;
    protocols?: string[];
    headers?: Record<string, string>;
  } = {},
): Promise<TestClient> {
  const protocols = options.protocols ?? ['focus.v1'];
  const socket = new WebSocket(linkUrl(port), protocols, {
    origin: options.origin ?? ORIGIN,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  });
  sockets.push(socket);

  const queue: unknown[] = [];
  const waiters: Array<(message: unknown) => void> = [];
  socket.on('message', (data) => {
    const message: unknown = JSON.parse(data.toString());
    const waiter = waiters.shift();
    if (waiter !== undefined) waiter(message);
    else queue.push(message);
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
  });

  return new Promise((resolve, reject) => {
    socket.once('open', () => {
      resolve({
        socket,
        closed,
        next: () =>
          new Promise((nextResolve) => {
            const buffered = queue.shift();
            if (buffered !== undefined) nextResolve(buffered);
            else waiters.push(nextResolve);
          }),
      });
    });
    socket.once('error', reject);
  });
}

/** Resolves with the HTTP status the server used to reject the upgrade. */
function upgradeStatus(
  port: number,
  options: {
    /** `null` omits the Origin header entirely; undefined uses the allowed test Origin. */
    origin?: string | null;
    protocols?: string[];
    headers?: Record<string, string>;
    path?: string;
  } = {},
): Promise<number> {
  const url = options.path ?? linkUrl(port);
  const protocols = options.protocols ?? ['focus.v1'];
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  const socket = new WebSocket(url, protocols, {
    ...(origin === null ? {} : { origin }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    socket.once('open', () => {
      socket.terminate();
      reject(new Error('Expected the upgrade to be rejected'));
    });
    socket.on('error', () => {
      // Rejection can also surface as an error; unexpected-response handles the status.
    });
  });
}

function findLanIpv4(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return undefined;
}

/** Proves the socket is not reachable on a non-loopback interface (NFR-010). */
function lanConnectionRefused(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://${host}:${port}${LINK_PATH}`, ['focus.v1'], {
      origin: ORIGIN,
      handshakeTimeout: 1500,
    });
    const finish = (refused: boolean): void => {
      socket.terminate();
      resolve(refused);
    };
    socket.once('open', () => finish(false));
    socket.once('error', () => finish(true));
    socket.once('unexpected-response', () => finish(true));
  });
}

async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(true));
    });
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  while (sockets.length > 0) {
    const socket = sockets.pop();
    if (socket !== undefined) socket.terminate();
  }
  while (servers.length > 0) {
    const server = servers.pop();
    if (server !== undefined) await server.stop();
  }
  while (netServers.length > 0) {
    const server = netServers.pop();
    if (server !== undefined) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('LinkServer upgrade checks', () => {
  it('binds loopback only and speaks focus.v1', async () => {
    const { address } = await startLink();
    expect(address.host).toBe('127.0.0.1');
    expect(address.port).toBeGreaterThan(0);

    const client = await connect(address.port);
    const hello = helloMessageSchema.parse(await client.next());
    expect(hello.type).toBe('hello');
    expect(hello.os).toBe('macOS');
    expect(hello.paired).toBe(false);
    expect(hello.state).toBe('PAIRED');
  });

  it('never includes the pairing code in hello (DEC-003)', async () => {
    const { address } = await startLink();
    const client = await connect(address.port);
    const raw = await client.next();

    expect(raw).not.toHaveProperty('pairingCode');
    expect(raw).not.toHaveProperty('code');
    const serialized = JSON.stringify(raw);
    expect(serialized).not.toMatch(/\b\d{6}\b/);
    expect(localMessageSchema.safeParse(raw).success).toBe(true);
  });

  it('rejects a foreign Origin with 403', async () => {
    const { address } = await startLink();
    await expect(upgradeStatus(address.port, { origin: 'https://evil.example' })).resolves.toBe(
      403,
    );
  });

  it('rejects a missing Origin with 403', async () => {
    const { address } = await startLink();
    const status = await upgradeStatus(address.port, { origin: null });
    // ws omits the Origin header when the option is absent; the server must fail closed.
    expect(status).toBe(403);
  });

  it('rejects a foreign Host header with 403 (DNS-rebinding defence)', async () => {
    const { address } = await startLink();
    await expect(
      upgradeStatus(address.port, { headers: { Host: 'rebind.evil.example' } }),
    ).resolves.toBe(403);
  });

  it('accepts the localhost Host spelling on the loopback socket', async () => {
    const { address } = await startLink();
    const client = await connect(address.port, {
      headers: { Host: `localhost:${address.port}` },
    });
    expect(helloMessageSchema.parse(await client.next()).type).toBe('hello');
  });

  it('rejects an upgrade without the focus.v1 subprotocol with 400', async () => {
    const { address } = await startLink();
    await expect(upgradeStatus(address.port, { protocols: [] })).resolves.toBe(400);
    await expect(upgradeStatus(address.port, { protocols: ['focus.v2'] })).resolves.toBe(400);
  });

  it('rejects a non-/link path with 404', async () => {
    const { address } = await startLink();
    await expect(
      upgradeStatus(address.port, { path: `ws://127.0.0.1:${address.port}/other` }),
    ).resolves.toBe(404);
  });

  it('rejects a fourth concurrent connection with 503', async () => {
    const { address, server } = await startLink();
    const first = await connect(address.port);
    const second = await connect(address.port);
    const third = await connect(address.port);
    expect(server.connectedClients).toBe(3);
    await expect(first.next()).resolves.toMatchObject({ type: 'hello' });
    await expect(second.next()).resolves.toMatchObject({ type: 'hello' });
    await expect(third.next()).resolves.toMatchObject({ type: 'hello' });

    await expect(upgradeStatus(address.port)).resolves.toBe(503);
  });

  it('is unreachable on a non-loopback interface (NFR-010)', async () => {
    const lanIp = findLanIpv4();
    if (lanIp === undefined) return; // No LAN interface in this environment (e.g. CI sandbox).
    const { address } = await startLink();
    await expect(lanConnectionRefused(address.port, lanIp)).resolves.toBe(true);
  });

  it('falls back to the next port when the configured one is busy', async () => {
    const blocker = createServer();
    netServers.push(blocker);
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()));
    const busyPort = (blocker.address() as AddressInfo).port;

    const { address } = await startLink({ port: busyPort, portFallbackAttempts: 4 });
    expect(address.port).not.toBe(busyPort);
    expect(address.port).toBeGreaterThan(busyPort);
    expect(address.port).toBeLessThanOrEqual(busyPort + 3);
    expect(await portIsFree(address.port)).toBe(false);
  });
});

describe('LinkServer messages', () => {
  it('answers getState with a schema-valid state frame', async () => {
    const state: LinkSnapshot = { ...SNAPSHOT, state: 'FOCUSING', session: SESSION };
    const { address } = await startLink({ getSnapshot: () => state });
    const client = await connect(address.port);
    await client.next(); // hello

    client.socket.send(JSON.stringify({ v: 1, id: 'd-1', type: 'getState' }));
    const reply = stateMessageSchema.parse(await client.next());
    expect(reply.state).toBe('FOCUSING');
    expect(reply.session).toEqual(SESSION);
    expect(reply.protected.map((entry) => entry.key)).toEqual(['chrome']);
    expect(reply.allowList.map((entry) => entry.key)).toEqual(['vscode']);
  });

  it('treats paired as a nudge and replies with state', async () => {
    const onPaired = vi.fn();
    const { address } = await startLink({ onPaired });
    const client = await connect(address.port);
    await client.next();

    client.socket.send(JSON.stringify({ v: 1, id: 'd-2', type: 'paired' }));
    expect(stateMessageSchema.parse(await client.next()).type).toBe('state');
    expect(onPaired).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed JSON with authError VALIDATION_ERROR and closes 1008', async () => {
    const { address } = await startLink();
    const client = await connect(address.port);
    await client.next();

    client.socket.send('{not json');
    const error = authErrorMessageSchema.parse(await client.next());
    expect(error.code).toBe('VALIDATION_ERROR');
    await expect(client.closed).resolves.toMatchObject({ code: 1008 });
  });

  it('rejects wrong-direction frames', async () => {
    const { address } = await startLink();
    const client = await connect(address.port);
    await client.next();

    client.socket.send(
      JSON.stringify({
        v: 1,
        id: 'a-1',
        type: 'hello',
        agentId: 'other',
        agentVersion: '1.0.0',
        os: 'macOS',
        state: 'IDLE',
        paired: false,
        capabilities: { focus: 'full' },
      }),
    );
    const error = authErrorMessageSchema.parse(await client.next());
    expect(error.code).toBe('VALIDATION_ERROR');
    await expect(client.closed).resolves.toMatchObject({ code: 1008 });
  });

  it('refuses an unauthenticated enterFocus with focusRejected UNAUTHENTICATED (REC-003)', async () => {
    const { address } = await startLink();
    const client = await connect(address.port);
    await client.next();

    client.socket.send(
      JSON.stringify({
        v: 1,
        id: 'd-3',
        type: 'enterFocus',
        durationMin: 60,
        allowList: [VSCODE],
        consent: { acceptedAt: '2026-11-10T10:00:00.000Z', version: 'consent-v1' },
        clientSessionId: SESSION_ID,
      }),
    );
    const rejection = focusRejectedMessageSchema.parse(await client.next());
    expect(rejection.code).toBe('UNAUTHENTICATED');
    await expect(client.closed).resolves.toMatchObject({ code: 1008 });
  });

  it('fails closed on an auth frame when no challenge was issued (unpaired)', async () => {
    const { address } = await startLink();
    const client = await connect(address.port);
    await client.next();

    client.socket.send(
      JSON.stringify({ v: 1, id: 'd-4', type: 'auth', attestation: 'x'.repeat(32) }),
    );
    const error = authErrorMessageSchema.parse(await client.next());
    expect(error.code).toBe('UNAUTHENTICATED');
    expect(error.message).toMatch(/no challenge/i);
    await expect(client.closed).resolves.toMatchObject({ code: 1008 });
  });

  it('pins the contract limits (16 KB frame, 3 connections, 20 msg/s)', () => {
    expect(MAX_PAYLOAD_BYTES).toBe(16 * 1024);
    expect(MAX_CONNECTIONS).toBe(3);
    expect(MAX_MESSAGES_PER_SECOND).toBe(20);
  });

  it('closes a frame one byte over the 16 KB limit with 1009', async () => {
    const { address } = await startLink();
    const client = await connect(address.port);
    await client.next();

    // Exactly 16 KB + 1 byte, not a wildly larger frame: proves the boundary itself.
    client.socket.send('x'.repeat(MAX_PAYLOAD_BYTES + 1));
    await expect(client.closed).resolves.toMatchObject({ code: 1009 });
  });

  it('closes a flooding socket with 1008 at the real default 20 msg/s', async () => {
    const { address } = await startLink();
    const client = await connect(address.port);
    await client.next();

    // 21 frames in one synchronous burst is over the default limit; the server must close the
    // socket rather than answer an unbounded number of frames (NFR-010).
    for (let index = 0; index <= MAX_MESSAGES_PER_SECOND; index += 1) {
      client.socket.send(JSON.stringify({ v: 1, id: `d-flood-${index}`, type: 'getState' }));
    }
    await expect(client.closed).resolves.toMatchObject({ code: 1008 });
  });

  it('closes a socket with a configured lower rate limit with 1008', async () => {
    const { address } = await startLink({ maxMessagesPerSecond: 3 });
    const client = await connect(address.port);
    await client.next();

    for (let index = 0; index < 5; index += 1) {
      client.socket.send(JSON.stringify({ v: 1, id: `d-flood-${index}`, type: 'getState' }));
    }
    await expect(client.closed).resolves.toMatchObject({ code: 1008 });
  });

  it('reports the bound address and releases the port on stop', async () => {
    const { address, server } = await startLink();
    const { port } = address;
    await server.stop();
    servers.splice(servers.indexOf(server), 1);

    expect(await portIsFree(port)).toBe(true);
    const restarted = await startLink({ port });
    expect(restarted.address).toEqual({ host: '127.0.0.1', port });
  });
});

describe('pairing transitions (KI-010 agent half, FR-004)', () => {
  const DEVICE_ID = '507f1f77bcf86cd799439011';
  const USER_ID = '507f1f77bcf86cd799439012';

  it('re-issues hello {paired:true} + a fresh challenge on an already-connected socket', async () => {
    // The dashboard connected while the agent was unpaired: hello said paired:false, no challenge.
    let binding: { deviceId: string; userId: string } | null = null;
    const { server, address } = await startLink({
      getPairing: () => binding,
      getSnapshot: () => ({ ...SNAPSHOT, paired: binding !== null }),
    });

    const client = await connect(address.port);
    const firstHello = helloMessageSchema.parse(await client.next());
    expect(firstHello.paired).toBe(false);

    // The enroll poll succeeded: the agent is paired while this socket is still open.
    binding = { deviceId: DEVICE_ID, userId: USER_ID };
    server.refreshPairing();

    // A fresh hello is what tells the dashboard the pairing state changed (no page reload).
    const refreshedHello = helloMessageSchema.parse(await client.next());
    expect(refreshedHello.paired).toBe(true);
    expect(refreshedHello.state).toBe('PAIRED');
    // …followed by a new single-use nonce, so the dashboard can attest right away.
    const challenge = challengeMessageSchema.parse(await client.next());
    expect(challenge.nonce.length).toBeGreaterThanOrEqual(16);
    expect(challenge.nonce.length).toBeLessThanOrEqual(128);
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('issues no refresh while the agent is still unpaired', async () => {
    const { server, address } = await startLink({
      getPairing: () => null,
      getSnapshot: () => ({ ...SNAPSHOT, paired: false }),
    });

    const client = await connect(address.port);
    expect(helloMessageSchema.parse(await client.next()).paired).toBe(false);
    server.refreshPairing();

    // Nothing follows: no challenge exists without a pairing binding.
    const nextFrame = await Promise.race([
      client.next(),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 150)),
    ]);
    expect(nextFrame).toBe('timeout');
  });

  it('policy-closes an authenticated socket when the device is unpaired (1008 UNPAIRED)', async () => {
    const binding = { deviceId: DEVICE_ID, userId: USER_ID };
    const { server, address } = await startLink({
      getPairing: () => binding,
      getSnapshot: () => ({ ...SNAPSHOT, paired: true }),
      verifyAttestation: async () => ({
        ok: true,
        deviceId: DEVICE_ID,
        userId: USER_ID,
        expiresAt: new Date(),
      }),
    });

    const client = await connect(address.port);
    helloMessageSchema.parse(await client.next());
    challengeMessageSchema.parse(await client.next());
    client.socket.send(
      JSON.stringify({ v: 1, id: 'd-auth', type: 'auth', attestation: 'x'.repeat(40) }),
    );
    expect(authOkMessageSchema.parse(await client.next())).toMatchObject({
      deviceId: DEVICE_ID,
      userId: USER_ID,
    });

    // `revoked` from the cloud: the frozen local protocol has no "unpaired" frame, so the honest
    // signal is a policy close — the dashboard resets its handshake and reconnects unpaired.
    server.notifyUnpaired();
    await expect(client.closed).resolves.toEqual({ code: 1008, reason: 'UNPAIRED' });
  });

  it('also closes a still-unauthenticated socket on unpair', async () => {
    const binding: { deviceId: string; userId: string } | null = null;
    const { server, address } = await startLink({
      getPairing: () => binding,
      getSnapshot: () => ({ ...SNAPSHOT, paired: binding !== null }),
    });

    const client = await connect(address.port);
    expect(helloMessageSchema.parse(await client.next()).paired).toBe(false);

    server.notifyUnpaired();
    await expect(client.closed).resolves.toEqual({ code: 1008, reason: 'UNPAIRED' });
  });

  it('policy-closes an authenticated socket when the pairing changed (re-attestation)', async () => {
    let binding = { deviceId: DEVICE_ID, userId: USER_ID };
    const { server, address } = await startLink({
      getPairing: () => binding,
      getSnapshot: () => ({ ...SNAPSHOT, paired: true }),
      verifyAttestation: async () => ({
        ok: true,
        deviceId: DEVICE_ID,
        userId: USER_ID,
        expiresAt: new Date(),
      }),
    });

    const client = await connect(address.port);
    helloMessageSchema.parse(await client.next());
    challengeMessageSchema.parse(await client.next());
    client.socket.send(
      JSON.stringify({ v: 1, id: 'd-auth', type: 'auth', attestation: 'x'.repeat(40) }),
    );
    expect(authOkMessageSchema.parse(await client.next()).type).toBe('authOk');

    // Re-pair to a different device/account while the dashboard is still attached: the old
    // attestation is stale authority, so the socket must re-handshake (T-080).
    binding = { deviceId: '507f1f77bcf86cd799439099', userId: USER_ID };
    server.refreshPairing();
    await expect(client.closed).resolves.toEqual({ code: 1008, reason: 'PAIRING_CHANGED' });
  });

  it('refuses control on a stale attested socket even before refreshPairing runs', async () => {
    let binding = { deviceId: DEVICE_ID, userId: USER_ID };
    const { address } = await startLink({
      getPairing: () => binding,
      getSnapshot: () => ({ ...SNAPSHOT, paired: true }),
      verifyAttestation: async () => ({
        ok: true,
        deviceId: DEVICE_ID,
        userId: USER_ID,
        expiresAt: new Date(),
      }),
    });

    const client = await connect(address.port);
    helloMessageSchema.parse(await client.next());
    challengeMessageSchema.parse(await client.next());
    client.socket.send(
      JSON.stringify({ v: 1, id: 'd-auth', type: 'auth', attestation: 'x'.repeat(40) }),
    );
    expect(authOkMessageSchema.parse(await client.next()).type).toBe('authOk');

    binding = { deviceId: '507f1f77bcf86cd799439099', userId: USER_ID };
    client.socket.send(
      JSON.stringify({
        v: 1,
        id: 'd-enter',
        type: 'enterFocus',
        durationMin: 25,
        allowList: [],
        consent: { acceptedAt: '2026-11-10T10:00:00.000Z', version: 'consent-v1' },
        clientSessionId: SESSION_ID,
      }),
    );
    const rejection = focusRejectedMessageSchema.parse(await client.next());
    expect(rejection.code).toBe('UNAUTHENTICATED');
    await expect(client.closed).resolves.toEqual({ code: 1008, reason: 'STALE_ATTESTATION' });
  });
});
