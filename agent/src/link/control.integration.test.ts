// link/control.integration.test.ts — real end-to-end control over the real local channel
// (W3 gate: start→end on the FakeDriver). A real `ws` client performs the real Ed25519 attested
// handshake against the real LinkServer; the only fake pieces are the OS windows (FakeDriver) and
// the native consent answer. Proves FR-005/006/024 semantics, the broadcast fan-out for a second
// dashboard (FR-004) and crash recovery restoring BEFORE the agent reports state (FR-023).

import { generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  authOkMessageSchema,
  challengeMessageSchema,
  focusEndedMessageSchema,
  focusRejectedMessageSchema,
  focusStartedMessageSchema,
  helloMessageSchema,
  stateMessageSchema,
  type EnterFocusMessage,
} from '@focus-mode/shared';
import { WebSocket } from 'ws';
import { verifyAttestationJwt } from './attestation.js';
import { LINK_PATH, LinkServer, type LinkAddress, type LinkServerOptions } from './server.js';
import { FocusLinkHandlers } from './handlers.js';
import { ConsentGate, FileConsentStore } from '../focus/consent.js';
import { FocusController, type FocusLifecycleEvent } from '../focus/controller.js';
import { FakeDriver, type FakeWindowSpec } from '../focus/drivers/fake.js';
import { FileJournal, type JournalEntry } from '../focus/journal.js';
import { buildFocusEnded, buildFocusStarted } from './messages.js';
import { resolveProtectedEntries } from '../allowlist.js';
import { START, cleanupHarnessDirs, makeDirectory } from '../focus/controller.harness.js';

const ORIGIN = 'http://localhost:5173';
const DEVICE_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';
const SESSION_ID = '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f';
const PROTECTED = resolveProtectedEntries('macOS');
const WINDOWS: readonly FakeWindowSpec[] = [
  { handle: 'w-chrome', appKey: 'chrome', identifier: 'com.google.Chrome' },
  { handle: 'w-vscode', appKey: 'vscode', identifier: 'com.microsoft.VSCode' },
  { handle: 'w-slack', appKey: 'slack', identifier: 'com.tinyspeck.slackmacgap' },
];

const trusted = generateKeyPairSync('ed25519');
const trustedPublicKeyPem = trusted.publicKey.export({ type: 'spki', format: 'pem' }).toString();

function signJwt(nonce: string): string {
  const header = { alg: 'EdDSA', typ: 'JWT' };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = { aud: DEVICE_ID, sub: USER_ID, nonce, iat: nowSeconds, exp: nowSeconds + 60 };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signBytes(
    null,
    Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8'),
    trusted.privateKey,
  );
  return `${encodedHeader}.${encodedPayload}.${signature.toString('base64url')}`;
}

const servers: LinkServer[] = [];
const sockets: WebSocket[] = [];
const controllers: FocusController[] = [];

interface TestClient {
  readonly socket: WebSocket;
  next(): Promise<unknown>;
  send(message: unknown): void;
  readonly closed: Promise<{ code: number; reason: string }>;
}

