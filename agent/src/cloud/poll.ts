// cloud/poll.ts — enrollment polling with bounded exponential backoff and jitter (T-042, §5.1).
// After `/agent/register` the Focus Agent polls `/agent/enroll/poll` until the cloud reports the
// device paired, the enrollment is consumed/expired, or the 10-minute code TTL runs out. Every
// response is classified explicitly: an unknown status can never be mistaken for a pairing and a
// still-valid code is never rotated because of a network blip.

import { objectIdSchema } from '@focus-mode/shared';
import { z } from 'zod';
import { noopLogger, type Logger } from '../log.js';
import { apiUrl, postJson, type CloudHttpResponse } from './transport.js';
import type { DeviceCredentials } from './storage.js';

export const AGENT_ENROLL_POLL_PATH = '/agent/enroll/poll';

/** `POST /agent/enroll/poll` success data (hand-typed until contracts-v1.1 adds responses). */
const enrollmentDataSchema = z.strictObject({
  deviceToken: z.string().min(32).max(512),
  userId: objectIdSchema,
  allowListVersion: z.number().int().min(0).default(0),
});

export interface EnrolledDevice {
  readonly deviceToken: string;
  readonly userId: string;
  readonly allowListVersion: number;
}

/** What one poll response means. `pending` is the only retryable outcome. */
export type PollOutcome =
  | { readonly kind: 'paired'; readonly device: EnrolledDevice }
  | { readonly kind: 'pending'; readonly note: string }
  | {
      readonly kind: 'terminal';
      readonly reason: 'EXPIRED' | 'CONSUMED' | 'REJECTED';
      readonly detail: string;
    };

/**
 * Classifies one poll response.
 *
 * Contract gaps handled conservatively (reported to A2/A5):
 * - a pending enrollment has no frozen status, so `200` without a token, `202`, `204` and `404`
 *   are all treated as pending and retried until the code TTL — retrying is safe, while rotating a
 *   still-valid code would strand the device the user just paired;
 * - `409` (another consumer) and `410 PAIRING_EXPIRED` are terminal, `400/401/403` are terminal
 *   because retrying a rejected secret cannot succeed;
 * - `429` and `5xx` are retryable and keep the same code.
 */
export function classifyEnrollPoll(status: number, body: unknown): PollOutcome {
  if (status === 200) {
    const parsed = enrollmentDataSchema.safeParse(readEnvelopeData(body));
    if (parsed.success) {
      return {
        kind: 'paired',
        device: {
          deviceToken: parsed.data.deviceToken,
          userId: parsed.data.userId,
          allowListVersion: parsed.data.allowListVersion,
        },
      };
    }
    return { kind: 'pending', note: 'the cloud has not completed pairing yet' };
  }
  if (status === 409) {
    return {
      kind: 'terminal',
      reason: 'CONSUMED',
      detail: 'The enrollment was already consumed; a new pairing code is required.',
    };
  }
  if (status === 410) {
    return {
      kind: 'terminal',
      reason: 'EXPIRED',
      detail: 'The pairing code expired or was invalidated; a new pairing code is required.',
    };
  }
  if (status === 400 || status === 401 || status === 403) {
    return {
      kind: 'terminal',
      reason: 'REJECTED',
      detail: `The enrollment poll was rejected with HTTP ${status}.`,
    };
  }
  if (status === 429) {
    return { kind: 'pending', note: 'the API rate-limited the poll' };
  }
  // 202/204, 404 (not paired yet), 5xx and any unexpected status: keep polling until the TTL.
  return { kind: 'pending', note: `waiting for pairing (HTTP ${status})` };
}

function readEnvelopeData(body: unknown): unknown {
  const envelope = z.looseObject({ success: z.literal(true), data: z.unknown() }).safeParse(body);
  return envelope.success ? envelope.data.data : undefined;
}

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

export interface BackoffOptions {
  readonly initialMs: number;
  readonly maxMs: number;
  readonly factor?: number;
  /** 0 = no jitter; 0.2 = ±20 % around the exponential base. */
  readonly jitterRatio?: number;
  readonly random?: () => number;
}

/**
 * Exponential backoff with jitter. `random` is injectable so tests are deterministic and every
 * delay stays within `[base*(1-jitter), base*(1+jitter)]`, clamped to `[1, maxMs]`.
 */
export class Backoff {
  readonly #initialMs: number;
  readonly #maxMs: number;
  readonly #factor: number;
  readonly #jitterRatio: number;
  readonly #random: () => number;
  #attempt = 0;

  constructor(options: BackoffOptions) {
    if (options.initialMs <= 0 || options.maxMs < options.initialMs) {
      throw new Error('Backoff needs 0 < initialMs <= maxMs');
    }
    this.#initialMs = options.initialMs;
    this.#maxMs = options.maxMs;
    this.#factor = options.factor ?? 2;
    this.#jitterRatio = Math.min(1, Math.max(0, options.jitterRatio ?? 0.2));
    this.#random = options.random ?? Math.random;
  }

