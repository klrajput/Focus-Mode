/*
 * Query-client defaults (NFR-007): deterministic client errors (4xx and the status-0 transport
 * failure) are never retried so an honest error state appears immediately; unknown failures get
 * two retries. Mutations never retry, window-focus refetch is off (focus state is local).
 */

import { describe, expect, it } from 'vitest';

import { ApiError } from '../api/errors';
import { createQueryClient } from './query-client';

type Retry = (failureCount: number, error: unknown) => boolean;

function retryOf(client = createQueryClient()): Retry {
  return client.getDefaultOptions().queries?.retry as Retry;
}

describe('createQueryClient', () => {
  it('uses the documented static defaults', () => {
    const defaults = createQueryClient().getDefaultOptions();

    expect(defaults.queries?.staleTime).toBe(15_000);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.mutations?.retry).toBe(false);
  });

  it('never retries a 4xx ApiError', () => {
    for (const [code, status] of [
      ['UNAUTHENTICATED', 401],
      ['FORBIDDEN', 403],
      ['NOT_FOUND', 404],
      ['RATE_LIMITED', 429],
    ] as const) {
      expect(retryOf()(0, new ApiError(code, status, code)), code).toBe(false);
    }
  });

  it('never retries the status-0 transport failure', () => {
    expect(retryOf()(0, new ApiError('INTERNAL', 0, 'Network down'))).toBe(false);
  });

  it('retries a 5xx ApiError twice, then gives up', () => {
    const retry = retryOf();
    const server = new ApiError('INTERNAL', 500, 'Database unavailable');

    expect(retry(0, server)).toBe(true);
    expect(retry(1, server)).toBe(true);
    expect(retry(2, server)).toBe(false);
  });

  it('retries a non-API error twice, then gives up', () => {
    const retry = retryOf();
    const unknown = new Error('socket closed');

    expect(retry(0, unknown)).toBe(true);
    expect(retry(1, unknown)).toBe(true);
    expect(retry(2, unknown)).toBe(false);
  });
});
