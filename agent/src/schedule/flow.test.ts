// schedule/flow.test.ts — the DEC-021 scheduled-session flow, end to end without Electron.
// Matrix covered here: cancel (cloud message, no focus), timeout (allow-list fetch → SCHEDULE
// enterFocus), and every honest failure (unpaired, unsupported, allow-list unavailable, refused
// start) — never a fake session, always a logged reason. The controller lifecycle is the single
// reporting path, so this suite also asserts the flow itself sends no `session.started`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEntry, CloudMessage, ScheduleDueMessage } from '@focus-mode/shared';
import {
  FocusRejectedError,
  type EnterFocusRequest,
  type FocusSnapshot,
} from '../focus/controller.js';
import type { Logger } from '../log.js';
import { ScheduleFlow, SCHEDULE_CONSENT_VERSION, type ScheduleFlowOptions } from './flow.js';
import type { PendingRun } from './heads-up.js';

const BASE_URL = 'http://127.0.0.1:5000/api/v1';
const DEVICE_TOKEN = 'f3b2'.repeat(16);
const RUN_ID = '507f1f77bcf86cd799439014';
const SCHEDULE_ID = '507f1f77bcf86cd799439013';
const SESSION_ID = '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f';
const NOW = new Date('2026-11-10T10:00:00.000Z');
const HEADS_UP_MS = 10_000;
const VSCODE: AppEntry = {
  key: 'vscode',
  label: 'Visual Studio Code',
  mac: ['com.microsoft.VSCode'],
};
const SLACK: AppEntry = { key: 'slack', label: 'Slack', mac: ['com.tinyspeck.slackmacgap'] };

type LogFn = (message: string, ...meta: readonly unknown[]) => void;

function quietLogger(): Logger {
  return {
    error: vi.fn<LogFn>(),
    warn: vi.fn<LogFn>(),
    info: vi.fn<LogFn>(),
    debug: vi.fn<LogFn>(),
  };
}

function due(overrides: Partial<ScheduleDueMessage> = {}): ScheduleDueMessage {
  return {
    v: 1,
    id: 'c-004',
    type: 'scheduleDue',
    runId: RUN_ID,
    scheduleId: SCHEDULE_ID,
    durationMin: 25,
    allowListVersion: 3,
    ...overrides,
  };
}

