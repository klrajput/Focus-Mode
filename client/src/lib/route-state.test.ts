/*
 * `fromRouteState` / `errorCodeOf` tests (T-020): the login redirect may only follow same-origin
 * absolute paths, otherwise a crafted `state.from` would be an open redirect.
 */

import { describe, expect, it } from 'vitest';

import { ApiError } from '../api/errors';
import { errorCodeOf, fromRouteState } from './route-state';

describe('fromRouteState', () => {
  it('returns a same-origin path from RequireAuth state', () => {
    expect(fromRouteState({ from: '/focus' })).toBe('/focus');
    expect(fromRouteState({ from: '/schedules?week=1' })).toBe('/schedules?week=1');
    expect(fromRouteState({ from: '/', other: true })).toBe('/');
  });

  it('rejects missing, non-string and non-object state', () => {
    for (const state of [undefined, null, 'from=/focus', 42, {}, { from: 42 }, { from: null }]) {
      expect(fromRouteState(state)).toBeNull();
    }
  });

  it('rejects protocol-relative and absolute URLs (open-redirect guard)', () => {
    for (const from of ['//evil.example/steal', 'https://evil.example', 'javascript:alert(1)']) {
      expect(fromRouteState({ from }), from).toBeNull();
    }
  });

  it('rejects an empty path', () => {
    expect(fromRouteState({ from: '' })).toBeNull();
  });
});

describe('errorCodeOf', () => {
  it('exposes the contract code of an ApiError only', () => {
    expect(errorCodeOf(new ApiError('CONFLICT', 409, 'Conflict'))).toBe('CONFLICT');
    expect(errorCodeOf(new Error('boom'))).toBeUndefined();
    expect(errorCodeOf('boom')).toBeUndefined();
    expect(errorCodeOf(null)).toBeUndefined();
  });
});
