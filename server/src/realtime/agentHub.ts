// server/src/realtime/agentHub.ts — the cloud ↔ Focus Agent WebSocket hub (T-041, TECHNICAL_DESIGN
// §6.3/§8). Why: one authoritative place authenticates a device token on the `/agent-link` upgrade,
// tracks live presence for the dashboard/scheduler, and keeps `Device.status`/`lastSeenAt` honest
// from 15 s heartbeats (DISCONNECTED after 45 s of silence). The socket carries presence only — no
// focus command ever originates here.
// Invariants: INV-2 — the private sender accepts only the `scheduleDue` | `revoked` union and every
// frame is built through its frozen shared schema; INV-6 — the agent may only report
// `{state, sessionId?}`, and unknown/strict-invalid frames close the socket. Tokens are handled as
// SHA-256 digests only and are never logged (SEC-6); a bad token upgrades and closes with the
// contract code 4401 because the Focus Agent must tell "revoked" apart from a transient retry
// (a pre-upgrade HTTP 401 would erase that distinction).

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  CLOUD_MESSAGE_DIRECTIONS,
  PROTOCOL_VERSION,
  cloudMessageSchema,
  revokedMessageSchema,
  scheduleDueMessageSchema,
  type AgentState,
  type DeviceStatus,
  type HeartbeatMessage,
  type RevokedMessage,
  type ScheduleDueMessage,
} from '@focus-mode/shared';
import { Types } from 'mongoose';
import type { Logger } from 'pino';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { logger as defaultLogger } from '../config/logger.js';
import { Device } from '../models/Device.js';

/** Path the Focus Agent appends to the API base (INTEGRATION_CONTRACTS §5.1). */
export const AGENT_LINK_PATH = '/agent-link';
/** The same socket as seen on the wire, because the API base includes `/api/v1` (DEC-013). */
export const AGENT_LINK_CONTRACT_PATH = '/api/v1/agent-link';

const AGENT_LINK_PATHS: ReadonlySet<string> = new Set([AGENT_LINK_PATH, AGENT_LINK_CONTRACT_PATH]);

/** Sweeper cadence; the agent pings every 15 s, so a missed sweep is still bounded by one tick. */
export const SWEEP_INTERVAL_MS = 15_000;
/** A device with no heartbeat for this long is stale (contract §5.1). */
export const HEARTBEAT_TIMEOUT_MS = 45_000;
/** Heartbeats are tiny; 16 KiB matches the local link cap and bounds the parse cost. */
export const MAX_AGENT_LINK_PAYLOAD_BYTES = 16 * 1024;
/** Contract §5.1: bad/revoked token → the Focus Agent returns to IDLE. */
export const AUTH_FAILURE_CLOSE_CODE = 4401;
/** Server-side 1001 "going away": the agent reconnects with its normal backoff. */
export const HEARTBEAT_TIMEOUT_CLOSE_CODE = 1001;

const DEVICE_TOKEN_MAX_LENGTH = 512;
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

/** Fields the scheduler supplies; the envelope (`v`, `id`, `type`) is added by the hub. */
export type ScheduleDuePayload = Omit<ScheduleDueMessage, 'v' | 'id' | 'type'>;

/** INV-2: the complete set of frames this module is able to emit. */
export type CloudToAgentMessage = ScheduleDueMessage | RevokedMessage;

/** Public, socket-free view of a live connection (safe to hand to routes/insights). */
export interface AgentPresence {
  readonly deviceId: string;
  readonly state: AgentState;
  readonly sessionId: string | null;
  /** Epoch milliseconds of the last accepted heartbeat (or of the connection itself). */
  readonly lastHeartbeatAt: number;
}

/** Internal presence entry: the socket is never exposed through the API. */
interface PresenceEntry {
  deviceId: string;
  socket: WebSocket;
  state: AgentState;
  sessionId: string | null;
  lastHeartbeatAt: number;
}

/** Test seams: injectable clock/intervals keep the 45 s timeout verifiable without waiting. */
export interface AgentHubOptions {
  readonly logger?: Logger;
  /** Epoch-millisecond clock (default `Date.now`). */
  readonly now?: () => number;
  readonly sweepIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
  readonly maxPayloadBytes?: number;
}

