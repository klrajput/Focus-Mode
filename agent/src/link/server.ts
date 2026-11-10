// link/server.ts — the loopback WebSocket server for dashboard ↔ Focus Agent (T-031/T-044, §6.1).
// Binds 127.0.0.1 only and rejects upgrades whose Origin/Host/subprotocol fail, then speaks the
// frozen `focus.v1` protocol from `@focus-mode/shared`. It is deliberately Electron-free so the
// security checks and the attested handshake can be tested with a real `ws` client.
// REC-003/SEC-7: a paired agent issues a single-use `challenge`; control messages are refused with
// `focusRejected{UNAUTHENTICATED}` until a cloud-signed EdDSA attestation for that nonce passes.

import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { AddressInfo } from 'node:net';
import {
  ERROR_CODES,
  LOCAL_MESSAGE_DIRECTIONS,
  localMessageSchema,
  type ErrorCode,
  type LocalMessage,
  type LocalMessageType,
} from '@focus-mode/shared';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { noopLogger, type Logger } from '../log.js';
import type {
  AttestationBinding,
  AttestationRequest,
  AttestationVerification,
} from './attestation.js';
import type { LinkControlHandlers } from './handlers.js';
import {
  buildAuthError,
  buildAuthOk,
  buildChallenge,
  buildFocusRejected,
  buildHello,
  buildState,
  type AgentIdentity,
  type LinkSnapshot,
} from './messages.js';

/** NFR-010: the link is loopback-only; never derived from user input. */
export const LOOPBACK_HOST = '127.0.0.1';
/** Contract §4.1 path: `ws://127.0.0.1:4545/link`. */
export const LINK_PATH = '/link';
/** Required subprotocol; also the wire version. */
export const LINK_SUBPROTOCOL = 'focus.v1';
export const MAX_PAYLOAD_BYTES = 16 * 1024;
export const MAX_CONNECTIONS = 3;
export const MAX_MESSAGES_PER_SECOND = 20;
/** Port the dashboard scans after `AGENT_PORT` (§4.1: 4545–4549 → 5 candidates). */
export const DEFAULT_PORT_FALLBACK_ATTEMPTS = 5;
/** 32 random bytes → 43 URL-safe characters, within the frozen nonce schema (16–128). */
export const NONCE_BYTES = 32;

/** Control messages: never served before `authOk` (REC-003). */
const CONTROL_MESSAGE_TYPES: ReadonlySet<LocalMessageType> = new Set([
  'enterFocus',
  'exitFocus',
  'listApps',
]);

export interface LinkAddress {
  readonly host: typeof LOOPBACK_HOST;
  readonly port: number;
}

interface ConnectionState {
  /** Outstanding single-use challenge nonce; null after use (or while unpaired). */
  nonce: string | null;
  authenticated: boolean;
  /**
   * True while an `auth` frame is being verified. A second concurrent auth frame is a protocol
   * error (one challenge → at most one attempt), not a second lottery ticket (T-080).
   */
  authInFlight: boolean;
  /** Device/owner this socket's attestation was verified for; null until `authOk`. */
  deviceId: string | null;
  userId: string | null;
  /**
   * Bumped whenever the authenticated surface of this socket is invalidated (unpair, re-pair,
   * duplicate auth, disconnect). Async work captures it before awaiting and drops its result
   * instead of answering a socket whose authority has changed (T-080 stale-socket guard).
   */
  generation: number;
}

