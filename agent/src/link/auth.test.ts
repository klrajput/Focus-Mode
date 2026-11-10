// link/auth.test.ts — the attested local handshake and control gating (T-044, REC-003, SEC-7).
// A real `ws` client drives the real `LinkServer`; only the attestation key transport is replaced
// (the Ed25519 key pair and signatures are real). Before `authOk` the socket may only `auth`,
// `getState` and `paired`; control messages are refused and the controller is never reached.

import { generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authErrorMessageSchema,
  authOkMessageSchema,
  challengeMessageSchema,
  focusRejectedMessageSchema,
  helloMessageSchema,
  stateMessageSchema,
} from '@focus-mode/shared';
import { WebSocket } from 'ws';
import { verifyAttestationJwt } from './attestation.js';
import { buildState } from './messages.js';
import { LINK_PATH, LinkServer, type LinkAddress, type LinkServerOptions } from './server.js';

const ORIGIN = 'http://localhost:5173';
const DEVICE_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';
const OTHER_ID = '507f1f77bcf86cd799439099';
const CLIENT_SESSION_ID = '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f';

// Real Ed25519 keys: the verifier trusts this public half, every signature is real.
const trusted = generateKeyPairSync('ed25519');
const trustedPublicKeyPem = trusted.publicKey.export({ type: 'spki', format: 'pem' }).toString();

const servers: LinkServer[] = [];
const sockets: WebSocket[] = [];

function signJwt(options: {
  readonly nonce: string;
  readonly aud?: string;
  readonly sub?: string;
  readonly exp?: number;
  readonly key?: typeof trusted.privateKey;
}): string {
  const header = { alg: 'EdDSA', typ: 'JWT' };
  const payload = {
    aud: options.aud ?? DEVICE_ID,
    sub: options.sub ?? USER_ID,
    nonce: options.nonce,
    exp: options.exp ?? Math.floor(Date.now() / 1000) + 60,
    iat: Math.floor(Date.now() / 1000),
  };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signBytes(
    null,
    Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
    options.key ?? trusted.privateKey,
  );
  return `${encodedHeader}.${encodedPayload}.${signature.toString('base64url')}`;
}

const verifyWithTrustedKey: NonNullable<LinkServerOptions['verifyAttestation']> = async (request) =>
  verifyAttestationJwt({
    token: request.token,
    publicKeyPem: trustedPublicKeyPem,
    expected: { nonce: request.nonce, deviceId: DEVICE_ID, userId: USER_ID },
    now: new Date(),
  });

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
    getSnapshot: () => ({ state: 'PAIRED', paired: true, protected: [], allowList: [] }),
    getPairing: () => ({ deviceId: DEVICE_ID, userId: USER_ID }),
    verifyAttestation: verifyWithTrustedKey,
    ...overrides,
  });
  const address = await server.start();
  servers.push(server);
  return { server, address };
}

interface TestClient {
  readonly socket: WebSocket;
  next(): Promise<unknown>;
  readonly closed: Promise<{ code: number; reason: string }>;
  readonly frames: unknown[];
  send(message: unknown): void;
}