/** The typed hub API returned by `attachAgentHub` (the only way routes may reach a socket). */
export interface AgentHubApi {
  readonly connectionCount: number;
  /** INV-2: announces a due scheduled run; false when the device is offline/invalid. */
  sendScheduleDue(deviceId: string, payload: ScheduleDuePayload): boolean;
  /** INV-2: delivers `revoked`, drops presence, marks the device DISCONNECTED, closes 1000. */
  revokeDevice(deviceId: string): Promise<boolean>;
  getPresence(deviceId: string): AgentPresence | null;
  isDeviceConnected(deviceId: string): boolean;
  close(): Promise<void>;
}

/** SHA-256 hex of a device bearer token — the only representation stored or compared (SEC-6). */
export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Presence entries are keyed by canonical ObjectId hex (contract §1.3). */
function deviceKey(deviceId: string): string {
  return deviceId.toLowerCase();
}

function toObjectId(deviceId: string): Types.ObjectId | null {
  return OBJECT_ID_PATTERN.test(deviceId) ? new Types.ObjectId(deviceId) : null;
}

/** IDLE/PAIRED both mean "online, no focus session"; only FOCUSING is its own device status. */
function deviceStatusForAgentState(state: AgentState): DeviceStatus {
  return state === 'FOCUSING' ? 'FOCUSING' : 'CONNECTED';
}

function positiveNumber(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`agentHub: ${name} must be a positive number`);
  }
  return value;
}

/** `Authorization: Bearer <deviceToken>`; anything else is treated as missing (no fallbacks). */
function parseBearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim() ?? '';
  if (token.length === 0 || token.length > DEVICE_TOKEN_MAX_LENGTH) return null;
  return token;
}

/** ws hands us Buffer | ArrayBuffer | Buffer[]; normalise before UTF-8 decoding. */
function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