export interface LinkServerOptions {
  /** `AGENT_PORT`; 0 asks the OS for an ephemeral port (tests only). */
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  readonly identity: AgentIdentity;
  readonly getSnapshot: () => LinkSnapshot;
  /** The `paired` frame is a nudge only; T-042's cloud poll handler is wired here. */
  readonly onPaired?: () => void;
  /** Pairing identity for the attested handshake; null while unpaired. */
  readonly getPairing?: () => AttestationBinding | null;
  /** EdDSA attestation verifier; absent means attestation is not configured and fails closed. */
  readonly verifyAttestation?: (request: AttestationRequest) => Promise<AttestationVerification>;
  /**
   * Authenticated control handlers (T-051). Absent keeps the fail-closed W2 behaviour: control
   * messages are answered with `focusRejected{INVALID}` and the controller is never reached.
   */
  readonly controlHandlers?: LinkControlHandlers;
  /** Observation hook (AGENT_SMOKE, tests): called after a handled inbound frame is answered. */
  readonly onMessageHandled?: (type: LocalMessageType) => void;
  readonly logger?: Logger;
  readonly portFallbackAttempts?: number;
  readonly maxConnections?: number;
  readonly maxMessagesPerSecond?: number;
  readonly maxPayloadBytes?: number;
}

class LinkServerNotStartedError extends Error {
  constructor() {
    super('LinkServer.start() must be called first');
    this.name = 'LinkServerNotStartedError';
  }
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function isAddressInUse(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (!('code' in error)) return false;
  return error.code === 'EADDRINUSE';
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, LOOPBACK_HOST);
  });
}

function closeServer(server: Server): void {
  try {
    server.close();
  } catch {
    // Never started — nothing to close.
  }
}

