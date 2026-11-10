// cloud/client.ts — the Focus Agent's outbound cloud client (T-042, REC-001/REC-002).
// Unpaired: generate the 6-digit code (agent UI only) → register only its DEC-014 digest → poll
// for the device token with backoff → PAIRED. Paired: open `/agent-link` with the device token,
// heartbeat every 15 s, reconnect 1→30 s. INV-2 is structural: `scheduleDue` is announced to a
// callback and never turned into a session by this module, and `revoked` restores first, then
// returns the agent to IDLE and starts a fresh unpaired flow.

import { hostname } from 'node:os';
import type {
  AgentState,
  CloudMessage,
  EndReason,
  OsName,
  ScheduleDueMessage,
} from '@focus-mode/shared';
import { noopLogger, type Logger } from '../log.js';
import { generatePairingCode, pairCodeLogLabel, type PairingCode } from '../pairing.js';
import {
  Backoff,
  createPollWaiter,
  pollEnrollment,
  type BackoffOptions,
  type PollWaiter,
} from './poll.js';
import {
  deviceNameFromHostname,
  registerDevice,
  PairingCodeCollisionError,
  type DeviceRegistration,
} from './register.js';
import { CloudLinkSocket } from './socket.js';
import type { CredentialStore, DeviceCredentials } from './storage.js';

/** The slice of `FocusController` the cloud client may use. No focus can be started from here. */
export interface CloudAgentController {
  getState(): {
    readonly state: AgentState;
    readonly session?: { readonly sessionId: string };
  };
  markPaired(): void;
  markUnpaired(): void;
  exitFocus(reason: EndReason): Promise<unknown>;
}

/** What the agent window/tray/link may ask the cloud client (INV-5: state is agent truth). */
export interface CloudState {
  readonly state: AgentState;
  readonly paired: boolean;
  /** True while the authenticated `/agent-link` WebSocket is open. */
  readonly connected: boolean;
  readonly deviceId: string | null;
  readonly userId: string | null;
  /** Present only while unpaired; rendered in the agent window and never put on any wire. */
  readonly pairingCode: string | null;
  readonly pairingExpiresAt: string | null;
}

export interface CloudEventMap {
  readonly paired: { readonly deviceId: string; readonly userId: string };
  readonly revoked: { readonly reason: 'REVOKED' | 'TOKEN_INVALID' };
  readonly scheduleDue: ScheduleDueMessage;
}

export type CloudEventName = keyof CloudEventMap;

export interface CloudClientOptions {
  /** Full API base including `/api/v1` (DEC-013). */
  readonly baseUrl: string;
  readonly agentVersion: string;
  /** Optional override; defaults to the sanitised hostname (contract C-06). */
  readonly deviceName?: string;
  readonly os: OsName;
  readonly controller: CloudAgentController;
  readonly store: CredentialStore;
  readonly logger?: Logger;
  readonly now?: () => Date;
  /** Jitter source for backoff; injectable for deterministic tests. */
  readonly random?: () => number;
  readonly fetchImpl?: typeof fetch;
  readonly requestTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly pollBackoff?: Partial<BackoffOptions>;
  readonly registerBackoff?: Partial<BackoffOptions>;
  readonly reconnectBackoff?: Partial<BackoffOptions>;
}

interface PendingEnrollment {
  readonly code: PairingCode;
  readonly deviceId: string;
  readonly enrollSecret: string;
}

type AnyCloudListener = (payload: never) => void;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/**
 * Pairing + presence. One instance per agent process; `start()` is idempotent and `stop()` is
 * final (a restart needs a new instance, which is what main.ts does at app start).
 */
export class CloudClient {
  readonly #options: CloudClientOptions;
  readonly #logger: Logger;
  readonly #now: () => Date;
  readonly #random: () => number;
  readonly #controller: CloudAgentController;
  readonly #store: CredentialStore;
  readonly #listeners = new Map<CloudEventName, Set<AnyCloudListener>>();

  #started = false;
  #stopped = true;
  #flowId = 0;
  #abort: AbortController | undefined;
  #waiter: PollWaiter | undefined;
  #currentCode: PairingCode | undefined;
  #pending: PendingEnrollment | undefined;
  #credentials: DeviceCredentials | undefined;
  #socket: CloudLinkSocket | undefined;
  #connected = false;
  #revoking: Promise<void> | undefined;

