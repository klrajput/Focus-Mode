/*
 * AgentLink — the dashboard half of the local channel (TECHNICAL_DESIGN §6.1, T-045 / FR-004,
 * FR-014, REC-003). It owns exactly one job: open an attested WebSocket to the Focus Agent on
 * loopback, keep it alive with exponential backoff and turn every validated `focus.v1` frame into a
 * typed event. It never renders UI, never throws when no agent is installed, and never logs user
 * data (no pairing code ever travels here — DEC-003).
 *
 * Flow (INTEGRATION_CONTRACTS §4.4): connect ws://127.0.0.1:<4545-4549>/link with subprotocol
 * `focus.v1` → receive `hello` → (paired) receive single-use `challenge` → POST /devices/:id/attest
 * through the injected `attest` callback → send `auth` → receive `authOk`/`authError` → send
 * `getState` and dispatch the authoritative `state` to the provider.
 *
 * Post-pairing race (KI-010): the agent issues its post-pairing challenge from `cloud.on('paired')`,
 * which fires BEFORE it opens the cloud `/agent-link` socket that marks the device CONNECTED. The
 * first attestation therefore answers NO_DEVICE_CONNECTED; a short bounded retry (and, if that still
 * fails, a fresh handshake) converges to PAIRED without the user reloading the page.
 *
 * Every frame is validated with the frozen `localMessageSchema`, so an out-of-contract agent can
 * never inject a field the dashboard trusts. Failures are soft: the public surface is event-based
 * and all timer/socket/async paths are guarded, so a missing Focus Agent is a normal DISCONNECTED.
 */

import {
  ERROR_CODES,
  localMessageSchema,
  PROTOCOL_VERSION,
  type AgentConnectionStatus,
  type AppsMessage,
  type AuthErrorMessage,
  type AuthOkMessage,
  type ChallengeMessage,
  type ErrorCode,
  type FocusEndedMessage,
  type FocusRejectedMessage,
  type FocusStartedMessage,
  type HelloMessage,
  type LocalMessage,
  type ScheduleHeadsUpMessage,
  type StateMessage,
} from '@focus-mode/shared';

import { isApiError } from '../api/errors';

