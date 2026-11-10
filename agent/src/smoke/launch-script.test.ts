// smoke/launch-script.test.ts — logic of `scripts/smoke/launch.mjs` (T-113), tested without
// launching Electron. The launcher itself is run for real by the W3 evidence command
// (`node scripts/smoke/launch.mjs`); these cases pin the two contracts it must not weaken:
// exactly one parseable `SMOKE_READY port=<n>` line and hello.paired=false / getState.state=IDLE.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORIGIN,
  LAUNCH_TIMEOUT_MS,
  parseSmokeReady,
  pickFreePort,
  verifySmokeFrames,
} from '../../../scripts/smoke/launch.mjs';

const HELLO = {
  v: 1,
  id: 'a-1',
  type: 'hello',
  agentId: 'focus-agent-local',
  agentVersion: '0.1.0',
  os: 'macOS',
  state: 'IDLE',
  paired: false,
  capabilities: { focus: 'full' },
};
const STATE = {
  v: 1,
  id: 'a-2',
  type: 'state',
  state: 'IDLE',
  protected: [],
  allowList: [],
};

describe('parseSmokeReady', () => {
  it('reads the single machine-readable line', () => {
    expect(parseSmokeReady('SMOKE_READY port=4545')).toBe(4545);
    expect(parseSmokeReady('  SMOKE_READY port=61001 \n')).toBe(61001);
  });

  it('rejects anything that is not exactly that line', () => {
    for (const line of [
      '',
      'SMOKE_READY',
      'SMOKE_READY port=',
      'SMOKE_READY port=80',
      'SMOKE_READY port=70000',
      'SMOKE_READY port=abc',
      'ready SMOKE_READY port=4545',
      '[focus-agent] info: SMOKE_READY port=4545',
    ]) {
      expect(parseSmokeReady(line)).toBeNull();
    }
  });
});

describe('verifySmokeFrames', () => {
  it('accepts the unpaired IDLE pair', () => {
    expect(() => verifySmokeFrames(HELLO, STATE)).not.toThrow();
  });

  it('fails when the smoke agent reports a pairing or any focus state', () => {
    expect(() => verifySmokeFrames({ ...HELLO, paired: true }, STATE)).toThrow(/paired/);
    expect(() => verifySmokeFrames({ ...HELLO, state: 'PAIRED' }, STATE)).toThrow(/IDLE/);
    expect(() => verifySmokeFrames(HELLO, { ...STATE, state: 'FOCUSING' })).toThrow(/IDLE/);
    expect(() =>
      verifySmokeFrames(HELLO, {
        ...STATE,
        session: { sessionId: 'x', startedAt: 'a', endsAt: 'b', plannedMinutes: 25 },
      }),
    ).toThrow(/session/);
  });

  it('fails when the frames are missing or out of order', () => {
    expect(() => verifySmokeFrames(undefined, STATE)).toThrow(/hello/);
    expect(() => verifySmokeFrames({ ...HELLO, type: 'state' }, STATE)).toThrow(/hello/);
    expect(() => verifySmokeFrames(HELLO, undefined)).toThrow(/state frame/);
    expect(() => verifySmokeFrames(HELLO, { ...STATE, type: 'apps' })).toThrow(/state frame/);
  });
});

describe('pickFreePort', () => {
  it('returns a usable ephemeral loopback port', async () => {
    const port = await pickFreePort();
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThanOrEqual(1024);
    expect(port).toBeLessThanOrEqual(65535);
  });
});

describe('launcher constants', () => {
  it('allows the agent its 20 s failsafe plus reporting headroom', () => {
    expect(LAUNCH_TIMEOUT_MS).toBeGreaterThan(20_000);
    expect(LAUNCH_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  it('sends an Origin the agent allow-list can accept', () => {
    expect(DEFAULT_ORIGIN).toBe('http://localhost:5173');
  });
});