function rejectUpgrade(socket: Duplex, statusCode: number, statusText: string): void {
  const body = Buffer.from(`${statusCode} ${statusText}\n`, 'utf8');
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${body.length}\r\n\r\n`,
  );
  socket.end(body);
  socket.destroy();
}

/** Parses the comma-separated `Sec-WebSocket-Protocol` request header. */
function requestedProtocols(header: string | string[] | undefined): readonly string[] {
  if (header === undefined) return [];
  const raw = Array.isArray(header) ? header.join(',') : header;
  return raw
    .split(',')
    .map((protocol) => protocol.trim())
    .filter((protocol) => protocol.length > 0);
}

/** Cryptographically random, URL-safe single-use nonce (REC-003). */
export function createChallengeNonce(): string {
  return randomBytes(NONCE_BYTES).toString('base64url');
}

/**
 * The dashboard link. One instance per agent process. `start()` resolves with the bound port
 * (which may be +1…+4 over the configured one) so the tray/UI can report it.
 */
export class LinkServer {
  readonly #options: LinkServerOptions;
  readonly #logger: Logger;
  readonly #allowedOrigins: ReadonlySet<string>;
  readonly #maxConnections: number;
  readonly #maxMessagesPerSecond: number;
  readonly #maxPayloadBytes: number;
  readonly #portFallbackAttempts: number;
  readonly #rateWindows = new WeakMap<WebSocket, number[]>();
  readonly #connections = new Map<WebSocket, ConnectionState>();

  #httpServer: Server | undefined;
  #wss: WebSocketServer | undefined;
  #address: LinkAddress | undefined;

  constructor(options: LinkServerOptions) {
    this.#options = options;
    this.#logger = options.logger ?? noopLogger;
    this.#allowedOrigins = new Set(options.allowedOrigins);
    this.#maxConnections = options.maxConnections ?? MAX_CONNECTIONS;
    this.#maxMessagesPerSecond = options.maxMessagesPerSecond ?? MAX_MESSAGES_PER_SECOND;
    this.#maxPayloadBytes = options.maxPayloadBytes ?? MAX_PAYLOAD_BYTES;
    this.#portFallbackAttempts = options.portFallbackAttempts ?? DEFAULT_PORT_FALLBACK_ATTEMPTS;
  }

  get address(): LinkAddress {
    if (this.#address === undefined) throw new LinkServerNotStartedError();
    return this.#address;
  }

  get connectedClients(): number {
    return this.#wss?.clients.size ?? 0;
  }

  /** Binds `127.0.0.1`, falling back to the next four ports when the configured one is busy. */
  async start(): Promise<LinkAddress> {
    if (this.#httpServer !== undefined) throw new Error('LinkServer is already started');

    const attempts = this.#options.port === 0 ? 1 : this.#portFallbackAttempts;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const candidatePort = this.#options.port === 0 ? 0 : this.#options.port + attempt;
      const httpServer = createServer((_request, response) => {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Focus Agent link uses a WebSocket upgrade on /link\n');
      });
      const wss = new WebSocketServer({
        noServer: true,
        perMessageDeflate: false,
        maxPayload: this.#maxPayloadBytes,
        handleProtocols: (protocols) =>
          protocols.has(LINK_SUBPROTOCOL) ? LINK_SUBPROTOCOL : false,
      });

      httpServer.on('upgrade', (request, socket, head) => {
        this.#handleUpgrade(wss, request, socket, head);
      });
      wss.on('connection', (socket) => {
        this.#handleConnection(socket);
      });
      wss.on('error', (error) => {
        this.#logger.error('Link WebSocket server error', error);
      });

      try {
        await listen(httpServer, candidatePort);
        const bound = httpServer.address();
        if (bound === null || typeof bound === 'string') {
          closeServer(httpServer);
          wss.close();
          throw new Error('Link server did not bind a TCP address');
        }
        const address: AddressInfo = bound;
        this.#httpServer = httpServer;
        this.#wss = wss;
        this.#address = { host: LOOPBACK_HOST, port: address.port };
        this.#logger.info(
          'Dashboard link listening',
          `${LOOPBACK_HOST}:${address.port}${LINK_PATH}`,
        );
        return this.#address;
      } catch (error) {
        closeServer(httpServer);
        wss.close();
        if (isAddressInUse(error)) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Could not bind the dashboard link on any candidate port');
  }

  /** Closes every client and releases the port (tests and quit). */
  async stop(): Promise<void> {
    const wss = this.#wss;
    this.#wss = undefined;
    if (wss !== undefined) {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
    const httpServer = this.#httpServer;
    this.#httpServer = undefined;
    if (httpServer !== undefined) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
    this.#connections.clear();
    this.#address = undefined;
  }

  /**
   * Called when the agent becomes paired (enroll poll succeeded) while dashboards are already
   * connected. Those sockets got an unpaired `hello` and no challenge, so a fresh `hello` (now
   * `paired: true`) and a fresh single-use `challenge` are re-issued on every unauthenticated
   * socket — the dashboard can re-handshake without a page reload (KI-010 agent half, FR-004).
   *
   * T-080: an authenticated socket is kept only when its attestation is still bound to the
   * *current* device/owner. If the pairing changed (re-pair to another account/device) the old
   * attestation is stale, so the socket is policy-closed and must re-handshake — re-attestation
   * after a pairing change is mandatory, never optional.
   */
  refreshPairing(): void {
    const binding = this.#pairing();
    for (const [socket, state] of this.#connections) {
      if (state.authenticated) {
        if (
          binding === null ||
          binding.deviceId !== state.deviceId ||
          binding.userId !== state.userId
        ) {
          this.#logger.warn('Closing a dashboard link whose attestation predates a pairing change');
          this.#invalidateAuthentication(socket, state, 'PAIRING_CHANGED');
        }
        continue;
      }
      if (binding === null || state.authInFlight) continue;
      // hello first: it is what tells the dashboard the pairing state actually changed.
      this.#send(socket, buildHello(this.#options.getSnapshot(), this.#options.identity));
      this.#issueChallenge(socket, state);
    }
  }

  /**
   * Called on `revoked`/unpair (`CloudClient` `revoked` event). The frozen local protocol has no
   * "unpaired" frame, so the honest signal is a policy close (`1008`, contract §4.2/§4.7): every
   * dashboard resets its handshake and reconnects, then receives `hello {paired: false}` and shows
   * "Not paired" instead of a stale "Connected" badge. A close is also the only way to invalidate
   * an attestation that was bound to a device token that no longer exists.
   */
  notifyUnpaired(reason = 'UNPAIRED'): void {
    if (this.#connections.size === 0) return;
    this.#logger.info('Closing dashboard links because this device is no longer paired', {
      reason,
      sockets: this.#connections.size,
    });
    for (const [socket, state] of this.#connections) {
      this.#invalidateAuthentication(socket, state, reason);
    }
  }

  /**
   * Sends a lifecycle frame (`focusStarted`/`focusEnded`) to every authenticated dashboard.
   * Default is authenticated-only: focus state is control-plane truth (REC-003), not something
   * an unattested page should receive. Exactly one frame per event per socket (FR-004).
   */
  broadcast(message: LocalMessage, options: { readonly authenticatedOnly?: boolean } = {}): void {
    const wss = this.#wss;
    if (wss === undefined) return;
    const authenticatedOnly = options.authenticatedOnly ?? true;
    for (const socket of wss.clients) {
      const state = this.#connections.get(socket);
      if (state === undefined) continue;
      if (authenticatedOnly && !state.authenticated) continue;
      this.#send(socket, message);
    }
  }

  #pairing(): AttestationBinding | null {
    return this.#options.getPairing?.() ?? null;
  }

  /** True only when this socket's verified attestation still matches the live pairing. */
  #isCurrentBinding(state: ConnectionState): boolean {
    const binding = this.#pairing();
    return (
      binding !== null &&
      state.authenticated &&
      binding.deviceId === state.deviceId &&
      binding.userId === state.userId
    );
  }

  /**
   * Drops every authority this socket had and closes it. Bumping `generation` makes any in-flight
   * attestation/control promise discard its result instead of answering a stale socket (T-080).
   */
  #invalidateAuthentication(socket: WebSocket, state: ConnectionState, reason: string): void {
    state.authenticated = false;
    state.nonce = null;
    state.authInFlight = false;
    state.deviceId = null;
    state.userId = null;
    state.generation += 1;
    if (socket.readyState === WebSocket.OPEN) socket.close(1008, reason);
  }

  #issueChallenge(socket: WebSocket, state: ConnectionState): void {
    const nonce = createChallengeNonce();
    state.nonce = nonce;
    this.#send(socket, buildChallenge(nonce));
  }

  #handleUpgrade(
    wss: WebSocketServer,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    socket.on('error', () => socket.destroy());

    if (this.#address === undefined) {
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }

    const port = this.#address.port;
    const url = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}:${port}`);
    if (url.pathname !== LINK_PATH) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }

    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !this.#allowedOrigins.has(origin)) {
      this.#logger.warn('Rejected link upgrade: Origin not allowed');
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }

    // DNS-rebinding defence: the Host header must be exactly one of our loopback spellings.
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const host = request.headers.host;
    if (typeof host !== 'string' || !allowedHosts.has(host)) {
      this.#logger.warn('Rejected link upgrade: Host not allowed');
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }

    if (!requestedProtocols(request.headers['sec-websocket-protocol']).includes(LINK_SUBPROTOCOL)) {
      this.#logger.warn('Rejected link upgrade: focus.v1 subprotocol not requested');
      rejectUpgrade(socket, 400, 'Bad Request');
      return;
    }

    if (wss.clients.size >= this.#maxConnections) {
      this.#logger.warn('Rejected link upgrade: connection limit reached');
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }

    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit('connection', webSocket, request);
    });
  }

  #handleConnection(socket: WebSocket): void {
    const state: ConnectionState = {
      nonce: null,
      authenticated: false,
      authInFlight: false,
      deviceId: null,
      userId: null,
      generation: 0,
    };
    this.#connections.set(socket, state);
    this.#rateWindows.set(socket, []);
    socket.on('message', (data, isBinary) => {
      this.#handleMessage(socket, data, isBinary);
    });
    socket.on('close', () => {
      // A closed socket can never answer anything: invalidate first so an in-flight verifier or
      // control handler cannot send after the close (T-080 disconnect mid-focus).
      state.generation += 1;
      state.authenticated = false;
      state.nonce = null;
      state.authInFlight = false;
      state.deviceId = null;
      state.userId = null;
      this.#connections.delete(socket);
      this.#rateWindows.delete(socket);
    });
    socket.on('error', (error) => {
      this.#logger.warn('Link socket error', error.message);
    });

    const snapshot = this.#options.getSnapshot();
    this.#send(socket, buildHello(snapshot, this.#options.identity));

    // Handshake step 2: only a paired agent has a binding to bind an attestation to.
    if (snapshot.paired && this.#pairing() !== null) {
      this.#issueChallenge(socket, state);
    }
  }

  #handleMessage(socket: WebSocket, data: RawData, isBinary: boolean): void {
    if (isBinary) {
      this.#rejectAndClose(socket, ERROR_CODES.VALIDATION_ERROR, 'Binary frames are not allowed');
      return;
    }

    if (!this.#acceptWithinRateLimit(socket)) {
      this.#logger.warn('Link socket exceeded the message rate limit');
      socket.close(1008, 'Rate limit exceeded');
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(toBuffer(data).toString('utf8'));
    } catch {
      this.#rejectAndClose(socket, ERROR_CODES.VALIDATION_ERROR, 'Malformed JSON frame');
      return;
    }

    const parsed = localMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.#rejectAndClose(socket, ERROR_CODES.VALIDATION_ERROR, 'Unsupported message');
      return;
    }
    const message: LocalMessage = parsed.data;

    if (LOCAL_MESSAGE_DIRECTIONS[message.type] !== 'DASHBOARD_TO_AGENT') {
      this.#rejectAndClose(socket, ERROR_CODES.VALIDATION_ERROR, 'Wrong message direction');
      return;
    }

    const state = this.#connections.get(socket);
    if (state === undefined) {
      this.#rejectAndClose(socket, ERROR_CODES.VALIDATION_ERROR, 'Unsupported message');
      return;
    }

    // REC-003: the attestation is the only way to unlock control, so it is handled before gating.
    if (message.type === 'auth') {
      void this.#handleAuth(socket, state, message.attestation);
      return;
    }

    // NFR-010: before authOk only `getState` and `paired` are served (besides `auth` above).
    if (!state.authenticated && message.type !== 'getState' && message.type !== 'paired') {
      if (CONTROL_MESSAGE_TYPES.has(message.type)) {
        this.#logger.warn('Refused a control message on an unauthenticated socket', {
          type: message.type,
        });
        this.#send(
          socket,
          buildFocusRejected(
            'UNAUTHENTICATED',
            'Attest this dashboard link before sending focus control messages.',
          ),
        );
        this.#invalidateAuthentication(socket, state, 'UNAUTHENTICATED');
        return;
      }
      this.#rejectAndClose(
        socket,
        ERROR_CODES.UNAUTHENTICATED,
        'Attestation required before this message',
      );
      return;
    }

    // T-080: a socket authenticated against a previous pairing is stale. Control messages are
    // refused (the device token that backed its attestation no longer exists) and the socket is
    // policy-closed so the dashboard performs a fresh handshake and re-attestation.
    if (CONTROL_MESSAGE_TYPES.has(message.type) && !this.#isCurrentBinding(state)) {
      this.#logger.warn('Refused a control message on a stale attested socket', {
        type: message.type,
      });
      this.#send(
        socket,
        buildFocusRejected(
          'UNAUTHENTICATED',
          'This dashboard link must attest again before sending focus control messages.',
        ),
      );
      this.#invalidateAuthentication(socket, state, 'STALE_ATTESTATION');
      return;
    }

    switch (message.type) {
      case 'getState': {
        const handlers = this.#options.controlHandlers;
        this.#send(
          socket,
          handlers === undefined ? buildState(this.#options.getSnapshot()) : handlers.getState(),
        );
        this.#options.onMessageHandled?.('getState');
        return;
      }
      case 'paired': {
        this.#options.onPaired?.();
        this.#send(socket, buildState(this.#options.getSnapshot()));
        this.#options.onMessageHandled?.('paired');
        return;
      }
      case 'listApps':
      case 'enterFocus':
      case 'exitFocus': {
        const handlers = this.#options.controlHandlers;
        if (handlers === undefined) {
          // Fail closed (W2 behaviour): authenticated, but this build has no focus wiring, so
          // never pretend a session started.
          this.#send(
            socket,
            buildFocusRejected(
              'INVALID',
              'Dashboard focus control is not enabled in this agent build yet.',
            ),
          );
          this.#options.onMessageHandled?.(message.type);
          return;
        }
        let pending: Promise<readonly LocalMessage[]>;
        if (message.type === 'enterFocus') pending = handlers.enterFocus(message);
        else if (message.type === 'exitFocus') pending = handlers.exitFocus(message);
        else pending = handlers.listApps();
        this.#runControl(socket, message.type, pending);
        return;
      }
      default: {
        this.#rejectAndClose(socket, ERROR_CODES.VALIDATION_ERROR, 'Unsupported message');
      }
    }
  }

  /** Awaits a control handler and sends its reply frames to the requesting socket only. */
  #runControl(
    socket: WebSocket,
    type: LocalMessageType,
    pending: Promise<readonly LocalMessage[]>,
  ): void {
    const generation = this.#connections.get(socket)?.generation ?? -1;
    void pending
      .then((messages) => {
        if (!this.#replyStillAuthorised(socket, generation)) return;
        for (const message of messages) this.#send(socket, message);
        this.#options.onMessageHandled?.(type);
      })
      .catch((error: unknown) => {
        this.#logger.error(
          'A local control handler rejected unexpectedly',
          error instanceof Error ? error.message : 'unknown error',
        );
        if (!this.#replyStillAuthorised(socket, generation)) return;
        this.#send(
          socket,
          buildFocusRejected('INVALID', 'That focus request could not be processed.'),
        );
        this.#options.onMessageHandled?.(type);
      });
  }

  /**
   * T-080: a slow control handler may finish after the socket closed, after the device was
   * unpaired, or after a re-pair changed the binding. In every one of those cases the reply would
   * be stale authority, so it is dropped instead of sent.
   */
  #replyStillAuthorised(socket: WebSocket, generation: number): boolean {
    const state = this.#connections.get(socket);
    if (state === undefined || state.generation !== generation || !this.#isCurrentBinding(state)) {
      this.#logger.warn('Dropped a control reply for a stale dashboard link');
      return false;
    }
    return socket.readyState === WebSocket.OPEN;
  }

  /**
   * Handshake steps 3–4. The nonce is consumed before verification (single use), the EdDSA JWT is
   * checked through the injected verifier, and a failure answers `authError` and closes.
   *
   * T-080 concurrency rules: exactly one verification may run per socket; a second `auth` frame
   * while the first is in flight is rejected (and invalidates the first); a result that arrives
   * after the socket closed, the device was unpaired or the pairing changed is dropped instead of
   * granting authority. This is what makes "duplicate concurrent auth attempts" and "stale
   * attestation after reconnect" fail closed.
   */
  async #handleAuth(socket: WebSocket, state: ConnectionState, token: string): Promise<void> {
    if (state.authenticated) {
      this.#logger.warn('Rejected a second auth frame on an authenticated socket');
      this.#send(
        socket,
        buildAuthError(
          ERROR_CODES.UNAUTHENTICATED,
          'This dashboard link is already authenticated.',
        ),
      );
      this.#invalidateAuthentication(socket, state, 'UNAUTHENTICATED');
      return;
    }

    if (state.authInFlight) {
      // One challenge → one attempt. Invalidate the first attempt so two concurrent verifications
      // can never both succeed and no late authOk can arrive on a socket we are closing.
      this.#logger.warn('Rejected a concurrent auth frame on the same challenge');
      this.#send(
        socket,
        buildAuthError(
          ERROR_CODES.UNAUTHENTICATED,
          'An attestation is already being verified for this dashboard link.',
        ),
      );
      this.#invalidateAuthentication(socket, state, 'UNAUTHENTICATED');
      return;
    }

    const nonce = state.nonce;
    if (nonce === null) {
      // No challenge outstanding: unpaired agent, or a replayed auth frame.
      this.#logger.warn('Rejected auth without an outstanding challenge');
      this.#send(
        socket,
        buildAuthError(
          ERROR_CODES.UNAUTHENTICATED,
          'No challenge is outstanding for this dashboard link.',
        ),
      );
      this.#invalidateAuthentication(socket, state, 'UNAUTHENTICATED');
      return;
    }
    // Single use: consume the nonce even if verification fails, so it can never be replayed.
    state.nonce = null;

    const verifier = this.#options.verifyAttestation;
    if (verifier === undefined) {
      this.#logger.warn('Received an attestation but no verifier is configured');
      this.#send(
        socket,
        buildAuthError(
          ERROR_CODES.UNAUTHENTICATED,
          'Attestation verification is not configured in this agent build.',
        ),
      );
      this.#invalidateAuthentication(socket, state, 'UNAUTHENTICATED');
      return;
    }

    state.authInFlight = true;
    const generation = state.generation;
    let result: AttestationVerification | undefined;
    try {
      result = await verifier({ token, nonce });
    } catch (error) {
      this.#logger.error(
        'Attestation verification failed unexpectedly',
        error instanceof Error ? error.message : 'unknown error',
      );
    } finally {
      state.authInFlight = false;
    }

    // The answer is only meaningful for the exact socket/pairing it was requested for.
    if (state.generation !== generation || socket.readyState !== WebSocket.OPEN) {
      this.#logger.warn('Dropped an attestation result for a socket that changed while verifying');
      return;
    }
    if (result === undefined) {
      this.#send(
        socket,
        buildAuthError(ERROR_CODES.UNAUTHENTICATED, 'The attestation could not be verified.'),
      );
      this.#invalidateAuthentication(socket, state, 'UNAUTHENTICATED');
      return;
    }

    if (!result.ok) {
      this.#logger.warn('Rejected an attestation', { reason: result.reason });
      this.#send(socket, buildAuthError(result.code, result.message));
      this.#invalidateAuthentication(socket, state, result.code);
      return;
    }

    // Re-check the live pairing: `revoked`/re-pair can land while the verifier awaits the key.
    const binding = this.#pairing();
    if (
      binding === null ||
      binding.deviceId !== result.deviceId ||
      binding.userId !== result.userId
    ) {
      this.#logger.warn('Rejected an attestation whose pairing changed while verifying');
      this.#send(
        socket,
        buildAuthError(
          ERROR_CODES.UNAUTHENTICATED,
          'The pairing changed while this attestation was verified; attest again.',
        ),
      );
      this.#invalidateAuthentication(socket, state, 'PAIRING_CHANGED');
      return;
    }

    state.authenticated = true;
    state.deviceId = result.deviceId;
    state.userId = result.userId;
    this.#logger.info('Dashboard link authenticated', { deviceId: result.deviceId });
    this.#send(socket, buildAuthOk(result.deviceId, result.userId));
  }

  #acceptWithinRateLimit(socket: WebSocket): boolean {
    const timestamps = this.#rateWindows.get(socket);
    if (timestamps === undefined) return false;
    const cutoff = Date.now() - 1000;
    while (timestamps.length > 0 && (timestamps[0] ?? Infinity) < cutoff) timestamps.shift();
    if (timestamps.length >= this.#maxMessagesPerSecond) return false;
    timestamps.push(Date.now());
    return true;
  }

  #rejectAndClose(socket: WebSocket, code: ErrorCode, message: string): void {
    this.#send(socket, buildAuthError(code, message));
    socket.close(1008, message);
  }

  #send(socket: WebSocket, message: LocalMessage): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }
}