/** The browser WebSocket surface AgentLink needs; a tiny interface keeps unit tests mockable. */
export interface LinkSocket {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export type SocketFactory = (url: string, protocols: readonly string[]) => LinkSocket;

/** `Omit` over a union keeps only shared keys, so distribute it member by member. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Messages the dashboard is allowed to send on this channel (contracts §4.5). */
export type AgentOutboundMessage = DistributiveOmit<
  Extract<
    LocalMessage,
    { type: 'auth' | 'paired' | 'getState' | 'exitFocus' | 'enterFocus' | 'listApps' }
  >,
  'v' | 'id'
>;

/** Typed event bus consumed by `AgentLinkProvider` (one event per protocol message we act on). */
export interface AgentLinkEvents {
  /** Dashboard status derived from agent truth (`DISCONNECTED` never comes from the agent). */
  status: { status: AgentConnectionStatus; detail: string };
  hello: HelloMessage;
  state: StateMessage;
  focusStarted: FocusStartedMessage;
  focusEnded: FocusEndedMessage;
  focusRejected: FocusRejectedMessage;
  scheduleHeadsUp: ScheduleHeadsUpMessage;
  /** Answer to `listApps` (REC-007): key + label + running only, never a window title (INV-6). */
  apps: AppsMessage;
  /** Emitted after a `paired` nudge was attempted; `sent` is false when no socket is open. */
  paired: { sent: boolean };
  authOk: AuthOkMessage;
  authError: AuthErrorMessage;
  /** All candidate ports were tried without a Focus Agent answering. */
  connectFailed: { ports: readonly number[] };
  /** Soft, already user-safe failure detail (never a stack trace or secret). */
  error: { message: string };
}

export interface AgentLinkOptions {
  /** Preferred loopback port; `VITE_AGENT_PORT` when omitted (defaults to 4545). */
  basePort?: number;
  /** Consecutive ports to scan; `VITE_AGENT_PORT_RANGE` when omitted (defaults to 5). */
  portRange?: number;
  socketFactory?: SocketFactory;
  /** Resolves the cloud device id for the attestation call (provider wires GET /devices). */
  resolveDeviceId?: () => Promise<string | null>;
  /** Exchanges the challenge nonce for a short-lived attestation JWT (provider wires the API). */
  attest?: (deviceId: string, nonce: string) => Promise<string>;
  scanTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  /** Bounded retry for a transient attestation failure (KI-010 post-pairing race). */
  attestRetryBaseMs?: number;
  attestRetryMaxMs?: number;
  /** Total `POST /devices/:id/attest` attempts (first try included) before re-handshaking. */
  attestMaxAttempts?: number;
}

/** What `AgentLinkProvider` needs; lets tests inject a fake without opening a socket. */
export interface AgentLinkClient {
  connect(): void;
  reconnect(): void;
  dispose(): void;
  requestState(): void;
  notifyPaired(): void;
  /** Returns false when no attested socket is open (the UI must not claim the end was sent). */
  endFocus(sessionId?: string): boolean;
  /** Ask the agent which apps are running (`listApps`, REC-007) — never window titles. */
  requestApps(): void;
  send(message: AgentOutboundMessage): boolean;
  on<K extends keyof AgentLinkEvents>(
    type: K,
    handler: (payload: AgentLinkEvents[K]) => void,
  ): () => void;
}

const AGENT_HOST = '127.0.0.1';
const AGENT_LINK_PATH = '/link';
const AGENT_SUBPROTOCOL = 'focus.v1';
const WEBSOCKET_OPEN = 1;
const DEFAULT_BASE_PORT = 4545;
const DEFAULT_PORT_RANGE = 5;
const DEFAULT_SCAN_TIMEOUT_MS = 2000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 6000;
const DEFAULT_RECONNECT_BASE_MS = 500;
const DEFAULT_RECONNECT_MAX_MS = 8000;
const DEFAULT_ATTEST_RETRY_BASE_MS = 250;
const DEFAULT_ATTEST_RETRY_MAX_MS = 2000;
const DEFAULT_ATTEST_MAX_ATTEMPTS = 7;
const MAX_PORT = 65_535;

/**
 * Attestation failures that mean "the agent is still settling", not "this dashboard may never
 * control it": the device exists but its cloud socket has not marked it CONNECTED yet (KI-010), or
 * the API/network is briefly unavailable right after pairing. Everything else is permanent.
 */
const TRANSIENT_ATTEST_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  ERROR_CODES.NO_DEVICE_CONNECTED,
  ERROR_CODES.NOT_FOUND,
  ERROR_CODES.CONFLICT,
  ERROR_CODES.INTERNAL,
]);

function isTransientAttestationError(error: unknown): boolean {
  return isApiError(error) && TRANSIENT_ATTEST_CODES.has(error.code);
}

/** One counter for correlation ids: unique per page load, no secrets, no PII. */
let messageCounter = 0;

function nextMessageId(): string {
  messageCounter += 1;
  return `d-${messageCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readPositiveInt(value: unknown, fallback: number, max: number, min: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

/** Ports scanned in order: 4545…4549 by default (contracts §4.1). */
export function candidatePorts(basePort?: number, portRange?: number): number[] {
  const env = import.meta.env;
  const base = readPositiveInt(basePort ?? env.VITE_AGENT_PORT, DEFAULT_BASE_PORT, MAX_PORT, 1);
  const range = readPositiveInt(portRange ?? env.VITE_AGENT_PORT_RANGE, DEFAULT_PORT_RANGE, 64, 1);

  const ports: number[] = [];
  for (let offset = 0; offset < range; offset += 1) {
    const port = base + offset;
    if (port > MAX_PORT) break;
    ports.push(port);
  }
  return ports;
}

/** The one place the loopback URL is built (NFR-004: no scattered hard-coded URLs). */
export function agentLinkUrl(port: number): string {
  return `ws://${AGENT_HOST}:${port}${AGENT_LINK_PATH}`;
}

function detach(socket: LinkSocket): void {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  try {
    socket.close();
  } catch {
    // Closing an already-closed socket is a no-op for our purposes.
  }
}

export class AgentLink implements AgentLinkClient {
  private readonly ports: readonly number[];
  private readonly socketFactory: SocketFactory;
  private readonly resolveDeviceId: () => Promise<string | null>;
  private readonly attest: (deviceId: string, nonce: string) => Promise<string>;
  private readonly scanTimeoutMs: number;
  private readonly handshakeTimeoutMs: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly attestRetryBaseMs: number;
  private readonly attestRetryMaxMs: number;
  private readonly attestMaxAttempts: number;