/** Complete an upgrade refusal without speaking WebSocket (used for 404/503 handshakes). */
function rejectUpgrade(socket: Duplex, statusCode: number, statusText: string): void {
  if (socket.destroyed) return;
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

/** One hub per API process. Created by `attachAgentHub`, never instantiated by request handlers. */
class AgentHub implements AgentHubApi {
  readonly #server: HttpServer;
  readonly #logger: Logger;
  readonly #now: () => number;
  readonly #sweepIntervalMs: number;
  readonly #heartbeatTimeoutMs: number;
  readonly #maxPayloadBytes: number;
  readonly #wss: WebSocketServer;
  readonly #presence = new Map<string, PresenceEntry>();
  /** Per-device write chain: an older CONNECTED write can never land after a newer FOCUSING one. */
  readonly #writes = new Map<string, Promise<void>>();

  #sweepTimer: NodeJS.Timeout | undefined;
  #sweeping = false;
  #closed = false;

  readonly #onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    void this.#authorize(request, socket, head).catch((error: unknown) => {
      this.#logger.error({ err: error }, 'agent-link upgrade failed');
      rejectUpgrade(socket, 500, 'Internal Server Error');
    });
  };

  constructor(server: HttpServer, options: AgentHubOptions = {}) {
    this.#server = server;
    this.#logger = options.logger ?? defaultLogger;
    this.#now = options.now ?? Date.now;
    this.#sweepIntervalMs = positiveNumber(
      options.sweepIntervalMs,
      SWEEP_INTERVAL_MS,
      'sweepIntervalMs',
    );
    this.#heartbeatTimeoutMs = positiveNumber(
      options.heartbeatTimeoutMs,
      HEARTBEAT_TIMEOUT_MS,
      'heartbeatTimeoutMs',
    );
    this.#maxPayloadBytes = positiveNumber(
      options.maxPayloadBytes,
      MAX_AGENT_LINK_PAYLOAD_BYTES,
      'maxPayloadBytes',
    );

    // noServer: the hub shares the Express HTTP server and only claims `/agent-link` upgrades.
    this.#wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
      maxPayload: this.#maxPayloadBytes,
    });
    this.#wss.on('error', (error: Error) => {
      this.#logger.error({ err: error }, 'agent-link WebSocket server error');
    });
    server.on('upgrade', this.#onUpgrade);
    this.#sweepTimer = setInterval(() => {
      this.#sweep();
    }, this.#sweepIntervalMs);
    // A hub must never keep a shutting-down process alive on its own.
    this.#sweepTimer.unref();
  }

  get connectionCount(): number {
    return this.#wss.clients.size;
  }

  sendScheduleDue(deviceId: string, payload: ScheduleDuePayload): boolean {
    const entry = this.#presence.get(deviceKey(deviceId));
    if (entry === undefined) return false;
    const parsed = scheduleDueMessageSchema.safeParse({
      v: PROTOCOL_VERSION,
      id: randomUUID(),
      type: 'scheduleDue',
      ...payload,
    });
    if (!parsed.success) {
      // Never queue or half-send: a malformed announcement is a bug in the caller, not a command.
      this.#logger.warn({ deviceId }, 'agent-link refused to send an invalid scheduleDue payload');
      return false;
    }
    return this.#send(entry.socket, parsed.data);
  }

  async revokeDevice(deviceId: string): Promise<boolean> {
    const key = deviceKey(deviceId);
    const entry = this.#presence.get(key);
    let delivered = false;

    if (entry !== undefined) {
      this.#presence.delete(key);
      const revoked = revokedMessageSchema.parse({
        v: PROTOCOL_VERSION,
        id: randomUUID(),
        type: 'revoked',
      });
      delivered = this.#send(entry.socket, revoked);
      entry.socket.close(1000, 'Device revoked');
      this.#logger.info({ deviceId }, 'agent-link device revoked');
    }

    // Authoritative even while offline: the agent must not keep a revoked token's presence.
    const updated = await this.#queueWrite(deviceId, 'DISCONNECTED');
    return delivered || updated;
  }

  getPresence(deviceId: string): AgentPresence | null {
    const entry = this.#presence.get(deviceKey(deviceId));
    if (entry === undefined) return null;
    return Object.freeze({
      deviceId: entry.deviceId,
      state: entry.state,
      sessionId: entry.sessionId,
      lastHeartbeatAt: entry.lastHeartbeatAt,
    });
  }

  isDeviceConnected(deviceId: string): boolean {
    const entry = this.#presence.get(deviceKey(deviceId));
    return entry !== undefined && entry.socket.readyState === WebSocket.OPEN;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;

    if (this.#sweepTimer !== undefined) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = undefined;
    }
    this.#server.off('upgrade', this.#onUpgrade);
    this.#presence.clear();
    for (const client of this.#wss.clients) client.terminate();
    await new Promise<void>((resolve) => {
      this.#wss.close(() => {
        resolve();
      });
    });
    // Let the final presence writes reach Mongo before server.ts disconnects the driver.
    await Promise.allSettled([...this.#writes.values()]);
    this.#logger.info('agent-link hub closed');
  }

  /** Authenticate the bearer token, then complete the upgrade (or refuse it). */
  async #authorize(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    socket.on('error', () => {
      socket.destroy();
    });

    if (this.#closed) {
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }

    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!AGENT_LINK_PATHS.has(url.pathname)) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }

    const token = parseBearerToken(request.headers.authorization);
    if (token === null) {
      this.#rejectUnauthorized(request, socket, head, 'missing device token');
      return;
    }

    let deviceId: string | null;
    try {
      deviceId = await this.#findDeviceId(token);
    } catch (error) {
      this.#logger.error({ err: error }, 'agent-link authentication lookup failed');
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }

    if (deviceId === null) {
      this.#rejectUnauthorized(request, socket, head, 'unknown or revoked device token');
      return;
    }
    if (this.#closed || socket.destroyed) return;

    this.#wss.handleUpgrade(request, socket, head, (webSocket) => {
      this.#register(deviceId, webSocket);
    });
  }

  /**
   * Contract §5.1: a rejected credential still upgrades, then closes 4401. No message handler or
   * presence entry is attached, so the socket cannot do anything before it is closed.
   */
  #rejectUnauthorized(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    reason: string,
  ): void {
    this.#logger.warn({ reason }, 'agent-link upgrade rejected');
    if (socket.destroyed) return;
    this.#wss.handleUpgrade(request, socket, head, (webSocket) => {
      webSocket.on('error', () => undefined);
      webSocket.close(AUTH_FAILURE_CLOSE_CODE, 'Unauthorized');
    });
  }

  /**
   * Find the device that owns this token. The partial index on `deviceTokenHash` narrows to one
   * candidate without ever sending the token to Mongo; the stored digest is then re-checked with
   * `timingSafeEqual` so no secret-derived string is ever compared with `===` (SEC-6).
   */
  async #findDeviceId(token: string): Promise<string | null> {
    const presentedHash = hashDeviceToken(token);
    const device = await Device.findOne({ deviceTokenHash: presentedHash }).select(
      '_id deviceTokenHash',
    );
    if (device === null || typeof device.deviceTokenHash !== 'string') return null;

    const stored = Buffer.from(device.deviceTokenHash.toLowerCase(), 'utf8');
    const presented = Buffer.from(presentedHash, 'utf8');
    if (stored.length !== presented.length || !timingSafeEqual(stored, presented)) return null;
    return String(device._id);
  }

  /** Newest connection wins: the previous socket is closed and its presence is superseded. */
  #register(deviceId: string, socket: WebSocket): void {
    const key = deviceKey(deviceId);
    const previous = this.#presence.get(key);
    const entry: PresenceEntry = {
      deviceId,
      socket,
      // Until the first heartbeat (agent cadence 15 s) the connection has not reported a state.
      state: 'IDLE',
      sessionId: null,
      lastHeartbeatAt: this.#now(),
    };
    this.#presence.set(key, entry);

    if (previous !== undefined && previous.socket !== socket) {
      previous.socket.close(1000, 'Replaced by a newer agent-link connection');
    }

    socket.on('error', (error: Error) => {
      this.#logger.warn({ err: error, deviceId }, 'agent-link socket error');
    });
    socket.on('message', (data: RawData, isBinary: boolean) => {
      void this.#handleMessage(entry, data, isBinary).catch((error: unknown) => {
        this.#logger.error({ err: error, deviceId }, 'agent-link message handling failed');
        socket.close(1011, 'Internal error');
      });
    });
    socket.on('close', () => {
      void this.#handleClose(entry).catch((error: unknown) => {
        this.#logger.error({ err: error, deviceId }, 'agent-link close handling failed');
      });
    });

    this.#logger.info({ deviceId }, 'Focus Agent connected to agent-link');
    void this.#queueWrite(deviceId, 'CONNECTED', entry.lastHeartbeatAt);
  }

  async #handleMessage(entry: PresenceEntry, data: RawData, isBinary: boolean): Promise<void> {
    // A superseded socket may still deliver buffered frames; ignore everything it says.
    if (this.#presence.get(deviceKey(entry.deviceId)) !== entry) return;

    if (isBinary) {
      entry.socket.close(1008, 'Binary frames are not allowed');
      return;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(toBuffer(data).toString('utf8'));
    } catch {
      entry.socket.close(1008, 'Malformed JSON frame');
      return;
    }

    const parsed = cloudMessageSchema.safeParse(parsedJson);
    if (!parsed.success) {
      entry.socket.close(1008, 'Unsupported message');
      return;
    }
    const message = parsed.data;

    if (CLOUD_MESSAGE_DIRECTIONS[message.type] !== 'AGENT_TO_CLOUD') {
      entry.socket.close(1008, 'Wrong message direction');
      return;
    }

    if (message.type !== 'heartbeat') {
      // session.started / session.ended belong to the reporting slice (T-045); this hub must not
      // fake persistence, so they are surfaced to the logger and otherwise left untouched.
      this.#logger.debug(
        { deviceId: entry.deviceId, type: message.type },
        'agent-link message type has no handler in this slice (T-045 owns session reporting)',
      );
      return;
    }

    await this.#applyHeartbeat(entry, message);
  }

  /** REC-001 presence: state/sessionId live in memory, status/lastSeenAt in Mongo. */
  async #applyHeartbeat(entry: PresenceEntry, message: HeartbeatMessage): Promise<void> {
    const now = this.#now();
    entry.state = message.state;
    entry.sessionId = message.sessionId ?? null;
    entry.lastHeartbeatAt = now;
    await this.#queueWrite(entry.deviceId, deviceStatusForAgentState(message.state), now);
  }

  async #handleClose(entry: PresenceEntry): Promise<void> {
    const key = deviceKey(entry.deviceId);
    if (this.#presence.get(key) !== entry) return;
    this.#presence.delete(key);
    this.#logger.info({ deviceId: entry.deviceId }, 'Focus Agent disconnected from agent-link');
    await this.#queueWrite(entry.deviceId, 'DISCONNECTED');
  }

  #sweep(): void {
    if (this.#closed || this.#sweeping) return;
    this.#sweeping = true;
    void this.#sweepStale()
      .catch((error: unknown) => {
        this.#logger.error({ err: error }, 'agent-link heartbeat sweep failed');
      })
      .finally(() => {
        this.#sweeping = false;
      });
  }

  async #sweepStale(): Promise<void> {
    const now = this.#now();
    // Snapshot first: deleting while iterating a Map is legal but hides concurrent registrations.
    for (const [key, entry] of [...this.#presence]) {
      if (now - entry.lastHeartbeatAt <= this.#heartbeatTimeoutMs) continue;
      if (this.#presence.get(key) !== entry) continue;

      this.#presence.delete(key);
      entry.socket.close(HEARTBEAT_TIMEOUT_CLOSE_CODE, 'Heartbeat timeout');
      this.#logger.warn(
        { deviceId: entry.deviceId, heartbeatTimeoutMs: this.#heartbeatTimeoutMs },
        'agent-link heartbeat timed out — device marked DISCONNECTED',
      );
      await this.#queueWrite(entry.deviceId, 'DISCONNECTED');
    }
  }

  /**
   * Serialise status writes per device. Heartbeats and connection bookkeeping race otherwise: a
   * slow CONNECTED write could overwrite the FOCUSING status of a heartbeat that arrived after it.
   */
  #queueWrite(deviceId: string, status: DeviceStatus, lastSeenAtMs?: number): Promise<boolean> {
    const key = deviceKey(deviceId);
    const previous = this.#writes.get(key) ?? Promise.resolve();
    const run = previous.then(async (): Promise<boolean> => {
      const objectId = toObjectId(deviceId);
      if (objectId === null) return false;
      const update: { status: DeviceStatus; lastSeenAt?: Date } = { status };
      if (lastSeenAtMs !== undefined) update.lastSeenAt = new Date(lastSeenAtMs);
      try {
        const result = await Device.updateOne({ _id: objectId }, update);
        return result.matchedCount > 0;
      } catch (error) {
        this.#logger.error({ err: error, deviceId }, 'agent-link device presence update failed');
        return false;
      }
    });

    // The stored chain must never reject, so a failed write cannot poison later ones.
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.#writes.set(key, settled);
    void settled.finally(() => {
      if (this.#writes.get(key) === settled) this.#writes.delete(key);
    });
    return run;
  }

  /** INV-2 enforced twice: the parameter type is the two-message union, the caller validated it. */
  #send(socket: WebSocket, message: CloudToAgentMessage): boolean {
    if (socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.#logger.warn({ err: error }, 'agent-link send failed');
      return false;
    }
  }
}

