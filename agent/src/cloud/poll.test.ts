// cloud/poll.test.ts — enrollment-poll classification, backoff curve and TTL behaviour (T-042).
// The poll loop is where a pairing could be faked or a still-valid code rotated, so every status
// class is asserted explicitly and a deterministic clock proves the 10-minute TTL is honoured.

import { describe, expect, it, vi } from 'vitest';
import {
  Backoff,
  classifyEnrollPoll,
  createPollWaiter,
  pollEnrollment,
  type PollWaiter,
} from './poll.js';

const BASE_URL = 'http://localhost:5000/api/v1';
const DEVICE_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';
const DEVICE_TOKEN = 'f3b2'.repeat(16);
const ENROLL_SECRET = 'q8Zt3n0rG6mJ2xV5cB1kL9pA4sD7fH0wAbCdEfGh';
const DEADLINE = new Date('2026-11-10T10:10:00.000Z');

function enrolledBody(): unknown {
  return {
    success: true,
    data: { deviceToken: DEVICE_TOKEN, userId: USER_ID, allowListVersion: 3 },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fakeFetch(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: { url: string; body: unknown }[] } {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as unknown });
    return handler(url, init);
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

describe('Backoff', () => {
  it('grows exponentially and clamps at maxMs', () => {
    const backoff = new Backoff({
      initialMs: 1_000,
      maxMs: 10_000,
      factor: 2,
      jitterRatio: 0,
    });
    expect([1, 2, 3, 4, 5, 6].map(() => backoff.nextDelayMs())).toEqual([
      1_000, 2_000, 4_000, 8_000, 10_000, 10_000,
    ]);
  });

  it('applies symmetric jitter driven by the injected random source', () => {
    const low = new Backoff({
      initialMs: 1_000,
      maxMs: 30_000,
      jitterRatio: 0.2,
      random: () => 0,
    });
    const high = new Backoff({
      initialMs: 1_000,
      maxMs: 30_000,
      jitterRatio: 0.2,
      random: () => 1,
    });
    expect(low.nextDelayMs()).toBe(800);
    expect(high.nextDelayMs()).toBe(1_200);
  });

  it('never returns less than 1 ms and resets to the initial delay', () => {
    const backoff = new Backoff({ initialMs: 1, maxMs: 2, jitterRatio: 1, random: () => 0 });
    expect(backoff.nextDelayMs()).toBe(1);
    expect(backoff.nextDelayMs()).toBe(1);
    backoff.reset();
    expect(backoff.nextDelayMs()).toBe(1);
  });

  it('rejects an impossible range', () => {
    expect(() => new Backoff({ initialMs: 0, maxMs: 10 })).toThrow(/initialMs/);
    expect(() => new Backoff({ initialMs: 100, maxMs: 10 })).toThrow(/initialMs/);
  });
});

describe('createPollWaiter', () => {
  it('wakes a pending wait immediately', async () => {
    vi.useFakeTimers();
    try {
      const waiter = createPollWaiter();
      let done = false;
      const pending = waiter.wait(60_000).then(() => {
        done = true;
      });
      waiter.wake();
      await pending;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves immediately when the abort signal is already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const waiter = createPollWaiter(abort.signal);
    await expect(waiter.wait(60_000)).resolves.toBeUndefined();
  });
});

describe('classifyEnrollPoll', () => {
  it('recognises the paired payload on 200', () => {
    expect(classifyEnrollPoll(200, enrolledBody())).toEqual({
      kind: 'paired',
      device: { deviceToken: DEVICE_TOKEN, userId: USER_ID, allowListVersion: 3 },
    });
  });

  it('treats a 200 without a token, 202, 204 and 404 as pending', () => {
    for (const [status, body] of [
      [200, { success: true, data: { paired: false } }],
      [202, { success: true, data: {} }],
      [204, undefined],
      [404, { success: false, error: { code: 'NOT_FOUND' } }],
      [429, { success: false, error: { code: 'RATE_LIMITED' } }],
      [503, { success: false, error: { code: 'INTERNAL' } }],
    ] as const) {
      expect(classifyEnrollPoll(status, body).kind, `status ${status}`).toBe('pending');
    }
  });

  it('never pairs on a malformed 200 payload', () => {
    expect(classifyEnrollPoll(200, { success: true, data: { deviceToken: 'short' } }).kind).toBe(
      'pending',
    );
    expect(classifyEnrollPoll(200, { success: true, data: null }).kind).toBe('pending');
    expect(classifyEnrollPoll(200, 'not json').kind).toBe('pending');
  });

  it('maps consumed, expired and rejected enrollments to terminal outcomes', () => {
    expect(classifyEnrollPoll(409, { success: false, error: { code: 'CONFLICT' } })).toMatchObject({
      kind: 'terminal',
      reason: 'CONSUMED',
    });
    expect(
      classifyEnrollPoll(410, { success: false, error: { code: 'PAIRING_EXPIRED' } }),
    ).toMatchObject({ kind: 'terminal', reason: 'EXPIRED' });
    for (const status of [400, 401, 403]) {
      expect(classifyEnrollPoll(status, undefined), `status ${status}`).toMatchObject({
        kind: 'terminal',
        reason: 'REJECTED',
      });
    }
  });
});

describe('pollEnrollment', () => {
  function controllableClock(start: string): {
    now: () => Date;
    waiter: PollWaiter;
    waits: number[];
  } {
    let current = new Date(start);
    const waits: number[] = [];
    return {
      now: () => new Date(current),
      waits,
      waiter: {
        wait: async (delayMs: number): Promise<void> => {
          waits.push(delayMs);
          current = new Date(current.getTime() + delayMs);
        },
        wake: () => undefined,
      },
    };
  }

  it('returns the credentials from the first successful poll', async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse(200, enrolledBody()));
    const clock = controllableClock('2026-11-10T10:00:00.000Z');

    const result = await pollEnrollment({
      baseUrl: BASE_URL,
      deviceId: DEVICE_ID,
      enrollSecret: ENROLL_SECRET,
      deadline: DEADLINE,
      now: clock.now,
      waiter: clock.waiter,
      fetchImpl,
    });

    expect(result).toEqual({
      kind: 'paired',
      credentials: { deviceId: DEVICE_ID, deviceToken: DEVICE_TOKEN, userId: USER_ID },
      allowListVersion: 3,
    });
    expect(calls[0]?.url).toBe(`${BASE_URL}/agent/enroll/poll`);
    expect(calls[0]?.body).toEqual({ deviceId: DEVICE_ID, enrollSecret: ENROLL_SECRET });
  });

  it('waits with backoff between pending polls and then pairs', async () => {
    let polls = 0;
    const { fetchImpl } = fakeFetch(() => {
      polls += 1;
      return polls < 3
        ? jsonResponse(200, { success: true, data: { paired: false } })
        : jsonResponse(200, enrolledBody());
    });
    const clock = controllableClock('2026-11-10T10:00:00.000Z');

    const result = await pollEnrollment({
      baseUrl: BASE_URL,
      deviceId: DEVICE_ID,
      enrollSecret: ENROLL_SECRET,
      deadline: DEADLINE,
      now: clock.now,
      waiter: clock.waiter,
      fetchImpl,
      backoff: { initialMs: 1_000, maxMs: 10_000, jitterRatio: 0 },
    });

    expect(result.kind).toBe('paired');
    expect(clock.waits).toEqual([1_000, 2_000]);
  });

  it('gives up with TTL when the code expires before pairing', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse(200, { success: true, data: { paired: false } }),
    );
    const clock = controllableClock('2026-11-10T10:00:00.000Z');

    const result = await pollEnrollment({
      baseUrl: BASE_URL,
      deviceId: DEVICE_ID,
      enrollSecret: ENROLL_SECRET,
      deadline: new Date('2026-11-10T10:00:03.000Z'),
      now: clock.now,
      waiter: clock.waiter,
      fetchImpl,
      backoff: { initialMs: 1_000, maxMs: 10_000, jitterRatio: 0 },
    });

    expect(result).toMatchObject({ kind: 'expired', reason: 'TTL' });
    // 10:00:00 poll → wait 1 s → 10:00:01 poll → wait 2 s → deadline reached: two polls.
    expect(calls).toHaveLength(2);
  });

  it('returns immediately on a terminal 410 instead of polling until the TTL', async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse(410, { success: false, error: { code: 'PAIRING_EXPIRED' } }),
    );
    const clock = controllableClock('2026-11-10T10:00:00.000Z');

    const result = await pollEnrollment({
      baseUrl: BASE_URL,
      deviceId: DEVICE_ID,
      enrollSecret: ENROLL_SECRET,
      deadline: DEADLINE,
      now: clock.now,
      waiter: clock.waiter,
      fetchImpl,
    });

    expect(result).toMatchObject({ kind: 'expired', reason: 'EXPIRED' });
    expect(calls).toHaveLength(1);
  });

  it('retries the same enrollment after a network error', async () => {
    let attempts = 0;
    const { fetchImpl } = fakeFetch(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error('ECONNRESET'))
        : jsonResponse(200, enrolledBody());
    });
    const clock = controllableClock('2026-11-10T10:00:00.000Z');

    const result = await pollEnrollment({
      baseUrl: BASE_URL,
      deviceId: DEVICE_ID,
      enrollSecret: ENROLL_SECRET,
      deadline: DEADLINE,
      now: clock.now,
      waiter: clock.waiter,
      fetchImpl,
      backoff: { initialMs: 1_000, maxMs: 10_000, jitterRatio: 0 },
    });

    expect(result.kind).toBe('paired');
    expect(clock.waits).toEqual([1_000]);
  });
});
