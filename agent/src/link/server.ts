// link/server.ts — the loopback WebSocket server for dashboard ↔ Focus Agent (T-031, §6.1).
// Binds 127.0.0.1 only and rejects upgrades whose Origin/Host/subprotocol fail, then speaks the
// frozen `focus.v1` protocol from `@focus-mode/shared`. It is deliberately Electron-free so the
// security checks can be tested with a real `ws` client.
// Attestation (challenge/auth/authOk) is W2/T-044: an `auth` frame currently fails closed with
// `authError UNAUTHENTICATED` — there is no faked authentication path in this build.

import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Duplex } from 'node:stream';
import type { AddressInfo } from 'node:net';
import {
  ERROR_CODES,
  LOCAL_MESSAGE_DIRECTIONS,
  UNAUTHENTICATED_INBOUND_TYPES,
  localMessageSchema,
  type ErrorCode,
  type LocalMessage,
} from '@focus-mode/shared';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { noopLogger, type Logger } from '../log.js';
import {
  buildAuthError,
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

export interface LinkAddress {
  readonly host: typeof LOOPBACK_HOST;
  readonly port: number;
}

export interface LinkServerOptions {
  /** `AGENT_PORT`; 0 asks the OS for an ephemeral port (tests only). */
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  readonly identity: AgentIdentity;
  readonly getSnapshot: () => LinkSnapshot;
  /** The `paired` frame is a nudge only; W2's cloud poll handler is wired here. */
  readonly onPaired?: () => void;
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
    this.#address = undefined;
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
    this.#rateWindows.set(socket, []);
    socket.on('message', (data, isBinary) => {
      this.#handleMessage(socket, data, isBinary);
    });
    socket.on('close', () => {
      this.#rateWindows.delete(socket);
    });
    socket.on('error', (error) => {
      this.#logger.warn('Link socket error', error.message);
    });

    const snapshot = this.#options.getSnapshot();
    this.#send(socket, buildHello(snapshot, this.#options.identity));
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

    // REC-003: before attestation only auth/getState/paired are accepted; everything else gets
    // UNAUTHENTICATED and the socket is closed. No control message is served in W1.
    if (!UNAUTHENTICATED_INBOUND_TYPES.includes(message.type)) {
      this.#rejectAndClose(
        socket,
        ERROR_CODES.UNAUTHENTICATED,
        'Attestation required before control messages (T-044)',
      );
      return;
    }

    switch (message.type) {
      case 'getState': {
        this.#send(socket, buildState(this.#options.getSnapshot()));
        return;
      }
      case 'paired': {
        this.#options.onPaired?.();
        this.#send(socket, buildState(this.#options.getSnapshot()));
        return;
      }
      case 'auth': {
        this.#handleAuth(socket);
        return;
      }
      default: {
        this.#rejectAndClose(socket, ERROR_CODES.VALIDATION_ERROR, 'Unsupported message');
      }
    }
  }

  /**
   * EXTENSION POINT — W2/T-044 owns attestation verification: fetch/cache
   * `GET /agent/attest-key`, verify the EdDSA JWT (nonce, aud=deviceId, sub=userId, 60 s TTL),
   * answer `authOk`, then gate enterFocus/exitFocus/listApps. Until then authentication is
   * unavailable and the socket fails closed; this is not a fake success path.
   */
  #handleAuth(socket: WebSocket): void {
    this.#logger.warn('Received auth frame but attestation is not enabled (T-044)');
    this.#send(
      socket,
      buildAuthError(
        ERROR_CODES.UNAUTHENTICATED,
        'Attestation verification is not enabled in this agent build (W2/T-044).',
      ),
    );
    socket.close(1008, 'UNAUTHENTICATED');
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
