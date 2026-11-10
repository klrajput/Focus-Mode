// cloud/socket.ts — the outbound `/agent-link` WebSocket to the cloud API (T-042, §5.1/§6.3).
// The upgrade carries `Authorization: Bearer <deviceToken>` (agent-only; browsers cannot set WS
// headers), presence is a `heartbeat` every 15 s and reconnects use exponential backoff 1→30 s
// with jitter. INV-2 is enforced here: only `scheduleDue` and `revoked` are ever delivered
// inbound; anything else (including agent→cloud messages echoed by a hostile/buggy server) is
// logged and dropped, never acted on.

import type { ClientRequest, IncomingMessage } from 'node:http';
import {
  CLOUD_MESSAGE_DIRECTIONS,
  cloudMessageSchema,
  heartbeatMessageSchema,
  type AgentState,
  type CloudMessage,
} from '@focus-mode/shared';
import { WebSocket, type RawData } from 'ws';
import { noopLogger, type Logger } from '../log.js';
import { nextCloudMessageId } from './message-id.js';
import { agentLinkUrl } from './transport.js';
import { Backoff, type BackoffOptions } from './poll.js';

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
export const DEFAULT_RECONNECT: BackoffOptions = Object.freeze({
  initialMs: 1_000,
  maxMs: 30_000,
  factor: 2,
  jitterRatio: 0.2,
});
/** Contract §5.1: a revoked/invalid device token is closed with this application code. */
export const DEVICE_TOKEN_REVOKED_CLOSE_CODE = 4401;
const HANDSHAKE_TIMEOUT_MS = 10_000;

export interface CloudSocketHeartbeat {
  readonly state: AgentState;
  readonly sessionId?: string;
}

export interface CloudSocketCloseInfo {
  readonly code: number;
  readonly reason: string;
  /** True when the cloud refused our credential (4401 or a 401/403 upgrade). */
  readonly tokenRejected: boolean;
}

export interface CloudLinkSocketOptions {
  readonly baseUrl: string;
  readonly deviceToken: string;
  readonly getHeartbeat: () => CloudSocketHeartbeat;
  /** Called for every valid cloud→agent message; INV-2 filtering already happened. */
  readonly onMessage: (message: CloudMessage) => void;
  readonly onOpen?: () => void;
  readonly onClose?: (info: CloudSocketCloseInfo) => void;
  /** Terminal: stop reconnecting and go back through the pairing flow. */
  readonly onTokenRejected?: () => void;
  readonly logger?: Logger;
  readonly heartbeatIntervalMs?: number;
  readonly reconnect?: Partial<BackoffOptions>;
}

