// schedule/flow.integration.test.ts — the DEC-021 chain against the REAL FocusController and the
// FakeDriver (no Electron, no OS calls). This is the closest the agent package gets to the shipped
// path: `scheduleDue` → heads-up → cancel or timeout → C-20 allow-list → journal-first
// `enterFocus({source:'SCHEDULE'})` → controller lifecycle → cloud `session.started` report.
// Assertions are on observable truth only: journal contents, FakeDriver call log, controller
// state, and the exact frames handed to the cloud transport.
// Real window hiding stays in A0's verify script (scripts/verify/macos-focus-smoke.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudMessage, ScheduleDueMessage } from '@focus-mode/shared';
import { createLifecycleReporter, SessionReporter } from '../cloud/reporting.js';
import { FocusController, type FocusLifecycleEvent } from '../focus/controller.js';
import { ConsentGate, FileConsentStore } from '../focus/consent.js';
import { FakeDriver } from '../focus/drivers/fake.js';
import { FileJournal } from '../focus/journal.js';
import type { Logger } from '../log.js';
import {
  cleanupHarnessDirs,
  makeDirectory,
  PROTECTED,
  SESSION_ID,
  START,
  VSCODE,
  WINDOWS,
} from '../focus/controller.harness.js';
import { ScheduleFlow } from './flow.js';

const BASE_URL = 'http://127.0.0.1:5000/api/v1';
const DEVICE_TOKEN = 'f3b2'.repeat(16);
const RUN_ID = '507f1f77bcf86cd799439014';
const SCHEDULE_ID = '507f1f77bcf86cd799439013';
const HEADS_UP_MS = 10_000;

type LogFn = (message: string, ...meta: readonly unknown[]) => void;