function connect(port: number): Promise<TestClient> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${LINK_PATH}`, ['focus.v1'], {
    origin: ORIGIN,
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

async function authenticatedClient(port: number): Promise<TestClient> {
  const client = await connect(port);
  const hello = helloMessageSchema.parse(await client.next());
  expect(hello.paired).toBe(true);
  const challenge = challengeMessageSchema.parse(await client.next());
  client.send({ v: 1, id: 'd-auth', type: 'auth', attestation: signJwt(challenge.nonce) });
  expect(authOkMessageSchema.parse(await client.next()).type).toBe('authOk');
  return client;
}

interface IntegrationHarness {
  readonly controller: FocusController;
  readonly driver: FakeDriver;
  readonly journal: FileJournal;
  readonly events: FocusLifecycleEvent[];
  start(options?: { readonly recoverFirst?: boolean }): Promise<LinkAddress>;
  /** Simulates a process kill: no exitFocus, no journal clear, link and timers gone (T-080). */
  crash(): Promise<void>;
}

interface SharedHarnessState {
  readonly driver?: FakeDriver;
  readonly journal?: FileJournal;
}

async function makeIntegrationHarness(
  shared: SharedHarnessState = {},
): Promise<IntegrationHarness> {
  const driver = shared.driver ?? new FakeDriver(WINDOWS);
  const journal = shared.journal ?? new FileJournal({ directory: makeDirectory() });
  const events: FocusLifecycleEvent[] = [];
  const link: { server?: LinkServer } = {};

  const controller = new FocusController({
    driver,
    journal,
    protectedEntries: PROTECTED,
    os: 'macOS',
    consent: new ConsentGate({
      store: new FileConsentStore({ directory: makeDirectory() }),
      prompt: async () => true,
      now: () => START,
    }),
    initialPaired: true,
    // Keep the integration run deterministic: the enforcement loop has its own suite.
    enforcement: false,
    now: () => new Date(),
    onEvent: (event) => {
      events.push(event);
      if (event.type === 'focusStarted') {
        link.server?.broadcast(buildFocusStarted(event, PROTECTED));
      } else {
        link.server?.broadcast(buildFocusEnded(event));
      }
    },
  });
  controllers.push(controller);

  const options: LinkServerOptions = {
    port: 0,
    allowedOrigins: [ORIGIN],
    identity: {
      agentId: 'agent-integration',
      agentVersion: '1.0.0',
      os: 'macOS',
      capabilities: controller.capabilities(),
    },
    getSnapshot: () => {
      const snapshot = controller.getState();
      return {
        state: snapshot.state,
        paired: true,
        ...(snapshot.session === undefined ? {} : { session: snapshot.session }),
        protected: snapshot.protected,
        allowList: snapshot.allowList,
      };
    },
    getPairing: () => ({ deviceId: DEVICE_ID, userId: USER_ID }),
    verifyAttestation: async (request) =>
      verifyAttestationJwt({
        token: request.token,
        publicKeyPem: trustedPublicKeyPem,
        expected: { nonce: request.nonce, deviceId: DEVICE_ID, userId: USER_ID },
        now: new Date(),
      }),
    controlHandlers: new FocusLinkHandlers({ controller }),
  };
  const server = new LinkServer(options);
  link.server = server;
  servers.push(server);

  return {
    controller,
    driver,
    journal,
    events,
    start: async (startOptions = {}) => {
      if (startOptions.recoverFirst === true) await controller.recoverFromJournal();
      return server.start();
    },
    crash: async () => {
      // A real crash leaves the journal and the moved windows behind. Remove this harness from
      // the cleanup lists so afterEach does not restore them for us.
      const controllerIndex = controllers.indexOf(controller);
      if (controllerIndex >= 0) controllers.splice(controllerIndex, 1);
      const serverIndex = servers.indexOf(server);
      if (serverIndex >= 0) servers.splice(serverIndex, 1);
      controller.dispose();
      await server.stop();
    },
  };
}

function enterFocusMessage(overrides: Partial<EnterFocusMessage> = {}): EnterFocusMessage {
  return {
    v: 1,
    id: 'd-enter',
    type: 'enterFocus',
    durationMin: 25,
    allowList: [{ key: 'vscode', label: 'Visual Studio Code', mac: ['com.microsoft.VSCode'] }],
    reaside: false,
    consent: { acceptedAt: START.toISOString(), version: 'consent-v1' },
    clientSessionId: SESSION_ID,
    ...overrides,
  };
}

afterEach(async () => {
  while (sockets.length > 0) sockets.pop()?.terminate();
  for (const controller of controllers.splice(0)) {
    await controller.exitFocus('QUIT').catch(() => undefined);
    controller.dispose();
  }
  while (servers.length > 0) await servers.pop()?.stop();
  cleanupHarnessDirs();
});

describe('authenticated focus control over the real link', () => {
  it('starts and ends a session on the FakeDriver (FR-005/FR-006)', async () => {
    const harness = await makeIntegrationHarness();
    const { port } = await harness.start();
    const client = await authenticatedClient(port);

    client.send(enterFocusMessage());
    const started = focusStartedMessageSchema.parse(await client.next());
    expect(started).toMatchObject({
      type: 'focusStarted',
      state: 'FOCUSING',
      sessionId: SESSION_ID,
      source: 'MANUAL',
    });
    expect(started.protected.map((entry) => entry.key)).toContain('chrome');
    expect(harness.driver.isAsided('w-slack')).toBe(true);
    expect(harness.driver.isAsided('w-chrome')).toBe(false);

    client.send({ v: 1, id: 'd-state', type: 'getState' });
    const state = stateMessageSchema.parse(await client.next());
    expect(state.state).toBe('FOCUSING');
    expect(state.session?.sessionId).toBe(SESSION_ID);
    expect(state.session?.plannedMinutes).toBe(25);

    client.send({ v: 1, id: 'd-exit', type: 'exitFocus', sessionId: SESSION_ID });
    const ended = focusEndedMessageSchema.parse(await client.next());
    expect(ended).toMatchObject({ type: 'focusEnded', sessionId: SESSION_ID, reason: 'USER' });
    expect(harness.controller.getState().state).toBe('PAIRED');
    expect(harness.driver.asidedHandles()).toEqual([]);
    expect(harness.journal.read()).toBeNull();
  });

  it('rejects a second enterFocus with ALREADY_FOCUSING over the wire (FR-024)', async () => {
    const harness = await makeIntegrationHarness();
    const { port } = await harness.start();
    const client = await authenticatedClient(port);

    client.send(enterFocusMessage());
    focusStartedMessageSchema.parse(await client.next());

    client.send(enterFocusMessage({ id: 'd-enter-2', clientSessionId: crypto.randomUUID() }));
    const rejection = focusRejectedMessageSchema.parse(await client.next());
    expect(rejection.code).toBe('ALREADY_FOCUSING');
    expect(harness.controller.getState().state).toBe('FOCUSING');
  });

  it('broadcasts lifecycle frames to every authenticated dashboard (FR-004)', async () => {
    const harness = await makeIntegrationHarness();
    const { port } = await harness.start();
    const first = await authenticatedClient(port);
    const second = await authenticatedClient(port);

    first.send(enterFocusMessage());
    const startedFirst = focusStartedMessageSchema.parse(await first.next());
    const startedSecond = focusStartedMessageSchema.parse(await second.next());
    expect(startedFirst.sessionId).toBe(SESSION_ID);
    expect(startedSecond.sessionId).toBe(SESSION_ID);

    // The second dashboard ends the session: the first one still learns about it.
    second.send({ v: 1, id: 'd-exit', type: 'exitFocus', sessionId: SESSION_ID });
    expect(focusEndedMessageSchema.parse(await first.next()).reason).toBe('USER');
    expect(focusEndedMessageSchema.parse(await second.next()).reason).toBe('USER');
  });

  it('restores from the journal BEFORE serving hello after a crash (FR-023)', async () => {
    const harness = await makeIntegrationHarness();
    const entry: JournalEntry = {
      version: 1,
      kind: 'FOCUS_SESSION',
      sessionId: SESSION_ID,
      startedAt: new Date(START.getTime() - 10 * 60_000).toISOString(),
      endsAt: new Date(START.getTime() + 15 * 60_000).toISOString(),
      plannedMinutes: 25,
      source: 'MANUAL',
      intent: 'FOCUSING',
      protected: PROTECTED.map((protectedEntry) => ({ ...protectedEntry })),
      allowList: [],
      candidates: [{ handle: 'w-slack', appKey: 'slack' }],
      changed: [{ handle: 'w-slack', appKey: 'slack' }],
    };
    harness.journal.write(entry);
    await harness.driver.asideWindows([{ handle: 'w-slack', appKey: 'slack' }]);
    harness.driver.resetCallLog();

    const { port } = await harness.start({ recoverFirst: true });
    expect(harness.events[0]).toMatchObject({
      type: 'focusEnded',
      reason: 'CRASH_RECOVERY',
      sessionId: SESSION_ID,
    });
    expect(harness.driver.asidedHandles()).toEqual([]);
    expect(harness.journal.read()).toBeNull();

    const client = await connect(port);
    const hello = helloMessageSchema.parse(await client.next());
    expect(hello.state).toBe('PAIRED');
    expect(hello.paired).toBe(true);
    // A paired agent always offers a challenge first; consume it before expecting `state`.
    challengeMessageSchema.parse(await client.next());
    client.send({ v: 1, id: 'd-state', type: 'getState' });
    const state = stateMessageSchema.parse(await client.next());
    expect(state.state).toBe('PAIRED');
    expect(state.session).toBeUndefined();
  });

  it('answers a stale exitFocus over the wire without ending the running session', async () => {
    const harness = await makeIntegrationHarness();
    const { port } = await harness.start();
    const client = await authenticatedClient(port);

    client.send(enterFocusMessage());
    focusStartedMessageSchema.parse(await client.next());
    client.send({ v: 1, id: 'd-exit', type: 'exitFocus', sessionId: crypto.randomUUID() });

    const state = stateMessageSchema.parse(await client.next());
    expect(state.state).toBe('FOCUSING');
    expect(harness.controller.getState().state).toBe('FOCUSING');
  });

  it('keeps focus applied when the dashboard socket dies mid-session, then re-attests on reconnect (T-080)', async () => {
    const harness = await makeIntegrationHarness();
    const { port } = await harness.start();
    const first = await authenticatedClient(port);

    first.send(enterFocusMessage());
    focusStartedMessageSchema.parse(await first.next());
    const asided = harness.driver.asidedHandles().slice();

    // The tab closes / the laptop loses the socket mid-focus. That must NOT end the session: the
    // controller, journal and OS state are agent-owned (INV-1/INV-4).
    first.socket.terminate();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(harness.controller.getState().state).toBe('FOCUSING');
    expect(harness.journal.read()?.sessionId).toBe(SESSION_ID);
    expect(harness.driver.asidedHandles()).toEqual(asided);

    // Reconnect: a brand-new handshake, a fresh nonce and fresh auth. State is the agent truth.
    const second = await authenticatedClient(port);
    second.send({ v: 1, id: 'd-state', type: 'getState' });
    const state = stateMessageSchema.parse(await second.next());
    expect(state.state).toBe('FOCUSING');
    expect(state.session?.sessionId).toBe(SESSION_ID);

    // The reconnected dashboard can end the session; windows restore exactly once.
    second.send({ v: 1, id: 'd-exit', type: 'exitFocus', sessionId: SESSION_ID });
    expect(focusEndedMessageSchema.parse(await second.next())).toMatchObject({
      type: 'focusEnded',
      sessionId: SESSION_ID,
      reason: 'USER',
    });
    expect(harness.controller.getState().state).toBe('PAIRED');
    expect(harness.driver.asidedHandles()).toEqual([]);
    expect(harness.journal.read()).toBeNull();
  });

  it('recovers an active journal on restart BEFORE the link serves hello/state (T-080)', async () => {
    const first = await makeIntegrationHarness();
    const { port } = await first.start();
    const client = await authenticatedClient(port);
    client.send(enterFocusMessage());
    focusStartedMessageSchema.parse(await client.next());
    expect(first.journal.read()?.sessionId).toBe(SESSION_ID);
    expect(first.driver.asidedHandles().length).toBeGreaterThan(0);

    // Kill the process: no exitFocus, no journal clear, no restore. Only memory disappears.
    await first.crash();

    // New process, same userData journal and same OS windows. Recovery must run before the link.
    const second = await makeIntegrationHarness({
      driver: first.driver,
      journal: first.journal,
    });
    const restarted = await second.start({ recoverFirst: true });
    expect(second.events[0]).toMatchObject({
      type: 'focusEnded',
      reason: 'CRASH_RECOVERY',
      sessionId: SESSION_ID,
    });
    expect(second.driver.asidedHandles()).toEqual([]);
    expect(second.journal.read()).toBeNull();

    // hello/state are truthful after recovery: PAIRED, no phantom FOCUSING session.
    const reconnected = await connect(restarted.port);
    const hello = helloMessageSchema.parse(await reconnected.next());
    expect(hello).toMatchObject({ state: 'PAIRED', paired: true });
    challengeMessageSchema.parse(await reconnected.next());
    reconnected.send({ v: 1, id: 'd-state', type: 'getState' });
    const state = stateMessageSchema.parse(await reconnected.next());
    expect(state.state).toBe('PAIRED');
    expect(state.session).toBeUndefined();

    // And the restarted agent still accepts a fresh authenticated session.
    const fresh = await authenticatedClient(restarted.port);
    fresh.send(enterFocusMessage());
    expect(focusStartedMessageSchema.parse(await fresh.next()).sessionId).toBe(SESSION_ID);
  });
});