function toText(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

/**
 * One outbound cloud socket. It owns its reconnect loop; the caller only has to `stop()` it.
 * The device token is never logged — only the connected/disconnected transitions are.
 */
export class CloudLinkSocket {
  readonly #options: CloudLinkSocketOptions;
  readonly #logger: Logger;
  readonly #url: string;
  readonly #backoff: Backoff;
  readonly #heartbeatIntervalMs: number;

  #socket: WebSocket | undefined;
  #heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;
  #tokenRejected = false;
  #connected = false;

  constructor(options: CloudLinkSocketOptions) {
    this.#options = options;
    this.#logger = options.logger ?? noopLogger;
    this.#url = agentLinkUrl(options.baseUrl);
    this.#heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.#backoff = new Backoff({ ...DEFAULT_RECONNECT, ...options.reconnect });
  }

  get connected(): boolean {
    return this.#connected;
  }

  /** Exposed for tests/logging; the token itself is never part of it. */
  get url(): string {
    return this.#url;
  }

  start(): void {
    if (this.#socket !== undefined || this.#reconnectTimer !== undefined) return;
    this.#stopped = false;
    this.#connect();
  }

  /**
   * Sends one agent → cloud frame (session reports, `scheduleRunCancelled`). Returns `false` when
   * the link is not open, so the caller can queue the report instead of losing it silently. A
   * cloud → agent type is refused here as well as on the inbound path (INV-2 is symmetric).
   */
  send(message: CloudMessage): boolean {
    const socket = this.#socket;
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) return false;
    if (CLOUD_MESSAGE_DIRECTIONS[message.type] !== 'AGENT_TO_CLOUD') {
      this.#logger.warn('Refused to send a cloud→agent message back to the cloud (INV-2)', {
        type: message.type,
      });
      return false;
    }
    socket.send(JSON.stringify(message));
    return true;
  }

  stop(): void {
    this.#stopped = true;
    this.#clearHeartbeat();
    this.#clearReconnect();
    const socket = this.#socket;
    this.#socket = undefined;
    this.#connected = false;
    if (socket !== undefined) {
      // Detach first: `stop()` is deliberate, so no reconnect/close handling may run afterwards.
      socket.removeAllListeners();
      socket.on('error', () => undefined);
      try {
        socket.terminate();
      } catch {
        // Already closed.
      }
    }
  }

  #connect(): void {
    if (this.#stopped || this.#tokenRejected) return;

    const socket = new WebSocket(this.#url, {
      headers: { Authorization: `Bearer ${this.#options.deviceToken}` },
      handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
      perMessageDeflate: false,
      maxPayload: 64 * 1024,
    });
    this.#socket = socket;

    socket.once('open', () => {
      if (this.#socket !== socket || this.#stopped) return;
      this.#backoff.reset();
      this.#connected = true;
      this.#logger.info('Cloud link connected');
      this.#sendHeartbeat();
      this.#heartbeatTimer = setInterval(() => this.#sendHeartbeat(), this.#heartbeatIntervalMs);
      this.#options.onOpen?.();
    });

    socket.on('message', (data: RawData, isBinary: boolean) => {
      this.#handleFrame(data, isBinary);
    });

    socket.once('unexpected-response', (_request: ClientRequest, response: IncomingMessage) => {
      response.resume();
      const status = response.statusCode ?? 0;
      if (status === 401 || status === 403) {
        this.#rejectToken(`upgrade rejected with HTTP ${status}`);
        return;
      }
      this.#logger.warn('Cloud link upgrade was refused; retrying with backoff', { status });
      this.#scheduleReconnect();
    });

    socket.on('error', (error: Error) => {
      // `close` always follows; the reconnect decision lives there (avoid double scheduling).
      this.#logger.debug('Cloud link socket error', error.message);
    });

    socket.once('close', (code: number, reason: Buffer) => {
      if (this.#socket !== socket) return;
      this.#socket = undefined;
      this.#connected = false;
      this.#clearHeartbeat();
      const closeReason = reason.toString('utf8');
      if (this.#stopped) return;
      if (code === DEVICE_TOKEN_REVOKED_CLOSE_CODE) {
        this.#rejectToken('device token revoked (close code 4401)');
        return;
      }
      this.#logger.warn('Cloud link disconnected; reconnecting with backoff', {
        code,
        reason: closeReason,
      });
      this.#options.onClose?.({ code, reason: closeReason, tokenRejected: false });
      this.#scheduleReconnect();
    });
  }

  #rejectToken(detail: string): void {
    if (this.#tokenRejected) return;
    this.#tokenRejected = true;
    this.#stopped = true;
    this.#connected = false;
    this.#clearHeartbeat();
    this.#clearReconnect();
    this.#logger.warn('Cloud refused this device token; returning to the unpaired flow', {
      detail,
    });
    this.#options.onTokenRejected?.();
    this.#options.onClose?.({
      code: DEVICE_TOKEN_REVOKED_CLOSE_CODE,
      reason: detail,
      tokenRejected: true,
    });
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#tokenRejected || this.#reconnectTimer !== undefined) return;
    const delayMs = this.#backoff.nextDelayMs();
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      this.#connect();
    }, delayMs);
  }

  #clearReconnect(): void {
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
  }

  #clearHeartbeat(): void {
    if (this.#heartbeatTimer !== undefined) clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = undefined;
  }

  #sendHeartbeat(): void {
    const socket = this.#socket;
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) return;
    const beat = this.#options.getHeartbeat();
    const message = heartbeatMessageSchema.parse({
      v: 1,
      id: nextCloudMessageId(),
      type: 'heartbeat',
      state: beat.state,
      ...(beat.sessionId === undefined ? {} : { sessionId: beat.sessionId }),
    });
    socket.send(JSON.stringify(message));
  }

  #handleFrame(data: RawData, isBinary: boolean): void {
    if (isBinary) {
      this.#logger.warn('Ignored a binary frame from the cloud link (JSON only)');
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(toText(data));
    } catch {
      this.#logger.warn('Ignored a malformed frame from the cloud link');
      return;
    }

    const parsed = cloudMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      // INV-2: an unknown or non-cloud message is never interpreted, not even partially.
      this.#logger.warn('Ignored a message from the cloud that is not in the frozen protocol');
      return;
    }
    const message: CloudMessage = parsed.data;
    if (CLOUD_MESSAGE_DIRECTIONS[message.type] !== 'CLOUD_TO_AGENT') {
      // A cloud server echoing agent→cloud messages must not be able to fake presence.
      this.#logger.warn('Ignored an agent→cloud message sent by the cloud (INV-2)', {
        type: message.type,
      });
      return;
    }
    this.#options.onMessage(message);
  }
}