  private readonly handlers = new Map<keyof AgentLinkEvents, Set<(payload: never) => void>>();

  private socket: LinkSocket | null = null;
  private pendingSocket: LinkSocket | null = null;
  private helloMessage: HelloMessage | null = null;
  private authenticated = false;
  /** One attestation exchange at a time: a re-issued challenge must not race the first one. */
  private authInFlight = false;
  /** Extra `POST /devices/:id/attest` attempts for the current challenge (KI-010 retry budget). */
  private attestAttempts = 0;
  private disposed = false;
  private portIndex = 0;
  private reconnectDelayMs: number;

  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private challengeTimer: ReturnType<typeof setTimeout> | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private attestRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: AgentLinkOptions = {}) {
    this.ports = candidatePorts(options.basePort, options.portRange);
    this.socketFactory =
      options.socketFactory ?? ((url, protocols) => new WebSocket(url, [...protocols]));
    this.resolveDeviceId = options.resolveDeviceId ?? (async () => null);
    this.attest =
      options.attest ??
      (async () => {
        throw new Error('No attestation transport is configured.');
      });
    this.scanTimeoutMs = options.scanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
    this.reconnectBaseMs = options.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS;
    this.reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
    this.attestRetryBaseMs = options.attestRetryBaseMs ?? DEFAULT_ATTEST_RETRY_BASE_MS;
    this.attestRetryMaxMs = options.attestRetryMaxMs ?? DEFAULT_ATTEST_RETRY_MAX_MS;
    this.attestMaxAttempts = options.attestMaxAttempts ?? DEFAULT_ATTEST_MAX_ATTEMPTS;
    this.reconnectDelayMs = this.reconnectBaseMs;
  }

  // -------------------------------------------------------------------------
  // Event bus
  // -------------------------------------------------------------------------

  on<K extends keyof AgentLinkEvents>(
    type: K,
    handler: (payload: AgentLinkEvents[K]) => void,
  ): () => void {
    // `never` is assignable to every payload type, so the wrapper stores every handler without an
    // unsafe cast; dispatch below is only ever called with the payload registered for the key.
    const listener = (payload: never): void => handler(payload);
    const existing = this.handlers.get(type);
    const listeners = existing ?? new Set<(payload: never) => void>();
    listeners.add(listener);
    this.handlers.set(type, listeners);

    return () => {
      listeners.delete(listener);
    };
  }

  private emit<K extends keyof AgentLinkEvents>(type: K, payload: AgentLinkEvents[K]): void {
    const listeners = this.handlers.get(type);
    if (listeners === undefined) return;
    for (const listener of listeners) {
      // No casts at call sites: the registry stores handlers typed to accept the matching payload.
      listener(payload as never);
    }
  }

  private emitStatus(status: AgentConnectionStatus, detail: string): void {
    this.emit('status', { status, detail });
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  connect(): void {
    if (this.disposed || this.pendingSocket !== null || this.socket !== null) return;
    this.clearTimer('reconnect');
    this.portIndex = 0;
    this.tryNextPort();
  }

  reconnect(): void {
    if (this.disposed) return;
    this.clearTimer('reconnect');
    this.resetSession();
    this.tryNextPort();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer('scan');
    this.clearTimer('reconnect');
    this.resetSession();
    this.handlers.clear();
  }

  // -------------------------------------------------------------------------
  // Outbound messages
  // -------------------------------------------------------------------------

  send(message: AgentOutboundMessage): boolean {
    const socket = this.socket;
    if (socket === null || socket.readyState !== WEBSOCKET_OPEN) return false;

    const frame: unknown = { v: PROTOCOL_VERSION, id: nextMessageId(), ...message };
    const parsed = localMessageSchema.safeParse(frame);
    if (!parsed.success) {
      this.emit('error', { message: 'The dashboard refused to send a malformed local message.' });
      return false;
    }

    try {
      socket.send(JSON.stringify(parsed.data));
      return true;
    } catch {
      this.emit('error', { message: 'The local Focus Agent connection could not send a message.' });
      return false;
    }
  }

  requestState(): void {
    this.send({ type: 'getState' });
  }

  requestApps(): void {
    this.send({ type: 'listApps' });
  }

  notifyPaired(): void {
    const sent = this.send({ type: 'paired' });
    this.emit('paired', { sent });
  }

  endFocus(sessionId?: string): boolean {
    return this.send(
      sessionId === undefined ? { type: 'exitFocus' } : { type: 'exitFocus', sessionId },
    );
  }

  // -------------------------------------------------------------------------
  // Port scan (contracts §4.7)
  // -------------------------------------------------------------------------

  private tryNextPort(): void {
    if (this.disposed) return;

    const port = this.ports[this.portIndex];
    if (port === undefined) {
      this.handleScanExhausted();
      return;
    }
    this.portIndex += 1;

    let socket: LinkSocket;
    try {
      socket = this.socketFactory(agentLinkUrl(port), [AGENT_SUBPROTOCOL]);
    } catch {
      this.tryNextPort();
      return;
    }

    this.pendingSocket = socket;
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      this.abandonPort(socket);
    }, this.scanTimeoutMs);

    socket.onopen = () => {
      if (this.pendingSocket !== socket) return;
      this.clearTimer('scan');
      this.pendingSocket = null;
      this.handleOpen(socket);
    };
    socket.onerror = () => {
      if (this.pendingSocket !== socket) return;
      this.abandonPort(socket);
    };
    socket.onclose = () => {
      if (this.pendingSocket !== socket) return;
      this.abandonPort(socket);
    };
    socket.onmessage = (event: MessageEvent) => {
      if (this.socket !== socket && this.pendingSocket !== socket) return;
      this.handleFrame(socket, event.data);
    };
  }

  private abandonPort(socket: LinkSocket): void {
    if (this.disposed || this.pendingSocket !== socket) return;
    this.pendingSocket = null;
    this.clearTimer('scan');
    detach(socket);
    this.tryNextPort();
  }

  private handleScanExhausted(): void {
    if (this.disposed) return;
    this.emitStatus(
      'DISCONNECTED',
      'We could not reach your Focus Agent. Make sure it is running on this computer.',
    );
    this.emit('connectFailed', { ports: this.ports });
    this.scheduleReconnect();
  }

  private handleOpen(socket: LinkSocket): void {
    if (this.disposed) return;
    this.socket = socket;
    this.helloMessage = null;
    this.authenticated = false;
    this.authInFlight = false;
    this.attestAttempts = 0;
    this.reconnectDelayMs = this.reconnectBaseMs;

    socket.onopen = null;
    socket.onerror = () => this.handleDrop(socket);
    socket.onclose = () => this.handleDrop(socket);

    this.handshakeTimer = setTimeout(() => {
      this.handshakeTimer = null;
      this.emit('error', { message: 'Your Focus Agent did not complete the handshake in time.' });
      this.handleDrop(socket);
    }, this.handshakeTimeoutMs);
  }

  private handleDrop(socket: LinkSocket): void {
    if (this.socket !== socket) return;
    this.resetSession();
    this.emitStatus('DISCONNECTED', 'The connection to your Focus Agent closed. Reconnecting…');
    this.scheduleReconnect();
  }

  /** Detach, close and forget the current socket plus every handshake timer. */
  private resetSession(): void {
    this.clearTimer('handshake');
    this.clearTimer('challenge');
    this.clearTimer('auth');
    this.clearTimer('attestRetry');
    const socket = this.socket;
    this.socket = null;
    this.helloMessage = null;
    this.authenticated = false;
    this.authInFlight = false;
    this.attestAttempts = 0;
    if (socket !== null) detach(socket);
    const pending = this.pendingSocket;
    this.pendingSocket = null;
    if (pending !== null) detach(pending);
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // -------------------------------------------------------------------------
  // Handshake (contracts §4.4)
  // -------------------------------------------------------------------------

  private handleFrame(socket: LinkSocket, raw: unknown): void {
    if (typeof raw !== 'string') return;

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      this.emit('error', { message: 'The Focus Agent sent a frame that was not valid JSON.' });
      return;
    }

    const parsed = localMessageSchema.safeParse(payload);
    if (!parsed.success) {
      this.emit('error', {
        message: 'The Focus Agent sent a frame outside the focus.v1 contract.',
      });
      return;
    }

    const message = parsed.data;
    switch (message.type) {
      case 'hello':
        this.handleHello(socket, message);
        break;
      case 'challenge':
        this.handleChallenge(socket, message);
        break;
      case 'authOk':
        this.handleAuthOk(socket, message);
        break;
      case 'authError':
        this.handleAuthError(message);
        break;
      case 'state':
        this.emit('state', message);
        this.emitStatus(this.statusFromState(message), 'Your Focus Agent sent its current state.');
        break;
      case 'apps':
        this.emit('apps', message);
        break;
      case 'focusStarted':
        this.emit('focusStarted', message);
        this.emitStatus('FOCUSING', 'A focus session is running on this device.');
        break;
      case 'focusEnded':
        this.emit('focusEnded', message);
        this.emitStatus(
          this.helloMessage?.paired === true ? 'PAIRED' : 'IDLE',
          'The focus session ended and your windows are back.',
        );
        break;
      case 'focusRejected':
        this.emit('focusRejected', message);
        break;
      case 'scheduleHeadsUp':
        this.emit('scheduleHeadsUp', message);
        break;
      default:
        // `paired`, `auth`, `getState`, `enterFocus`, `exitFocus` and `listApps` are not
        // agent → dashboard frames we act on; ignoring them keeps a future agent forward-compatible.
        break;
    }
  }

  private handleHello(socket: LinkSocket, hello: HelloMessage): void {
    if (this.socket !== socket) return;
    this.clearTimer('handshake');
    this.helloMessage = hello;
    this.emit('hello', hello);

    if (!hello.paired) {
      // Reachable but not linked to this account: honest IDLE, no attestation to perform yet.
      this.emitStatus('IDLE', 'Your Focus Agent is running but not paired to this account yet.');
      this.requestState();
      return;
    }

    // Paired: the agent sends a single-use challenge next. The badge keeps "Connecting…" until
    // authOk/authError, so nothing claims Connected before the attestation is accepted.
    this.challengeTimer = setTimeout(() => {
      this.challengeTimer = null;
      this.emit('error', { message: 'Your Focus Agent did not send an attestation challenge.' });
      this.handleDrop(socket);
    }, this.handshakeTimeoutMs);
  }

  /**
   * A challenge is the agent's invitation to attest (REC-003). It is deliberately accepted even
   * when `hello.paired` was false: after a `paired` nudge the agent polls the cloud and re-issues a
   * challenge to sockets that connected while it was still unpaired (KI-010), so gating on the
   * original `hello` would leave the badge stuck on "Not paired" until a page reload.
   */
  private handleChallenge(socket: LinkSocket, challenge: ChallengeMessage): void {
    if (this.socket !== socket || this.authenticated || this.authInFlight) return;
    this.clearTimer('challenge');
    void this.authenticate(socket, challenge);
  }

  private async authenticate(socket: LinkSocket, challenge: ChallengeMessage): Promise<void> {
    this.authInFlight = true;
    this.attestAttempts = 0;
    await this.runAttestation(socket, challenge);
  }

  /**
   * One attestation attempt. Transient failures (`NO_DEVICE_CONNECTED` right after pairing, a
   * briefly unreachable API) are retried with backoff while the same socket stays open; permanent
   * rejections surface immediately. Exhausted transient retries drop the socket so the next
   * handshake receives a fresh challenge instead of leaving the badge on "Not paired" forever.
   */
  private async runAttestation(socket: LinkSocket, challenge: ChallengeMessage): Promise<void> {
    if (this.disposed || this.socket !== socket) {
      this.authInFlight = false;
      return;
    }

    let deviceId: string | null;
    try {
      deviceId = await this.resolveDeviceId();
    } catch {
      if (this.retryAttestation(socket, challenge)) return;
      this.failAttestation(socket, 'We could not read the devices linked to this account.', true);
      return;
    }

    if (this.disposed || this.socket !== socket) {
      this.authInFlight = false;
      return;
    }

    if (deviceId === null) {
      // The account genuinely has no device (e.g. it was just unpaired): retrying cannot help.
      this.failAttestation(
        socket,
        'No device is linked to this account yet. Pair your Focus Agent on Devices.',
        false,
      );
      return;
    }

    let attestation: string;
    try {
      attestation = await this.attest(deviceId, challenge.nonce);
    } catch (error) {
      const transient = isTransientAttestationError(error);
      if (transient && this.retryAttestation(socket, challenge)) return;
      this.failAttestation(socket, 'The dashboard could not attest this Focus Agent.', transient);
      return;
    }

    if (this.disposed || this.socket !== socket) {
      this.authInFlight = false;
      return;
    }

    this.authTimer = setTimeout(() => {
      this.authTimer = null;
      this.emit('error', { message: 'Your Focus Agent did not answer the attestation.' });
      this.handleDrop(socket);
    }, this.handshakeTimeoutMs);

    this.send({ type: 'auth', attestation });
  }

  /** Schedule the next attestation attempt; false once the bounded budget is exhausted. */
  private retryAttestation(socket: LinkSocket, challenge: ChallengeMessage): boolean {
    if (this.disposed || this.socket !== socket) return false;
    if (this.attestAttempts + 1 >= this.attestMaxAttempts) return false;

    this.attestAttempts += 1;
    const delay = Math.min(
      this.attestRetryBaseMs * 2 ** (this.attestAttempts - 1),
      this.attestRetryMaxMs,
    );
    this.clearTimer('attestRetry');
    this.attestRetryTimer = setTimeout(() => {
      this.attestRetryTimer = null;
      void this.runAttestation(socket, challenge);
    }, delay);
    return true;
  }

  /** Give up the current attestation; `rehandshake` asks the agent for a fresh challenge. */
  private failAttestation(socket: LinkSocket, message: string, rehandshake: boolean): void {
    this.authInFlight = false;
    if (this.disposed || this.socket !== socket) return;

    this.emit('error', { message });
    if (rehandshake) {
      this.handleDrop(socket);
      return;
    }
    this.emitStatus('IDLE', 'We could not verify this dashboard with your Focus Agent.');
  }

  private handleAuthOk(socket: LinkSocket, authOk: AuthOkMessage): void {
    if (this.socket !== socket) return;
    this.clearTimer('auth');
    this.authenticated = true;
    this.authInFlight = false;
    this.emit('authOk', authOk);

    // `authOk` proves the pairing binding (REC-003), so the link is Connected even when the
    // original `hello` arrived before the agent was paired. A following `state` frame is still the
    // authority for FOCUSING (INV-5).
    const status: AgentConnectionStatus =
      this.helloMessage?.state === 'FOCUSING' ? 'FOCUSING' : 'PAIRED';
    this.emitStatus(status, 'Your Focus Agent is connected and attested.');

    // INV-5: always re-sync from agent truth after (re)connect (FR-014).
    this.requestState();
  }

  private handleAuthError(message: AuthErrorMessage): void {
    this.clearTimer('auth');
    this.authenticated = false;
    this.authInFlight = false;
    this.emit('authError', message);
    this.emitStatus(
      'IDLE',
      'Your Focus Agent rejected this dashboard. Pair it again on Devices to reconnect.',
    );
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private statusFromState(message: StateMessage): AgentConnectionStatus {
    if (message.state === 'FOCUSING') return 'FOCUSING';
    if (message.state === 'PAIRED') return 'PAIRED';
    return 'IDLE';
  }

  /** True once the attestation has been accepted; read by tests and the provider via events. */
  isAuthenticated(): boolean {
    return this.authenticated;
  }

  private clearTimer(
    name: 'scan' | 'handshake' | 'challenge' | 'auth' | 'attestRetry' | 'reconnect',
  ): void {
    switch (name) {
      case 'scan':
        if (this.scanTimer !== null) clearTimeout(this.scanTimer);
        this.scanTimer = null;
        break;
      case 'handshake':
        if (this.handshakeTimer !== null) clearTimeout(this.handshakeTimer);
        this.handshakeTimer = null;
        break;
      case 'challenge':
        if (this.challengeTimer !== null) clearTimeout(this.challengeTimer);
        this.challengeTimer = null;
        break;
      case 'auth':
        if (this.authTimer !== null) clearTimeout(this.authTimer);
        this.authTimer = null;
        break;
      case 'attestRetry':
        if (this.attestRetryTimer !== null) clearTimeout(this.attestRetryTimer);
        this.attestRetryTimer = null;
        break;
      case 'reconnect':
        if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        break;
    }
  }
}