  constructor(options: CloudClientOptions) {
    this.#options = options;
    this.#logger = options.logger ?? noopLogger;
    this.#now = options.now ?? (() => new Date());
    this.#random = options.random ?? Math.random;
    this.#controller = options.controller;
    this.#store = options.store;
  }

  // -------------------------------------------------------------------------
  // Public API (used by main.ts)
  // -------------------------------------------------------------------------

  /** Restores a stored pairing or starts the unpaired register/poll flow. Never throws on I/O. */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#stopped = false;
    this.#abort = new AbortController();
    this.#waiter = createPollWaiter(this.#abort.signal);

    const stored = await this.#store.load();
    if (this.#stopped) return;
    if (stored !== null) {
      this.#logger.info('Restored a paired device from secure storage');
      await this.#enterPaired(stored, true);
      return;
    }
    this.#beginUnpaired();
  }

  /** Closes the cloud link and stops polling. The stored pairing is kept for the next start. */
  async stop(): Promise<void> {
    if (!this.#started || this.#stopped) return;
    this.#stopped = true;
    this.#flowId += 1;
    this.#abort?.abort();
    this.#abort = undefined;
    this.#waiter?.wake();
    this.#waiter = undefined;
    this.#socket?.stop();
    this.#socket = undefined;
    this.#connected = false;
    this.#currentCode = undefined;
    this.#pending = undefined;
    this.#credentials = undefined;
    const revoking = this.#revoking;
    if (revoking !== undefined) await revoking.catch(() => undefined);
  }

  /** Snapshot for the tray, agent window and link snapshot (never includes the device token). */
  getState(): CloudState {
    const snapshot = this.#controller.getState();
    const credentials = this.#credentials;
    const pending = this.#pending;
    const code = this.#currentCode;
    return {
      state: snapshot.state,
      paired: credentials !== undefined,
      connected: this.#connected,
      deviceId: credentials?.deviceId ?? pending?.deviceId ?? null,
      userId: credentials?.userId ?? null,
      pairingCode: credentials === undefined ? (code?.value ?? null) : null,
      pairingExpiresAt: credentials === undefined ? (code?.expiresAt.toISOString() ?? null) : null,
    };
  }

  /** The cloud device/user pair used to bind attestations (null while unpaired). */
  getPairing(): { readonly deviceId: string; readonly userId: string } | null {
    const credentials = this.#credentials;
    if (credentials === undefined) return null;
    return { deviceId: credentials.deviceId, userId: credentials.userId };
  }

  /** Dashboard `paired` nudge: harmless, triggers one immediate poll (contract §5.1 step 4). */
  notifyPairedNudge(): void {
    if (this.#stopped || this.#credentials !== undefined || this.#waiter === undefined) return;
    this.#logger.info('Dashboard reported pairing; polling the cloud immediately');
    this.#waiter.wake();
  }

  /** Typed subscription used by main.ts; returns an unsubscribe function. */
  on<K extends CloudEventName>(
    event: K,
    listener: (payload: CloudEventMap[K]) => void,
  ): () => void {
    const set = this.#listeners.get(event) ?? new Set<AnyCloudListener>();
    set.add(listener);
    this.#listeners.set(event, set);
    return () => {
      set.delete(listener);
    };
  }

  // -------------------------------------------------------------------------
  // Unpaired flow
  // -------------------------------------------------------------------------

  #isCurrent(flowId: number): boolean {
    return this.#started && !this.#stopped && flowId === this.#flowId;
  }

  #beginUnpaired(): void {
    if (this.#stopped) return;
    const flowId = this.#flowId + 1;
    this.#flowId = flowId;
    const code = generatePairingCode(this.#now());
    this.#currentCode = code;
    this.#pending = undefined;
    // Presence only: the digits must never reach the log or the wire (DEC-003).
    this.#logger.debug(pairCodeLogLabel(code));
    this.#logger.info('Requesting a fresh pairing code from the cloud');
    void this.#registerAndPoll(flowId, code).catch((error: unknown) => {
      if (!this.#isCurrent(flowId)) return;
      this.#logger.error('Pairing flow stopped unexpectedly', describeError(error));
    });
  }

  async #registerAndPoll(flowId: number, code: PairingCode): Promise<void> {
    const registration = await this.#registerWithRetry(flowId, code);
    if (registration === null || !this.#isCurrent(flowId)) return;

    this.#pending = {
      code,
      deviceId: registration.deviceId,
      enrollSecret: registration.enrollSecret,
    };
    this.#logger.info('Pairing code is ready; waiting for the user to enter it on the dashboard');

    const result = await pollEnrollment({
      baseUrl: this.#options.baseUrl,
      deviceId: registration.deviceId,
      enrollSecret: registration.enrollSecret,
      deadline: code.expiresAt,
      now: this.#now,
      ...(this.#options.fetchImpl === undefined ? {} : { fetchImpl: this.#options.fetchImpl }),
      ...(this.#options.requestTimeoutMs === undefined
        ? {}
        : { timeoutMs: this.#options.requestTimeoutMs }),
      ...(this.#options.pollBackoff === undefined ? {} : { backoff: this.#options.pollBackoff }),
      ...(this.#waiter === undefined ? {} : { waiter: this.#waiter }),
      logger: this.#logger,
    });

    if (!this.#isCurrent(flowId)) return;

    if (result.kind === 'paired') {
      this.#pending = undefined;
      this.#currentCode = undefined;
      await this.#enterPaired(result.credentials, false);
      return;
    }
    if (result.kind === 'expired') {
      this.#logger.warn('Enrollment ended without pairing; rotating the pairing code', {
        reason: result.reason,
        detail: result.detail,
      });
      this.#beginUnpaired();
    }
    // `aborted` means stop() was called; nothing to do.
  }

  async #registerWithRetry(flowId: number, code: PairingCode): Promise<DeviceRegistration | null> {
    const waiter = this.#waiter;
    if (waiter === undefined) return null;
    const backoff = new Backoff({
      initialMs: 1_000,
      maxMs: 30_000,
      factor: 2,
      jitterRatio: 0.2,
      random: this.#random,
      ...this.#options.registerBackoff,
    });

    for (;;) {
      if (!this.#isCurrent(flowId)) return null;
      try {
        return await registerDevice({
          baseUrl: this.#options.baseUrl,
          code: code.value,
          os: this.#options.os,
          name: this.#name(),
          agentVersion: this.#options.agentVersion,
          ...(this.#options.fetchImpl === undefined ? {} : { fetchImpl: this.#options.fetchImpl }),
          ...(this.#options.requestTimeoutMs === undefined
            ? {}
            : { timeoutMs: this.#options.requestTimeoutMs }),
          logger: this.#logger,
        });
      } catch (error) {
        if (error instanceof PairingCodeCollisionError) {
          this.#logger.warn(
            'Pairing code digest collided with a pending device; rotating the code',
          );
          await waiter.wait(backoff.nextDelayMs());
          if (this.#isCurrent(flowId)) this.#beginUnpaired();
          return null;
        }
        this.#logger.warn('Agent registration failed; retrying with backoff', describeError(error));
        await waiter.wait(backoff.nextDelayMs());
      }
    }
  }

  #name(): string {
    return this.#options.deviceName ?? deviceNameFromHostname(hostname());
  }

  // -------------------------------------------------------------------------
  // Paired flow
  // -------------------------------------------------------------------------

  async #enterPaired(credentials: DeviceCredentials, restored: boolean): Promise<void> {
    if (this.#stopped) return;
    this.#credentials = credentials;
    this.#currentCode = undefined;
    this.#pending = undefined;

    // Persisting the token can wait on the OS keychain, so it never delays the honest PAIRED
    // state or the cloud link; the await at the end still guarantees durability before start()
    // treats the restored pairing as complete. A failure never falls back to plaintext.
    const persisted = restored
      ? Promise.resolve()
      : this.#store.save(credentials).catch((error: unknown) => {
          this.#logger.error('Could not persist the device token securely', describeError(error));
        });

    this.#controller.markPaired();
    this.#logger.info(
      restored
        ? 'Focus Agent paired (restored from secure storage)'
        : 'Focus Agent paired with the cloud',
    );
    this.#emit('paired', { deviceId: credentials.deviceId, userId: credentials.userId });
    this.#openSocket(credentials);
    await persisted;
  }

  #openSocket(credentials: DeviceCredentials): void {
    this.#socket?.stop();
    const socket = new CloudLinkSocket({
      baseUrl: this.#options.baseUrl,
      deviceToken: credentials.deviceToken,
      getHeartbeat: () => {
        const snapshot = this.#controller.getState();
        return {
          state: snapshot.state,
          ...(snapshot.session === undefined ? {} : { sessionId: snapshot.session.sessionId }),
        };
      },
      onMessage: (message) => this.#handleCloudMessage(message),
      onOpen: () => {
        this.#connected = true;
      },
      onClose: (info) => {
        this.#connected = false;
        if (!info.tokenRejected) {
          this.#logger.warn('Cloud link closed; the reconnect loop owns recovery', {
            code: info.code,
          });
        }
      },
      onTokenRejected: () => {
        void this.#handleRevoked('TOKEN_INVALID');
      },
      logger: this.#logger,
      ...(this.#options.heartbeatIntervalMs === undefined
        ? {}
        : { heartbeatIntervalMs: this.#options.heartbeatIntervalMs }),
      ...(this.#options.reconnectBackoff === undefined
        ? {}
        : { reconnect: this.#options.reconnectBackoff }),
    });
    this.#socket = socket;
    socket.start();
  }

  #handleCloudMessage(message: CloudMessage): void {
    switch (message.type) {
      case 'scheduleDue': {
        // INV-2: this is an announcement. No session is started here; W4 owns the local
        // heads-up + consent path and consumes this typed event.
        this.#logger.info(
          'Cloud announced a due schedule; forwarding to the local heads-up handler (no focus started)',
          {
            runId: message.runId,
            scheduleId: message.scheduleId,
            durationMin: message.durationMin,
          },
        );
        this.#emit('scheduleDue', message);
        return;
      }
      case 'revoked': {
        void this.#handleRevoked('REVOKED');
        return;
      }
      default: {
        this.#logger.warn('Ignored a cloud message outside the INV-2 whitelist', {
          type: message.type,
        });
      }
    }
  }

