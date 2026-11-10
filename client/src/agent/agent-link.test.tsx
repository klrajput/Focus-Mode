/*
 * AgentLink unit tests (T-045, FR-004/FR-014, REC-003) with a scripted mock WebSocket.
 * Covers: port scan 4545→4549 stopping at the first socket that opens, fail-soft when no Focus
 * Agent is installed, exponential reconnect backoff 0.5→8 s, the full attested handshake
 * (hello → challenge → POST attest → auth → authOk → getState), typed state/focus events and clean
 * teardown. No real socket is opened and no timer is left running.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@focus-mode/shared';
import type { AgentConnectionStatus, LocalMessage } from '@focus-mode/shared';

import { ApiError } from '../api/errors';
import { AgentLink, type LinkSocket, type SocketFactory } from './agent-link';

const DEVICE_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';
const SESSION_ID = '9b2f8a51-1c0e-4b6a-8f03-5d7c9e1a2b3c';
const NONCE = 'abcdefghijklmnopqrstuvwxyz012345';
const STARTED_AT = '2026-11-10T10:05:00.000Z';
const ENDS_AT = '2026-11-10T11:05:00.000Z';

class MockSocket implements LinkSocket {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readyState = 0;
  readonly sent: string[] = [];
  readonly url: string;
  readonly protocols: readonly string[];

  constructor(url: string, protocols: readonly string[]) {
    this.url = url;
    this.protocols = protocols;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    const handler = this.onclose;
    this.onclose = null;
    handler?.(new CloseEvent('close'));
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }

  receive(payload: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }

  fail(): void {
    this.readyState = 3;
    this.onerror?.(new Event('error'));
  }

  /** Every frame this socket received, already parsed. */
  frames(): LocalMessage[] {
    return this.sent.map((raw) => JSON.parse(raw) as LocalMessage);
  }
}

function makeFactory(sockets: MockSocket[]): SocketFactory {
  return (url, protocols) => {
    const socket = new MockSocket(url, protocols);
    sockets.push(socket);
    return socket;
  };
}

const HELLO_UNPAIRED = {
  v: 1,
  id: 'a-001',
  type: 'hello',
  agentId: 'agent-1',
  agentVersion: '1.4.0',
  os: 'macOS',
  state: 'IDLE',
  paired: false,
  capabilities: { focus: 'full' },
} as const;

const HELLO_PAIRED = { ...HELLO_UNPAIRED, id: 'a-002', paired: true } as const;

const CHALLENGE = { v: 1, id: 'a-003', type: 'challenge', nonce: NONCE } as const;

const AUTH_OK = {
  v: 1,
  id: 'a-004',
  type: 'authOk',
  deviceId: DEVICE_ID,
  userId: USER_ID,
} as const;

const STATE_FOCUSING = {
  v: 1,
  id: 'a-005',
  type: 'state',
  state: 'FOCUSING',
  session: {
    sessionId: SESSION_ID,
    startedAt: STARTED_AT,
    endsAt: ENDS_AT,
    plannedMinutes: 60,
    source: 'MANUAL',
  },
  protected: [],
  allowList: [],
} as const;

const STATE_PAIRED = {
  v: 1,
  id: 'a-009',
  type: 'state',
  state: 'PAIRED',
  protected: [],
  allowList: [],
} as const;

const FOCUS_ENDED = {
  v: 1,
  id: 'a-006',
  type: 'focusEnded',
  sessionId: SESSION_ID,
  at: ENDS_AT,
  reason: 'USER',
  actualMinutes: 60,
} as const;

const HEADS_UP = {
  v: 1,
  id: 'a-007',
  type: 'scheduleHeadsUp',
  scheduleId: '507f1f77bcf86cd799439013',
  startsAt: '2026-11-11T03:30:00.000Z',
} as const;

function makeLink(
  sockets: MockSocket[],
  overrides: {
    resolveDeviceId?: () => Promise<string | null>;
    attest?: (deviceId: string, nonce: string) => Promise<string>;
    reconnectBaseMs?: number;
    reconnectMaxMs?: number;
    attestRetryBaseMs?: number;
    attestRetryMaxMs?: number;
    attestMaxAttempts?: number;
  } = {},
): AgentLink {
  return new AgentLink({
    socketFactory: makeFactory(sockets),
    resolveDeviceId: overrides.resolveDeviceId ?? (async () => null),
    attest: overrides.attest ?? (async () => 'unused-attestation-value'),
    reconnectBaseMs: overrides.reconnectBaseMs,
    reconnectMaxMs: overrides.reconnectMaxMs,
    attestRetryBaseMs: overrides.attestRetryBaseMs,
    attestRetryMaxMs: overrides.attestRetryMaxMs,
    attestMaxAttempts: overrides.attestMaxAttempts,
  });
}