function quietLogger(): Logger {
  return { error: vi.fn<LogFn>(), warn: vi.fn<LogFn>(), info: vi.fn<LogFn>(), debug: vi.fn<LogFn>() };
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

function allowListResponse(): Response {
  return new Response(
    JSON.stringify({
      success: true,
      // Only VS Code is allow-listed, so Slack must be moved aside: this proves the list the
      // scheduled start used really came from the C-20 fetch (not a stale local copy).
      data: { protectedApps: PROTECTED, userApps: [VSCODE], version: 3 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

interface Harness {
  readonly flow: ScheduleFlow;
  readonly controller: FocusController;
  readonly driver: FakeDriver;
  readonly journal: FileJournal;
  readonly events: FocusLifecycleEvent[];
  readonly sent: CloudMessage[];
  readonly failures: Array<{ reason: string; detail: string }>;
  readonly prompts: () => number;
}

interface HarnessOptions {
  grantConsent?: boolean;
  allowListResponse?: () => Response;
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const driver = new FakeDriver(WINDOWS);
  const journal = new FileJournal({ directory: makeDirectory() });
  const events: FocusLifecycleEvent[] = [];
  const sent: CloudMessage[] = [];
  const failures: Array<{ reason: string; detail: string }> = [];
  let prompts = 0;

  // Exactly the main.ts wiring: one lifecycle mapping, one reporter, de-duplicated by session id.
  const reporter = new SessionReporter({
    transport: {
      send: (message) => {
        sent.push(message);
        return true;
      },
    },
    logger: quietLogger(),
  });
  const reportLifecycle = createLifecycleReporter(reporter);

  const consent = new ConsentGate({
    store: new FileConsentStore({ directory: makeDirectory() }),
    prompt: async () => {
      prompts += 1;
      return options.grantConsent ?? true;
    },
    now: () => START,
  });

  const controller = new FocusController({
    driver,
    journal,
    protectedEntries: PROTECTED,
    os: 'macOS',
    consent,
    initialPaired: true,
    enforcement: false,
    now: () => START,
    logger: quietLogger(),
    onEvent: (event) => {
      events.push(event);
      reportLifecycle(event);
    },
  });

  const flow = new ScheduleFlow({
    baseUrl: BASE_URL,
    headsUpMs: HEADS_UP_MS,
    getDeviceToken: () => DEVICE_TOKEN,
    getCapabilities: () => controller.capabilities(),
    isFocusing: () => controller.isFocusing(),
    enterFocus: (request) => controller.enterFocus(request),
    sendCloud: (message) => {
      sent.push(message);
      return true;
    },
    uuid: () => SESSION_ID,
    now: () => START,
    fetchImpl: (async () => (options.allowListResponse ?? allowListResponse)()) as typeof fetch,
    logger: quietLogger(),
    onFailed: (_pending, reason, detail) => failures.push({ reason, detail }),
  });

  return { flow, controller, driver, journal, events, sent, failures, prompts: () => prompts };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  cleanupHarnessDirs();
});

describe('scheduled start against the real controller + FakeDriver', () => {
  it('journals, applies focus, and reports one SCHEDULE session with scheduleRunId', async () => {
    const harness = makeHarness();
    expect(harness.flow.handleScheduleDue(due())).toBe('PENDING');
    expect(harness.controller.getState().state).toBe('PAIRED');

    await vi.advanceTimersByTimeAsync(HEADS_UP_MS);
    for (let i = 0; i < 12; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));

    // INV-4/INV-5: focus really applied through the FakeDriver, only for a non-protected,
    // non-allow-listed window (Slack), never Chrome (protected) or VS Code (allow-listed).
    expect(harness.controller.getState().state).toBe('FOCUSING');
    expect(harness.controller.getState().session).toMatchObject({
      sessionId: SESSION_ID,
      plannedMinutes: 25,
      source: 'SCHEDULE',
      startedAt: START.toISOString(),
    });
    const asideCall = harness.driver.getCallLog().find((call) => call.method === 'asideWindows');
    expect(asideCall?.appKeys).toEqual(['slack']);
    expect(harness.driver.isAsided('w-slack')).toBe(true);
    expect(harness.driver.isAsided('w-chrome')).toBe(false);
    expect(harness.driver.isAsided('w-vscode')).toBe(false);

    // Journal-first: the entry exists, is FOCUSING and carries the schedule source.
    expect(harness.journal.read()).toMatchObject({
      sessionId: SESSION_ID,
      source: 'SCHEDULE',
      plannedMinutes: 25,
      intent: 'FOCUSING',
    });

    // The REC-004 native gate ran once (the scheduled path cannot bypass it).
    expect(harness.prompts()).toBe(1);

    // Controller lifecycle → cloud report, exactly one, linked to the run (DEC-021).
    const startedReports = harness.sent.filter((message) => message.type === 'session.started');
    expect(startedReports).toHaveLength(1);
    expect(startedReports[0]).toMatchObject({
      clientSessionId: SESSION_ID,
      plannedMinutes: 25,
      source: 'SCHEDULE',
      scheduleRunId: RUN_ID,
      startedAt: START.toISOString(),
    });
    // Nothing was cancelled, and no report was sent twice.
    expect(harness.sent.some((message) => message.type === 'scheduleRunCancelled')).toBe(false);
    expect(harness.events.filter((event) => event.type === 'focusStarted')).toHaveLength(1);
  });

  it('ends the session through the controller and reports session.ended (FR-027)', async () => {
    const harness = makeHarness();
    harness.flow.handleScheduleDue(due());
    await vi.advanceTimersByTimeAsync(HEADS_UP_MS);
    for (let i = 0; i < 12; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));

    await harness.controller.exitFocus('USER');

    const ended = harness.sent.filter((message) => message.type === 'session.ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({
      clientSessionId: SESSION_ID,
      status: 'CANCELLED',
      endReason: 'USER',
      actualMinutes: 0,
    });
    expect(harness.driver.isAsided('w-slack')).toBe(false);
    expect(harness.journal.read()).toBeNull();
  });

  it('never applies focus when the user cancels the heads-up', async () => {
    const harness = makeHarness();
    harness.flow.handleScheduleDue(due());
    expect(harness.flow.cancel()).toBe('CANCELLED');

    await vi.advanceTimersByTimeAsync(HEADS_UP_MS * 3);
    for (let i = 0; i < 8; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));

    expect(harness.controller.getState().state).toBe('PAIRED');
    expect(harness.controller.isFocusing()).toBe(false);
    expect(harness.driver.getCallLog()).toHaveLength(0);
    expect(harness.journal.read()).toBeNull();
    expect(harness.events).toHaveLength(0);
    expect(harness.sent).toEqual([
      expect.objectContaining({ type: 'scheduleRunCancelled', runId: RUN_ID }),
    ]);
  });

  it('never applies focus when the allow-list cannot be fetched', async () => {
    const harness = makeHarness({
      allowListResponse: () =>
        new Response(JSON.stringify({ success: false, error: { code: 'INTERNAL' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }),
    });
    harness.flow.handleScheduleDue(due());
    await vi.advanceTimersByTimeAsync(HEADS_UP_MS);
    for (let i = 0; i < 12; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));

    expect(harness.controller.isFocusing()).toBe(false);
    expect(harness.driver.getCallLog()).toHaveLength(0);
    expect(harness.journal.read()).toBeNull();
    expect(harness.failures[0]).toMatchObject({ reason: 'ALLOWLIST_UNAVAILABLE' });
    expect(harness.sent).toHaveLength(0);
  });

  it('honours a declined REC-004 dialog: no journal, no aside, no report', async () => {
    const harness = makeHarness({ grantConsent: false });
    harness.flow.handleScheduleDue(due());
    await vi.advanceTimersByTimeAsync(HEADS_UP_MS);
    for (let i = 0; i < 12; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));

    expect(harness.prompts()).toBe(1);
    expect(harness.controller.isFocusing()).toBe(false);
    expect(harness.driver.getCallLog()).toHaveLength(0);
    expect(harness.journal.read()).toBeNull();
    expect(harness.failures[0]?.reason).toBe('REJECTED');
    expect(harness.failures[0]?.detail).toContain('CONSENT_REQUIRED');
    expect(harness.sent).toHaveLength(0);
  });
});