function connect(port: number): Promise<TestClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${LINK_PATH}`, ['focus.v1'], {
    origin: ORIGIN,
  });
  sockets.push(socket);

  const queue: unknown[] = [];
  const frames: unknown[] = [];
  const waiters: Array<(message: unknown) => void> = [];
  socket.on('message', (data) => {
    const message: unknown = JSON.parse(data.toString());
    frames.push(message);
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
        frames,
        closed,
        send: (message: unknown) => socket.send(JSON.stringify(message)),
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

async function connectAndChallenge(port: number): Promise<{
  client: TestClient;
  nonce: string;
}> {
  const client = await connect(port);
  const hello = helloMessageSchema.parse(await client.next());
  expect(hello.paired).toBe(true);
  const challenge = challengeMessageSchema.parse(await client.next());
  return { client, nonce: challenge.nonce };
}

afterEach(async () => {
  while (sockets.length > 0) {
    const socket = sockets.pop();
    if (socket !== undefined) socket.terminate();
  }
  while (servers.length > 0) {
    const server = servers.pop();
    if (server !== undefined) await server.stop();
  }
});

describe('handshake (contract §4.4)', () => {
  it('issues a single-use URL-safe challenge when paired', async () => {
    const { address } = await startLink();
    const { nonce } = await connectAndChallenge(address.port);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });

  it('does not issue a challenge while unpaired and refuses auth', async () => {
    const { address } = await startLink({
      getPairing: () => null,
      getSnapshot: () => ({ state: 'IDLE', paired: false, protected: [], allowList: [] }),
    });
    const client = await connect(address.port);
    const hello = helloMessageSchema.parse(await client.next());
    expect(hello.paired).toBe(false);

    // No challenge: a getState is answered directly (the next frame is `state`).
    client.send({ v: 1, id: 'd-1', type: 'getState' });
    const state = stateMessageSchema.parse(await client.next());
    expect(state.type).toBe('state');

    client.send({ v: 1, id: 'd-2', type: 'auth', attestation: 'x'.repeat(64) });
    const error = authErrorMessageSchema.parse(await client.next());
    expect(error.code).toBe('UNAUTHENTICATED');
    expect(error.message).toMatch(/no challenge/i);
    await expect(client.closed).resolves.toMatchObject({ code: 1008 });
  });

  it('accepts a valid attestation and reports authOk with the bound ids', async () => {
    const { address } = await startLink();
    const { client, nonce } = await connectAndChallenge(address.port);

    client.send({ v: 1, id: 'd-3', type: 'auth', attestation: signJwt({ nonce }) });
    await expect(authOkMessageSchema.parse(await client.next())).toMatchObject({
      type: 'authOk',
      deviceId: DEVICE_ID,
      userId: USER_ID,
    });

    client.send({ v: 1, id: 'd-4', type: 'getState' });
    expect(stateMessageSchema.parse(await client.next()).state).toBe('PAIRED');
  });
});

describe('attestation rejection matrix', () => {
  async function expectAuthFailure(
    token: (nonce: string) => string,
    expected: { code: string; message?: RegExp },
  ): Promise<void> {
    const { address } = await startLink();
    const { client, nonce } = await connectAndChallenge(address.port);
    client.send({ v: 1, id: 'd-x', type: 'auth', attestation: token(nonce) });
    const error = authErrorMessageSchema.parse(await client.next());
    expect(error.code).toBe(expected.code);
    if (expected.message !== undefined) expect(error.message).toMatch(expected.message);
    await expect(client.closed).resolves.toMatchObject({ code: 1008 });
  }

  it('rejects a token for a different nonce', async () => {
    await expectAuthFailure(() => signJwt({ nonce: 'aCompletelyDifferentNonce1234' }), {
      code: 'UNAUTHENTICATED',
      message: /challenge/i,
    });
  });

  it('rejects a token issued for another device', async () => {
    await expectAuthFailure((nonce) => signJwt({ nonce, aud: OTHER_ID }), {
      code: 'UNAUTHENTICATED',
      message: /device/i,
    });
  });

  it('rejects a correctly signed token for another account with FORBIDDEN', async () => {
    await expectAuthFailure((nonce) => signJwt({ nonce, sub: OTHER_ID }), {
      code: 'FORBIDDEN',
      message: /account/i,
    });
  });

  it('rejects an expired token', async () => {
    await expectAuthFailure((nonce) => signJwt({ nonce, exp: Math.floor(Date.now() / 1000) - 5 }), {
      code: 'UNAUTHENTICATED',
      message: /expired/i,
    });
  });

  it('rejects a token signed by an unknown key', async () => {
    await expectAuthFailure(
      (nonce) => signJwt({ nonce, key: generateKeyPairSync('ed25519').privateKey }),
      { code: 'UNAUTHENTICATED', message: /signature/i },
    );
  });

  it('rejects an unsigned/garbage attestation', async () => {
    await expectAuthFailure(() => 'x'.repeat(64), {
      code: 'UNAUTHENTICATED',
      message: /compact JWT/i,
    });
  });

  it('rejects a replayed token: the nonce was issued to another socket', async () => {
    const { address } = await startLink();
    const first = await connectAndChallenge(address.port);
    const token = signJwt({ nonce: first.nonce });
    first.client.send({ v: 1, id: 'd-a', type: 'auth', attestation: token });
    expect(authOkMessageSchema.parse(await first.client.next()).type).toBe('authOk');

    // Same attestation, new challenge → the nonce no longer matches (single use).
    const second = await connectAndChallenge(address.port);
    second.client.send({ v: 1, id: 'd-b', type: 'auth', attestation: token });
    const error = authErrorMessageSchema.parse(await second.client.next());
    expect(error.code).toBe('UNAUTHENTICATED');
    await expect(second.client.closed).resolves.toMatchObject({ code: 1008 });
  });

  it('rejects a second auth frame on an already authenticated socket', async () => {
    const { address } = await startLink();
    const { client, nonce } = await connectAndChallenge(address.port);
    const token = signJwt({ nonce });
    client.send({ v: 1, id: 'd-c', type: 'auth', attestation: token });
    expect(authOkMessageSchema.parse(await client.next()).type).toBe('authOk');

    client.send({ v: 1, id: 'd-d', type: 'auth', attestation: token });
    const error = authErrorMessageSchema.parse(await client.next());
    expect(error.code).toBe('UNAUTHENTICATED');
    await expect(client.closed).resolves.toMatchObject({ code: 1008 });
  });
});

describe('control gating (REC-003, NFR-010)', () => {
  it('refuses enterFocus/exitFocus/listApps before auth without reaching the controller', async () => {
    const { address } = await startLink();
    for (const message of [
      {
        v: 1,
        id: 'd-e1',
        type: 'enterFocus',
        durationMin: 25,
        allowList: [],
        consent: { acceptedAt: '2026-11-10T10:00:00.000Z', version: 'consent-v1' },
        clientSessionId: CLIENT_SESSION_ID,
      },
      { v: 1, id: 'd-e2', type: 'exitFocus', sessionId: CLIENT_SESSION_ID },
      { v: 1, id: 'd-e3', type: 'listApps' },
    ]) {
      const { client } = await connectAndChallenge(address.port);
      client.send(message);
      const rejection = focusRejectedMessageSchema.parse(await client.next());
      expect(rejection.code).toBe('UNAUTHENTICATED');
      // No focusStarted/focusEnded/apps frame ever follows: the controller is never touched.
      expect(client.frames.map((frame) => (frame as { type: string }).type)).not.toContain(
        'focusStarted',
      );
      await expect(client.closed).resolves.toMatchObject({ code: 1008 });
    }
  });

  it('answers authenticated control messages with a controlled rejection (no fake session)', async () => {
    const { address } = await startLink();
    const { client, nonce } = await connectAndChallenge(address.port);
    client.send({ v: 1, id: 'd-f1', type: 'auth', attestation: signJwt({ nonce }) });
    expect(authOkMessageSchema.parse(await client.next()).type).toBe('authOk');

    client.send({
      v: 1,
      id: 'd-f2',
      type: 'enterFocus',
      durationMin: 25,
      allowList: [],
      consent: { acceptedAt: '2026-11-10T10:00:00.000Z', version: 'consent-v1' },
      clientSessionId: CLIENT_SESSION_ID,
    });
    const rejection = focusRejectedMessageSchema.parse(await client.next());
    expect(rejection.code).toBe('INVALID');
    expect(rejection.message).toMatch(/not enabled/i);
    expect(client.frames.map((frame) => (frame as { type: string }).type)).not.toContain(
      'focusStarted',
    );
  });

  it('never puts the pairing code, digest, enroll secret or device token on the local wire', async () => {
    const { address } = await startLink();
    const { client, nonce } = await connectAndChallenge(address.port);
    client.send({ v: 1, id: 'd-g1', type: 'auth', attestation: signJwt({ nonce }) });
    expect(authOkMessageSchema.parse(await client.next()).type).toBe('authOk');
    client.send({ v: 1, id: 'd-g2', type: 'getState' });
    await client.next();

    for (const frame of client.frames) {
      const serialized = JSON.stringify(frame);
      expect(serialized).not.toMatch(/pairingCode|codeHmac|enrollSecret|deviceToken/);
      // No message carries a bare six-digit pairing code (DEC-003).
      expect(serialized).not.toMatch(/"\d{6}"/);
      expect(Object.keys(frame as Record<string, unknown>)).not.toContain('code');
    }
  });

  it('refreshes already-connected sockets with a hello + challenge once the agent pairs', async () => {
    let binding: { deviceId: string; userId: string } | null = null;
    const { address, server } = await startLink({
      getPairing: () => binding,
      getSnapshot: () => ({
        state: binding === null ? 'IDLE' : 'PAIRED',
        paired: binding !== null,
        protected: [],
        allowList: [],
      }),
    });
    const client = await connect(address.port);
    const hello = helloMessageSchema.parse(await client.next());
    expect(hello.paired).toBe(false);

    binding = { deviceId: DEVICE_ID, userId: USER_ID };
    server.refreshPairing();

    // KI-010 agent half: the dashboard must learn that the pairing changed without a page reload,
    // so a fresh `hello {paired:true}` precedes the new single-use nonce.
    const refreshed = helloMessageSchema.parse(await client.next());
    expect(refreshed.paired).toBe(true);
    expect(refreshed.state).toBe('PAIRED');
    const challenge = challengeMessageSchema.parse(await client.next());
    expect(challenge.nonce).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });

  it('issues a fresh challenge per handshake and refuses the old nonce after reconnect', async () => {
    const { address } = await startLink();
    const first = await connectAndChallenge(address.port);
    const oldToken = signJwt({ nonce: first.nonce });
    first.client.socket.close();
    await first.client.closed;

    // A reconnect is a brand-new handshake: new single-use nonce, never a reuse of the old one.
    const second = await connectAndChallenge(address.port);
    expect(second.nonce).not.toBe(first.nonce);

    second.client.send({ v: 1, id: 'd-replay', type: 'auth', attestation: oldToken });
    const error = authErrorMessageSchema.parse(await second.client.next());
    expect(error.code).toBe('UNAUTHENTICATED');
    expect(error.message).toMatch(/challenge/i);
    await expect(second.client.closed).resolves.toMatchObject({ code: 1008 });
  });

  it('rejects duplicate concurrent auth attempts on the same challenge', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verify = vi.fn(async () => {
      await gate;
      return {
        ok: true as const,
        deviceId: DEVICE_ID,
        userId: USER_ID,
        expiresAt: new Date(),
      };
    });
    const { address } = await startLink({ verifyAttestation: verify });
    const { client, nonce } = await connectAndChallenge(address.port);
    const auth = { v: 1, id: 'd-dup', type: 'auth', attestation: signJwt({ nonce }) };

    // Two auth frames before the first verification resolves: one challenge → one attempt.
    client.send(auth);
    client.send({ ...auth, id: 'd-dup-2' });
    const error = authErrorMessageSchema.parse(await client.next());
    expect(error.code).toBe('UNAUTHENTICATED');
    expect(error.message).toMatch(/already being verified/i);
    await expect(client.closed).resolves.toMatchObject({ code: 1008 });

    release?.();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      client.frames.filter((frame) => (frame as { type: string }).type === 'authOk'),
    ).toHaveLength(0);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('refuses control while an attestation is still being verified', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const verify = async (): Promise<Awaited<ReturnType<typeof verifyWithTrustedKey>>> => {
      await gate;
      return {
        ok: true,
        deviceId: DEVICE_ID,
        userId: USER_ID,
        expiresAt: new Date(),
      };
    };
    const { address } = await startLink({ verifyAttestation: verify });
    const { client, nonce } = await connectAndChallenge(address.port);

    client.send({ v: 1, id: 'd-a', type: 'auth', attestation: signJwt({ nonce }) });
    client.send({
      v: 1,
      id: 'd-control',
      type: 'enterFocus',
      durationMin: 25,
      allowList: [],
      consent: { acceptedAt: '2026-11-10T10:00:00.000Z', version: 'consent-v1' },
      clientSessionId: CLIENT_SESSION_ID,
    });

    // No authOk was sent yet, so control is still unavailable; the socket is closed, never used.
    const rejection = focusRejectedMessageSchema.parse(await client.next());
    expect(rejection.code).toBe('UNAUTHENTICATED');
    await expect(client.closed).resolves.toMatchObject({ code: 1008 });

    release?.();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      client.frames.filter((frame) => (frame as { type: string }).type === 'authOk'),
    ).toHaveLength(0);
  });

  it('drops a successful verification when the pairing changed while it ran', async () => {
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let binding: { deviceId: string; userId: string } | null = {
      deviceId: DEVICE_ID,
      userId: USER_ID,
    };
    const { address, server } = await startLink({
      getPairing: () => binding,
      getSnapshot: () => ({ state: 'PAIRED', paired: true, protected: [], allowList: [] }),
      verifyAttestation: async () => {
        markStarted?.();
        await gate;
        return {
          ok: true,
          deviceId: DEVICE_ID,
          userId: USER_ID,
          expiresAt: new Date(),
        };
      },
    });
    const { client, nonce } = await connectAndChallenge(address.port);
    client.send({ v: 1, id: 'd-a', type: 'auth', attestation: signJwt({ nonce }) });
    await started;

    // Re-pair to another device while the verifier is awaiting the key: refreshPairing skips the
    // in-flight socket, but the post-verification binding re-check must still reject it.
    binding = { deviceId: OTHER_ID, userId: USER_ID };
    server.refreshPairing();
    expect(client.socket.readyState).toBe(WebSocket.OPEN);

    release?.();
    const error = authErrorMessageSchema.parse(await client.next());
    expect(error.code).toBe('UNAUTHENTICATED');
    expect(error.message).toMatch(/pairing changed/i);
    await expect(client.closed).resolves.toEqual({ code: 1008, reason: 'PAIRING_CHANGED' });
  });

  it('drops a slow control reply when the dashboard socket closed meanwhile (T-080)', async () => {
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const onMessageHandled = vi.fn();
    const { address, server } = await startLink({
      controlHandlers: {
        enterFocus: async () => [],
        exitFocus: async () => [],
        listApps: async () => {
          markStarted?.();
          await gate;
          return [];
        },
        getState: () => buildState({ state: 'PAIRED', protected: [], allowList: [] }),
      },
      onMessageHandled,
    });
    const { client, nonce } = await connectAndChallenge(address.port);
    client.send({ v: 1, id: 'd-a', type: 'auth', attestation: signJwt({ nonce }) });
    expect(authOkMessageSchema.parse(await client.next()).type).toBe('authOk');

    client.send({ v: 1, id: 'd-list', type: 'listApps' });
    await started;
    client.socket.terminate();
    await client.closed;
    // Wait until the SERVER has observed the close, otherwise a reply could legitimately race it.
    const deadline = Date.now() + 500;
    while (server.connectedClients > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(server.connectedClients).toBe(0);

    // The handler finishes after the socket is gone: its reply must be dropped, not written to a
    // closed socket and not reported as handled.
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onMessageHandled).not.toHaveBeenCalledWith('listApps');
    expect(
      client.frames.filter((frame) => (frame as { type: string }).type === 'apps'),
    ).toHaveLength(0);
  });
});