let activeHub: AgentHubApi | null = null;

/** Create and attach the process-wide hub; call once from the bootstrap after `listen`. */
export function attachAgentHub(server: HttpServer, options: AgentHubOptions = {}): AgentHubApi {
  if (activeHub !== null) {
    throw new Error('The agent-link hub is already attached in this process');
  }
  activeHub = new AgentHub(server, options);
  return activeHub;
}

/** INV-2: announce a due schedule; false when the device is offline or the payload is invalid. */
export function sendScheduleDue(deviceId: string, payload: ScheduleDuePayload): boolean {
  return activeHub?.sendScheduleDue(deviceId, payload) ?? false;
}

/** INV-2: revoke a paired device. The exact signature T-040's DELETE /devices/:id imports. */
export async function revokeDevice(deviceId: string): Promise<boolean> {
  return activeHub === null ? false : activeHub.revokeDevice(deviceId);
}

/** Live presence snapshot for the dashboard/insights routes, or null when offline. */
export function getPresence(deviceId: string): AgentPresence | null {
  return activeHub?.getPresence(deviceId) ?? null;
}

/** Presence predicate the scheduler uses before any `scheduleDue` (never queues commands). */
export function isDeviceConnected(deviceId: string): boolean {
  return activeHub?.isDeviceConnected(deviceId) ?? false;
}

/** Stop the sweeper, drop presence, terminate sockets; safe before/after attach and repeated. */
export async function closeAgentHub(): Promise<void> {
  const hub = activeHub;
  activeHub = null;
  if (hub !== null) await hub.close();
}