  /**
   * `revoked` / 4401: restore first when FOCUSING (INV-5), drop the token, return to IDLE and
   * resume the unpaired flow. Idempotent while a revocation is being processed.
   */
  #handleRevoked(reason: 'REVOKED' | 'TOKEN_INVALID'): Promise<void> {
    if (this.#revoking !== undefined) return this.#revoking;
    const run = this.#performRevoked(reason).finally(() => {
      this.#revoking = undefined;
    });
    this.#revoking = run;
    return run;
  }

  async #performRevoked(reason: 'REVOKED' | 'TOKEN_INVALID'): Promise<void> {
    this.#logger.warn('Cloud pairing revoked; restoring any focus before returning to IDLE', {
      reason,
    });
    try {
      if (this.#controller.getState().state === 'FOCUSING') {
        await this.#controller.exitFocus('UNPAIRED');
      }
    } catch (error) {
      // The journal is kept by the controller, so the next start still recovers (INV-4/INV-5).
      this.#logger.error(
        'Restore before unpair failed; the focus journal is kept for recovery',
        describeError(error),
      );
    }

    this.#socket?.stop();
    this.#socket = undefined;
    this.#connected = false;

    try {
      await this.#store.clear();
    } catch (error) {
      this.#logger.warn('Could not delete the stored device token', describeError(error));
    }
    this.#credentials = undefined;
    this.#pending = undefined;
    this.#currentCode = undefined;

    try {
      this.#controller.markUnpaired();
    } catch (error) {
      this.#logger.error(
        'Could not mark the agent IDLE after revocation (focus may still be restoring)',
        describeError(error),
      );
    }

    this.#emit('revoked', { reason });
    if (!this.#stopped) this.#beginUnpaired();
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  #emit<K extends CloudEventName>(event: K, payload: CloudEventMap[K]): void {
    const set = this.#listeners.get(event);
    if (set === undefined) return;
    for (const listener of set) {
      // Stored as `(payload: never) => void` to keep the map key-agnostic; the listener was
      // registered for exactly this event, so the payload type is correct by construction.
      listener(payload as never);
    }
  }
}