const SNAPSHOT: FocusSnapshot = {
  state: 'FOCUSING',
  session: {
    sessionId: SESSION_ID,
    startedAt: '2026-11-10T10:00:10.000Z',
    endsAt: '2026-11-10T10:25:10.000Z',
    plannedMinutes: 25,
    source: 'SCHEDULE',
  },
  protected: [],
  allowList: [VSCODE, SLACK],
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets the fetch stub + enterFocus promise chain settle without real timers. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

interface Harness {
  readonly flow: ScheduleFlow;
  readonly requests: EnterFocusRequest[];
  readonly sent: CloudMessage[];
  readonly headsUp: PendingRun[];
  readonly started: Array<{ pending: PendingRun; sessionId: string }>;
  readonly cancelled: Array<{ pending: PendingRun; at: string }>;
  readonly failures: Array<{ pending: PendingRun; reason: string; detail: string }>;
  readonly fetches: Array<{ url: string; init: RequestInit | undefined }>;
  readonly logger: Logger;
}

interface HarnessOptions {
  headsUpMs?: number;
  deviceToken?: string | null;
  capabilities?: 'full' | 'partial' | 'unsupported';
  focusing?: boolean;
  allowListResponse?: () => Response | Promise<Response>;
  enterFocus?: (request: EnterFocusRequest) => Promise<FocusSnapshot>;
  sendOk?: boolean;
  overrides?: Partial<ScheduleFlowOptions>;
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const requests: EnterFocusRequest[] = [];
  const sent: CloudMessage[] = [];
  const headsUp: PendingRun[] = [];
  const started: Array<{ pending: PendingRun; sessionId: string }> = [];
  const cancelled: Array<{ pending: PendingRun; at: string }> = [];
  const failures: Array<{ pending: PendingRun; reason: string; detail: string }> = [];
  const fetches: Array<{ url: string; init: RequestInit | undefined }> = [];
  const logger = quietLogger();

  const allowListResponse =
    options.allowListResponse ??
    (() =>
      new Response(
        JSON.stringify({
          success: true,
          data: { protectedApps: [], userApps: [VSCODE, SLACK], version: 3 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ));

  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    fetches.push({ url: String(url), init });
    return allowListResponse();
  }) as typeof fetch;

  const enterFocus =
    options.enterFocus ??
    (async (request: EnterFocusRequest): Promise<FocusSnapshot> => {
      requests.push(request);
      return SNAPSHOT;
    });

  const flow = new ScheduleFlow({
    baseUrl: BASE_URL,
    headsUpMs: options.headsUpMs ?? HEADS_UP_MS,
    getDeviceToken: () => (options.deviceToken === undefined ? DEVICE_TOKEN : options.deviceToken),
    getCapabilities: () => ({ focus: options.capabilities ?? 'full' }),
    isFocusing: () => options.focusing ?? false,
    enterFocus,
    sendCloud: (message) => {
      if (options.sendOk === false) return false;
      sent.push(message);
      return true;
    },
    uuid: () => SESSION_ID,
    now: () => NOW,
    fetchImpl,
    logger,
    onHeadsUp: (pending) => headsUp.push(pending),
    onStarted: (pending, sessionId) => started.push({ pending, sessionId }),
    onCancelled: (pending, at) => cancelled.push({ pending, at }),
    onFailed: (pending, reason, detail) => failures.push({ pending, reason, detail }),
    ...options.overrides,
  });

  return { flow, requests, sent, headsUp, started, cancelled, failures, fetches, logger };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('scheduleDue → cancellable heads-up (no focus yet)', () => {
  it('announces the run and touches neither HTTP nor the controller', async () => {
    const harness = makeHarness();
    expect(harness.flow.handleScheduleDue(due())).toBe('PENDING');

    expect(harness.headsUp).toHaveLength(1);
    expect(harness.flow.pending()).toMatchObject({ runId: RUN_ID, durationMin: 25 });
    expect(harness.fetches).toHaveLength(0);
    expect(harness.requests).toHaveLength(0);
    expect(harness.sent).toHaveLength(0);
  });

  it('never announces while a focus session is already running', () => {
    const harness = makeHarness({ focusing: true });
    expect(harness.flow.handleScheduleDue(due())).toBe('IGNORED_FOCUSING');
    expect(harness.headsUp).toHaveLength(0);
  });

  it('ignores a repeated scheduleDue for the same run', () => {
    const harness = makeHarness();
    harness.flow.handleScheduleDue(due());
    expect(harness.flow.handleScheduleDue(due())).toBe('DUPLICATE');
    expect(harness.headsUp).toHaveLength(1);
  });
});

describe('cancel (DEC-021 step 3)', () => {
  it('reports scheduleRunCancelled {runId, at} and applies no focus', async () => {
    const harness = makeHarness();
    harness.flow.handleScheduleDue(due());

    expect(harness.flow.cancel()).toBe('CANCELLED');

    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0]).toEqual({
      v: 1,
      id: expect.any(String) as unknown as string,
      type: 'scheduleRunCancelled',
      runId: RUN_ID,
      at: NOW.toISOString(),
    });
    // Exactly the frozen fields — no sessionId, no allow-list, no window data (INV-6).
    expect(Object.keys(harness.sent[0] ?? {}).sort()).toEqual(['at', 'id', 'runId', 'type', 'v']);
    expect(harness.cancelled).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(HEADS_UP_MS * 2);
    await settle();
    expect(harness.requests).toHaveLength(0);
    expect(harness.fetches).toHaveLength(0);
    expect(harness.flow.pending()).toBeNull();
  });

  it('is a no-op (and sends nothing) when nothing is pending', () => {
    const harness = makeHarness();
    expect(harness.flow.cancel()).toBe('NOTHING_PENDING');
    expect(harness.sent).toHaveLength(0);
  });

  it('cannot cancel once the window elapsed, so no cancel races a start', async () => {
    const harness = makeHarness();
    harness.flow.handleScheduleDue(due());
    await vi.advanceTimersByTimeAsync(HEADS_UP_MS);
    await settle();

    expect(harness.flow.cancel()).toBe('NOTHING_PENDING');
    expect(harness.sent).toHaveLength(0);
    expect(harness.requests).toHaveLength(1);
  });

  it('keeps the local cancel but warns when the cloud link cannot deliver it', () => {
    const harness = makeHarness({ sendOk: false });
    harness.flow.handleScheduleDue(due());
    expect(harness.flow.cancel()).toBe('CANCELLED');
    expect(harness.sent).toHaveLength(0);
    expect(harness.cancelled).toHaveLength(1);
    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cancelled locally'),
      expect.anything(),
    );
  });
});