/** The exact error the API answers while the agent has not opened its cloud link yet. */
function noDeviceConnectedError(): ApiError {
  return new ApiError(
    ERROR_CODES.NO_DEVICE_CONNECTED,
    409,
    'No device connected — start your Focus Agent.',
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AgentLink', () => {
  it('scans 4545→4549 with the focus.v1 subprotocol and stops at the first socket that opens', () => {
    const sockets: MockSocket[] = [];
    const link = makeLink(sockets);
    const statuses: AgentConnectionStatus[] = [];
    link.on('status', (event) => statuses.push(event.status));

    link.connect();

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe('ws://127.0.0.1:4545/link');
    expect(sockets[0]?.protocols).toEqual(['focus.v1']);

    sockets[0]?.fail();
    expect(sockets[1]?.url).toBe('ws://127.0.0.1:4546/link');

    sockets[1]?.fail();
    expect(sockets[2]?.url).toBe('ws://127.0.0.1:4547/link');

    sockets[2]?.open();
    expect(sockets).toHaveLength(3);

    sockets[2]?.receive(HELLO_UNPAIRED);
    expect(statuses.at(-1)).toBe('IDLE');
    expect(sockets[2]?.frames().some((frame) => frame.type === 'getState')).toBe(true);

    link.dispose();
    expect(sockets[2]?.readyState).toBe(3);
  });

  it('fails soft after all five ports with no agent and never throws', () => {
    vi.useFakeTimers();
    const sockets: MockSocket[] = [];
    const link = makeLink(sockets);
    const connectFailed = vi.fn();
    link.on('connectFailed', connectFailed);
    const statuses: AgentConnectionStatus[] = [];
    link.on('status', (event) => statuses.push(event.status));

    expect(() => link.connect()).not.toThrow();

    for (let port = 0; port < 5; port += 1) {
      sockets.at(-1)?.fail();
    }

    expect(sockets).toHaveLength(5);
    expect(connectFailed).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('DISCONNECTED');

    link.dispose();
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
    expect(sockets).toHaveLength(5);
  });

  it('reconnects with exponential backoff 0.5 s → 8 s after a failed scan', () => {
    vi.useFakeTimers();
    const sockets: MockSocket[] = [];
    const link = makeLink(sockets);

    link.connect();
    for (let port = 0; port < 5; port += 1) sockets.at(-1)?.fail();
    expect(sockets).toHaveLength(5);

    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(5);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(6);

    for (let port = 0; port < 5; port += 1) sockets.at(-1)?.fail();
    expect(sockets).toHaveLength(10);

    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(10);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(11);

    link.dispose();
  });

  it('runs the attested handshake and dispatches typed state/focus events', async () => {
    const sockets: MockSocket[] = [];
    const attest = vi.fn(async () => 'header.payload.signature-header-payload-signature');
    const resolveDeviceId = vi.fn(async () => DEVICE_ID);
    const link = makeLink(sockets, { resolveDeviceId, attest });

    const statuses: AgentConnectionStatus[] = [];
    const states: string[] = [];
    const ends: string[] = [];
    link.on('status', (event) => statuses.push(event.status));
    link.on('state', (message) => states.push(message.state));
    link.on('focusEnded', (message) => ends.push(message.reason));

    link.connect();
    sockets[0]?.open();
    sockets[0]?.receive(HELLO_PAIRED);

    expect(resolveDeviceId).not.toHaveBeenCalled();
    sockets[0]?.receive(CHALLENGE);

    await vi.waitFor(() => {
      expect(attest).toHaveBeenCalledWith(DEVICE_ID, NONCE);
    });
    expect(resolveDeviceId).toHaveBeenCalledTimes(1);

    const authFrame = sockets[0]?.frames().find((frame) => frame.type === 'auth');
    expect(authFrame).toMatchObject({
      v: 1,
      type: 'auth',
      attestation: 'header.payload.signature-header-payload-signature',
    });

    sockets[0]?.receive(AUTH_OK);
    expect(statuses.at(-1)).toBe('PAIRED');
    expect(sockets[0]?.frames().some((frame) => frame.type === 'getState')).toBe(true);

    sockets[0]?.receive(STATE_FOCUSING);
    expect(statuses.at(-1)).toBe('FOCUSING');
    expect(states).toEqual(['FOCUSING']);

    sockets[0]?.receive(HEADS_UP);
    sockets[0]?.receive(FOCUS_ENDED);
    expect(ends).toEqual(['USER']);
    expect(statuses.at(-1)).toBe('PAIRED');

    link.dispose();
    expect(sockets[0]?.readyState).toBe(3);
  });

  it('sends the paired nudge and exitFocus through the same validated channel', () => {
    const sockets: MockSocket[] = [];
    const link = makeLink(sockets);
    link.connect();
    sockets[0]?.open();
    sockets[0]?.receive(HELLO_UNPAIRED);

    link.notifyPaired();
    link.endFocus(SESSION_ID);

    const types = sockets[0]?.frames().map((frame) => frame.type) ?? [];
    expect(types).toContain('paired');
    expect(types).toContain('exitFocus');
    expect(types).toContain('getState');

    link.dispose();
  });

  it('accepts a challenge that arrives after an unpaired hello (KI-010 re-handshake)', async () => {
    const sockets: MockSocket[] = [];
    const attest = vi.fn(async () => 'header.payload.signature-header-payload-signature');
    const resolveDeviceId = vi.fn(async () => DEVICE_ID);
    const link = makeLink(sockets, { resolveDeviceId, attest });

    const statuses: AgentConnectionStatus[] = [];
    const authOks = vi.fn();
    link.on('status', (event) => statuses.push(event.status));
    link.on('authOk', authOks);

    link.connect();
    sockets[0]?.open();
    // The dashboard connected while the agent was still unpaired.
    sockets[0]?.receive(HELLO_UNPAIRED);
    expect(statuses.at(-1)).toBe('IDLE');
    expect(attest).not.toHaveBeenCalled();

    // The user paired it (dashboard nudge → agent poll): the agent re-issues a challenge here.
    sockets[0]?.receive(CHALLENGE);
    await vi.waitFor(() => expect(attest).toHaveBeenCalledWith(DEVICE_ID, NONCE));
    expect(sockets[0]?.frames().some((frame) => frame.type === 'auth')).toBe(true);

    sockets[0]?.receive(AUTH_OK);
    await vi.waitFor(() => expect(authOks).toHaveBeenCalledTimes(1));
    // No reload: the same socket now reports Connected, and getState resyncs the truth.
    expect(statuses.at(-1)).toBe('PAIRED');
    expect(link.isAuthenticated()).toBe(true);
    expect(
      sockets[0]?.frames().filter((frame) => frame.type === 'getState').length,
    ).toBeGreaterThan(1);

    // A second challenge on the same socket never starts a second attestation.
    sockets[0]?.receive(CHALLENGE);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(attest).toHaveBeenCalledTimes(1);

    link.dispose();
  });

  /*
   * KI-010 (the remaining part): the agent issues the post-pairing challenge from
   * `cloud.on('paired')`, which runs BEFORE it opens its `/agent-link` WebSocket — so the device is
   * still DISCONNECTED in the API and `POST /devices/:id/attest` answers NO_DEVICE_CONNECTED.
   * The dashboard must retry that transient failure instead of giving up until a page reload.
   */
  it('retries the attestation while the freshly paired device is not CONNECTED yet (KI-010)', async () => {
    const sockets: MockSocket[] = [];
    let attempts = 0;
    const attest = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw noDeviceConnectedError();
      return 'header.payload.signature-header-payload-signature';
    });
    const link = makeLink(sockets, {
      resolveDeviceId: async () => DEVICE_ID,
      attest,
      attestRetryBaseMs: 1,
      attestRetryMaxMs: 2,
    });

    const statuses: AgentConnectionStatus[] = [];
    const errors: string[] = [];
    link.on('status', (event) => statuses.push(event.status));
    link.on('error', (event) => errors.push(event.message));

    link.connect();
    sockets[0]?.open();
    sockets[0]?.receive(HELLO_UNPAIRED);
    expect(statuses.at(-1)).toBe('IDLE');

    // Pairing completed on the dashboard: the agent nudges a challenge on the same socket.
    sockets[0]?.receive(CHALLENGE);

    await vi.waitFor(
      () => {
        expect(sockets[0]?.frames().some((frame) => frame.type === 'auth')).toBe(true);
      },
      { timeout: 2000 },
    );
    expect(attest).toHaveBeenCalledTimes(3);
    expect(errors).toEqual([]);

    sockets[0]?.receive(AUTH_OK);
    sockets[0]?.receive(STATE_PAIRED);
    expect(statuses.at(-1)).toBe('PAIRED');
    expect(link.isAuthenticated()).toBe(true);

    link.dispose();
  });

  it('does not retry an attestation the API rejects permanently', async () => {
    const sockets: MockSocket[] = [];
    const attest = vi.fn(async () => {
      throw new ApiError(ERROR_CODES.FORBIDDEN, 403, 'Forbidden');
    });
    const link = makeLink(sockets, {
      resolveDeviceId: async () => DEVICE_ID,
      attest,
      attestRetryBaseMs: 1,
      attestRetryMaxMs: 2,
    });

    const statuses: AgentConnectionStatus[] = [];
    const errors: string[] = [];
    link.on('status', (event) => statuses.push(event.status));
    link.on('error', (event) => errors.push(event.message));

    link.connect();
    sockets[0]?.open();
    sockets[0]?.receive(HELLO_PAIRED);
    sockets[0]?.receive(CHALLENGE);

    await vi.waitFor(() => expect(statuses.at(-1)).toBe('IDLE'), { timeout: 2000 });
    expect(attest).toHaveBeenCalledTimes(1);
    expect(sockets[0]?.frames().some((frame) => frame.type === 'auth')).toBe(false);
    expect(errors).toContain('The dashboard could not attest this Focus Agent.');
    expect(sockets).toHaveLength(1);

    link.dispose();
  });

  it('re-handshakes for a fresh challenge when transient attestation failures exhaust the retries', async () => {
    const sockets: MockSocket[] = [];
    let deviceReady = false;
    const attest = vi.fn(async () => {
      if (!deviceReady) throw noDeviceConnectedError();
      return 'header.payload.signature-header-payload-signature';
    });
    const link = makeLink(sockets, {
      resolveDeviceId: async () => DEVICE_ID,
      attest,
      attestRetryBaseMs: 1,
      attestRetryMaxMs: 2,
      attestMaxAttempts: 3,
      reconnectBaseMs: 1,
    });

    const statuses: AgentConnectionStatus[] = [];
    link.on('status', (event) => statuses.push(event.status));

    link.connect();
    sockets[0]?.open();
    sockets[0]?.receive(HELLO_UNPAIRED);
    sockets[0]?.receive(CHALLENGE);

    // The first socket exhausts its retries and drops; the reconnect opens a fresh socket.
    await vi.waitFor(() => expect(sockets.length).toBeGreaterThan(1), { timeout: 2000 });
    expect(attest).toHaveBeenCalledTimes(3);
    expect(statuses).toContain('DISCONNECTED');

    deviceReady = true;
    sockets[1]?.open();
    sockets[1]?.receive(HELLO_PAIRED);
    sockets[1]?.receive(CHALLENGE);

    await vi.waitFor(
      () => {
        expect(sockets[1]?.frames().some((frame) => frame.type === 'auth')).toBe(true);
      },
      { timeout: 2000 },
    );
    sockets[1]?.receive(AUTH_OK);
    expect(statuses.at(-1)).toBe('PAIRED');

    link.dispose();
  });

  it('asks the agent for running apps with listApps and emits the apps frame', () => {
    const sockets: MockSocket[] = [];
    const link = makeLink(sockets);
    const apps = vi.fn();
    link.on('apps', apps);

    link.connect();
    sockets[0]?.open();
    sockets[0]?.receive(HELLO_UNPAIRED);

    link.requestApps();
    expect(sockets[0]?.frames().some((frame) => frame.type === 'listApps')).toBe(true);

    sockets[0]?.receive({
      v: 1,
      id: 'a-020',
      type: 'apps',
      apps: [{ key: 'slack', label: 'Slack', running: true }],
    });
    expect(apps).toHaveBeenCalledWith(
      expect.objectContaining({
        apps: [{ key: 'slack', label: 'Slack', running: true }],
      }),
    );

    link.dispose();
  });

  it('reports whether exitFocus actually left the page', () => {
    const sockets: MockSocket[] = [];
    const link = makeLink(sockets);

    expect(link.endFocus(SESSION_ID)).toBe(false);

    link.connect();
    sockets[0]?.open();
    expect(link.endFocus(SESSION_ID)).toBe(true);

    link.dispose();
  });

  it('stays silent and stops reconnecting after dispose', () => {
    vi.useFakeTimers();
    const sockets: MockSocket[] = [];
    const link = makeLink(sockets);
    const statusHandler = vi.fn();
    link.on('status', statusHandler);

    link.connect();
    sockets[0]?.open();
    sockets[0]?.receive(HELLO_UNPAIRED);
    const callsBeforeDispose = statusHandler.mock.calls.length;

    link.dispose();
    expect(sockets[0]?.readyState).toBe(3);

    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
    expect(statusHandler).toHaveBeenCalledTimes(callsBeforeDispose);

    link.connect();
    expect(sockets).toHaveLength(1);
  });
});