  /** Next delay in milliseconds; advances the attempt counter. */
  nextDelayMs(): number {
    const base = Math.min(this.#maxMs, this.#initialMs * this.#factor ** this.#attempt);
    this.#attempt = Math.min(this.#attempt + 1, 32);
    const spread = base * this.#jitterRatio;
    const jittered = base - spread + this.#random() * spread * 2;
    return Math.max(1, Math.min(this.#maxMs, Math.round(jittered)));
  }

  reset(): void {
    this.#attempt = 0;
  }
}

// ---------------------------------------------------------------------------
// Waiter (abortable, nudge-able sleep)
// ---------------------------------------------------------------------------

export interface PollWaiter {
  wait(delayMs: number): Promise<void>;
  /** Resolves a pending wait early (the dashboard's `paired` nudge or a shutdown). */
  wake(): void;
}

/**
 * Sleep primitive used between polls. It resolves early on `wake()` and on the abort signal, so a
 * `paired` nudge triggers an immediate poll and `stop()` never waits out a backoff.
 */
export function createPollWaiter(signal?: AbortSignal): PollWaiter {
  let wakeUp: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    wait(delayMs: number): Promise<void> {
      return new Promise<void>((resolve) => {
        const finish = (): void => {
          if (timer !== undefined) clearTimeout(timer);
          timer = undefined;
          wakeUp = undefined;
          signal?.removeEventListener('abort', finish);
          resolve();
        };
        if (signal?.aborted === true) {
          finish();
          return;
        }
        wakeUp = finish;
        signal?.addEventListener('abort', finish, { once: true });
        timer = setTimeout(finish, Math.max(0, delayMs));
      });
    },
    wake(): void {
      wakeUp?.();
    },
  };
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

export interface PollEnrollmentOptions {
  readonly baseUrl: string;
  readonly deviceId: string;
  readonly enrollSecret: string;
  /** The code's TTL: polling stops (and the caller rotates the code) when it is reached. */
  readonly deadline: Date;
  readonly now?: () => Date;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly backoff?: Partial<BackoffOptions>;
  readonly waiter?: PollWaiter;
  readonly logger?: Logger;
}

export type EnrollmentPollResult =
  | {
      readonly kind: 'paired';
      readonly credentials: DeviceCredentials;
      readonly allowListVersion: number;
    }
  | {
      readonly kind: 'expired';
      readonly reason: 'TTL' | 'EXPIRED' | 'CONSUMED' | 'REJECTED';
      readonly detail: string;
    }
  | { readonly kind: 'aborted' };

/** Polls until paired, terminal, TTL-expired or aborted. Never throws for I/O failures. */
export async function pollEnrollment(
  options: PollEnrollmentOptions,
): Promise<EnrollmentPollResult> {
  const logger = options.logger ?? noopLogger;
  const now = options.now ?? (() => new Date());
  const waiter = options.waiter ?? createPollWaiter();
  const backoff = new Backoff({
    initialMs: 1_000,
    maxMs: 10_000,
    factor: 2,
    jitterRatio: 0.2,
    ...options.backoff,
  });
  const body = { deviceId: options.deviceId, enrollSecret: options.enrollSecret };

  for (;;) {
    const remainingMs = options.deadline.getTime() - now().getTime();
    if (remainingMs <= 0) {
      return {
        kind: 'expired',
        reason: 'TTL',
        detail: 'The pairing code expired before it was used.',
      };
    }

    let outcome: PollOutcome;
    try {
      const response: CloudHttpResponse = await postJson({
        url: apiUrl(options.baseUrl, AGENT_ENROLL_POLL_PATH),
        body,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      });
      outcome = classifyEnrollPoll(response.status, response.body);
    } catch (error) {
      // CloudNetworkError only: retry the same enrollment with backoff, never a new code.
      logger.debug(
        'Enrollment poll could not reach the cloud; retrying',
        error instanceof Error ? error.message : 'unknown error',
      );
      outcome = { kind: 'pending', note: 'network error' };
    }

    if (outcome.kind === 'paired') {
      return {
        kind: 'paired',
        credentials: {
          deviceId: options.deviceId,
          deviceToken: outcome.device.deviceToken,
          userId: outcome.device.userId,
        },
        allowListVersion: outcome.device.allowListVersion,
      };
    }
    if (outcome.kind === 'terminal') {
      return { kind: 'expired', reason: outcome.reason, detail: outcome.detail };
    }

    const delayMs = Math.min(backoff.nextDelayMs(), Math.max(0, remainingMs));
    await waiter.wait(delayMs);
  }
}