describe('timeout → allow-list → SCHEDULE session', () => {
  it('fetches the allow-list with the device token, then starts with the SCHEDULE fields', async () => {
    const harness = makeHarness();
    harness.flow.handleScheduleDue(due());

    await vi.advanceTimersByTimeAsync(HEADS_UP_MS);
    await settle();

    // C-20 fetch: full base + endpoint, device-token auth (never the dashboard's JWT).
    expect(harness.fetches).toHaveLength(1);
    expect(harness.fetches[0]?.url).toBe(`${BASE_URL}/agent/allowlist`);
    const headers = harness.fetches[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${DEVICE_TOKEN}`);

    // The one interface that applies focus, with the exact DEC-021 request shape.
    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0]).toEqual({
      durationMin: 25,
      allowList: [VSCODE, SLACK],
      clientSessionId: SESSION_ID,
      source: 'SCHEDULE',
      reaside: true,
      consent: { acceptedAt: NOW.toISOString(), version: SCHEDULE_CONSENT_VERSION },
      scheduleRunId: RUN_ID,
    });
    expect(SCHEDULE_CONSENT_VERSION).toBe('schedule-v1');

    // session.started is the controller lifecycle's job (one report path, no duplicates).
    expect(harness.sent).toHaveLength(0);
    expect(harness.started).toEqual([
      { pending: expect.objectContaining({ runId: RUN_ID }), sessionId: SESSION_ID },
    ]);
    expect(harness.failures).toHaveLength(0);
  });

  it('does not start when the agent is not paired (no token, no HTTP, no focus)', async () => {
    const harness = makeHarness({ deviceToken: null });
    harness.flow.handleScheduleDue(due());

    await vi.advanceTimersByTimeAsync(HEADS_UP_MS);
    await settle();

    expect(harness.fetches).toHaveLength(0);
    expect(harness.requests).toHaveLength(0);
    expect(harness.failures).toEqual([
      {
        pending: expect.objectContaining({ runId: RUN_ID }),
        reason: 'NOT_PAIRED',
        detail: expect.any(String),
      },
    ]);
    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('no focus was applied'),
      expect.objectContaining({ reason: 'NOT_PAIRED' }),
    );
  });

  it('does not start when window control is unsupported (FR-005)', async () => {
    const harness = makeHarness({ capabilities: 'unsupported' });
    harness.flow.handleScheduleDue(due());
    await vi.advanceTimersByTimeAsync(HEADS_UP_MS);
    await settle();

    expect(harness.fetches).toHaveLength(0);
    expect(harness.requests).toHaveLength(0);
    expect(harness.failures[0]?.reason).toBe('UNSUPPORTED');
  });

  it('does not start when the allow-list is unavailable (logged reason, no focus)', async () => {
    const harness = makeHarness({
      allowListResponse: () =>
        new Response(
          JSON.stringify({ success: false, error: { code: 'UNAUTHENTICATED', message: 'nope' } }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
    });
    harness.flow.handleScheduleDue(due());
    await vi.advanceTimersByTimeAsync(HEADS_UP_MS);
    await settle();

    expect(harness.fetches).toHaveLength(1);
    expect(harness.requests).toHaveLength(0);
    expect(harness.sent).toHaveLength(0);
    expect(harness.failures[0]).toMatchObject({ reason: 'ALLOWLIST_UNAVAILABLE' });
    expect(harness.failures[0]?.detail).toContain('nope');
  });

  it('does not start when the cloud is unreachable at due time', async () => {
    const harness = makeHarness({
      allowListResponse: () => {
        throw new TypeError('fetch failed');
      },
    });
    harness.flow.handleScheduleDue(due());
    await vi.advanceTimersByTimeAsync(HEADS_UP_MS);
    await settle();

    expect(harness.requests).toHaveLength(0);
    expect(harness.failures[0]).toMatchObject({ reason: 'ALLOWLIST_UNAVAILABLE' });
    expect(harness.failures[0]?.detail).toContain('could not be reached');
  });

  it('reports a refused start honestly and starts nothing', async () => {
    const harness = makeHarness({
      enterFocus: async () => {
        throw new FocusRejectedError('CONSENT_REQUIRED', 'Native permission was declined.');
      },
    });
    harness.flow.handleScheduleDue(due());
    await vi.advanceTimersByTimeAsync(HEADS_UP_MS);
    await settle();

    expect(harness.failures[0]).toMatchObject({ reason: 'REJECTED' });
    expect(harness.failures[0]?.detail).toContain('CONSENT_REQUIRED');
    expect(harness.sent).toHaveLength(0);
    expect(harness.started).toHaveLength(0);
  });

  it('reports ALREADY_FOCUSING when a manual session won the race', async () => {
    const harness = makeHarness({
      enterFocus: async () => {
        throw new FocusRejectedError('ALREADY_FOCUSING', 'A focus session is already running.');
      },
    });
    harness.flow.handleScheduleDue(due());
    await vi.advanceTimersByTimeAsync(HEADS_UP_MS);
    await settle();

    expect(harness.failures[0]).toMatchObject({ reason: 'ALREADY_FOCUSING' });
  });

  it('still starts (with a log) when the announced allow-list version is stale', async () => {
    const harness = makeHarness();
    harness.flow.handleScheduleDue(due({ allowListVersion: 1 }));
    await vi.advanceTimersByTimeAsync(HEADS_UP_MS);
    await settle();

    expect(harness.requests).toHaveLength(1);
    expect(harness.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('allow-list version differs'),
      expect.objectContaining({ dispatchedVersion: 1, fetchedVersion: 3 }),
    );
  });

  it('ignores a second scheduleDue while the first run is still starting', async () => {
    const gate = deferred<FocusSnapshot>();
    const harness = makeHarness({ enterFocus: () => gate.promise });
    harness.flow.handleScheduleDue(due());
    await vi.advanceTimersByTimeAsync(HEADS_UP_MS);
    await settle();

    expect(harness.flow.handleScheduleDue(due({ runId: '507f1f77bcf86cd799439099' }))).toBe(
      'IGNORED_STARTING',
    );
    gate.resolve(SNAPSHOT);
    await settle();
  });
});
