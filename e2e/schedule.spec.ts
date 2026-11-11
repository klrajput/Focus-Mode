// e2e/schedule.spec.ts — scheduled-session E2E driven by the REAL scheduler (W4 gate, T-064/T-065;
// FR-012/FR-025, DEC-021).
//
// Why: the product promise is "focus starts on time, even with the dashboard closed, and a missed
// run is recorded honestly instead of forcing anything". Only the real per-minute scheduler + the
// real agent schedule flow can prove that, so this spec creates a real schedule through the API for
// the paired demo user, waits for the actual local-minute tick (no fake clock, no faked scheduler),
// and asserts the observable chain:
//   schedule created → scheduleDue reaches the agent → heads-up → focus starts with source SCHEDULE →
//   ScheduleRun recorded (schedule.lastRunAt) → session persisted → end → finalised.
// The missed-run case runs with NO agent connected: the API must record a MISSED run + a
// notification and never start focus (DEC-021 §4).
//
// Time: both cases wait for a real minute boundary, so they use `test.slow()` + an explicit
// 4-minute ceiling instead of being skipped. Native dialogs (REC-004 consent, the ≥10 s cancellable
// heads-up) are stubbed inside the agent process only (KI-011) — the page can never answer them.
//
// Self-gating (e2e/helpers/features.ts): until A5's scheduler + A7's agent schedule flow are merged,
// the scheduled-session test reports `test.fixme` with the exact missing piece. The missed-run test
// has no gate: `GET /notifications` ships, so it runs the real offline-at-due-time path.

import { expect, test } from '@playwright/test';

import {
  createSchedule,
  listNotifications,
  listSchedules,
  listSessions,
  rawApiRequest,
  registerUser,
  type ApiSchedule,
} from './helpers/api';
import {
  agentAllowlistEndpointShipped,
  agentScheduleFlowShipped,
  schedulerShipped,
} from './helpers/features';
import { endFocusFromAgentWindow, stubNativeAgentDialogs } from './helpers/focus-flow';
import { pairAgentViaUi } from './helpers/pairing';

/** How far ahead the schedule is put so we never race a minute boundary at creation time. */
const LEAD_MINUTES = 2;
/** DEC-013 seed: both demo users have this IANA timezone; schedules are interpreted in it. */
const USER_TIMEZONE = 'Asia/Kolkata';
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
/** A due-time wait is legitimately minutes long; the suite timeout must not kill it. */
const DUE_WAIT_TIMEOUT_MS = 240_000;

const SCHEDULER_READY =
  schedulerShipped() && agentScheduleFlowShipped() && agentAllowlistEndpointShipped();

/**
 * Weekday (`0 = Sunday`) + `HH:mm` for a schedule due in `offsetMinutes`, computed in the USER's
 * IANA timezone — the scheduler interprets `startTime`/`days` there (REQUIREMENTS §7), so a machine
 * in a different local zone must not shift the due time.
 */
function dueIn(offsetMinutes: number): { days: number[]; startTime: string; dueAt: Date } {
  const dueAt = new Date(Date.now() + offsetMinutes * 60_000);
  dueAt.setSeconds(0, 0);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: USER_TIMEZONE,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(dueAt);
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '';
  const weekday = WEEKDAY_INDEX[part('weekday')];
  if (weekday === undefined) throw new Error(`could not resolve weekday in ${USER_TIMEZONE}`);
  return { days: [weekday], startTime: `${part('hour')}:${part('minute')}`, dueAt };
}

/** Collect the dashboard ↔ agent local-channel frames so the heads-up can be asserted on the wire. */
function captureLocalFrames(page: import('@playwright/test').Page, sink: string[]): void {
  page.on('websocket', (socket) => {
    if (!socket.url().includes('/link')) return;
    socket.on('framereceived', (frame) => {
      const text =
        typeof frame.payload === 'string'
          ? frame.payload
          : Buffer.from(frame.payload).toString('utf8');
      sink.push(text);
    });
  });
}

test.describe('Scheduled focus session (real scheduler)', () => {
  test.fixme(
    !SCHEDULER_READY,
    [
      !schedulerShipped() && 'A5 T-063 per-minute scheduler tick (server/src/cron/scheduler.ts)',
      !agentScheduleFlowShipped() && 'A7 T-064 agent scheduleDue heads-up + scheduleRunCancelled',
      !agentAllowlistEndpointShipped() && 'A5 GET /agent/allowlist (DEC-021 C-20)',
    ]
      .filter((entry): entry is string => entry !== false)
      .join('; ') + ' — not in this checkout yet, so the real due-time flow cannot be driven.',
  );

  test('a due schedule starts focus with source SCHEDULE, records the run and persists the session', async ({
    page,
    request,
  }) => {
    test.slow();
    test.setTimeout(DUE_WAIT_TIMEOUT_MS);
    // FR-012: capture the dashboard ↔ agent local channel. This MUST be registered before the
    // dashboard opens its WebSocket (during sign-in below) — `page.on('websocket')` only reports
    // sockets created after registration.
    const localFrames: string[] = [];
    captureLocalFrames(page, localFrames);

    const { agent, accessToken } = await pairAgentViaUi(page, request);
    try {
      // The agent's native consent dialog is answered inside the agent process (KI-011); the
      // scheduled >=10 s heads-up is a native notification + tray/window affordance that auto-starts
      // when its window elapses, so no dialog needs stubbing for the accept path.
      await stubNativeAgentDialogs(agent);

      const due = dueIn(LEAD_MINUTES);
      let schedule: ApiSchedule;
      await test.step(`create an enabled schedule due at local ${due.startTime}`, async () => {
        schedule = await createSchedule(request, accessToken, {
          name: 'E2E scheduled focus',
          days: due.days,
          startTime: due.startTime,
          durationMin: 25,
          enabled: true,
        });
        expect(schedule.enabled).toBe(true);
        expect(schedule.lastRunAt).toBeNull();
      });

      await test.step('the >=10 s heads-up reaches the dashboard over the local channel (FR-012)', async () => {
        await expect
          .poll(() => localFrames.filter((frame) => frame.includes('scheduleHeadsUp')).length, {
            timeout: DUE_WAIT_TIMEOUT_MS - 30_000,
            intervals: [500],
            message: `no scheduleHeadsUp local frame arrived (schedule due ${due.dueAt.toISOString()})`,
          })
          .toBeGreaterThan(0);
        const headsUp = localFrames.find((frame) => frame.includes('scheduleHeadsUp')) ?? '';
        expect(headsUp).toContain(schedule.id);
      });

      await test.step('wait for the real scheduler tick and the agent-driven SCHEDULE session', async () => {
        // The scheduler dispatches at the local minute; the agent shows the heads-up and then starts.
        await expect
          .poll(
            async () =>
              (await listSessions(request, accessToken, { status: 'ACTIVE' })).items.length,
            {
              timeout: DUE_WAIT_TIMEOUT_MS - 20_000,
              intervals: [2_000],
              message: `no SCHEDULE session started within the wait window (schedule due ${due.dueAt.toISOString()})`,
            },
          )
          .toBe(1);

        const [active] = (await listSessions(request, accessToken, { status: 'ACTIVE' })).items;
        expect(active).toBeDefined();
        expect((active as { source: string }).source).toBe('SCHEDULE');
      });

      await test.step('the ScheduleRun was recorded (schedule.lastRunAt) and the agent is FOCUSING', async () => {
        // DEC-021 §1: the dispatch creates the run and bumps `lastRunAt` (the STARTED run marker
        // observable through the frozen REST contract; there is no public schedule-run list endpoint).
        await expect
          .poll(
            async () => {
              const schedules = await listSchedules(request, accessToken);
              return schedules.items.find((item) => item.id === schedule.id)?.lastRunAt ?? null;
            },
            { timeout: 30_000, message: 'schedule.lastRunAt was not set by the scheduler tick' },
          )
          .not.toBeNull();

        await expect(agent.window.locator('#state-line')).toContainText('focus session running');
      });

      await test.step('ending the scheduled session finalises it with source SCHEDULE', async () => {
        await endFocusFromAgentWindow(agent);

        await expect
          .poll(
            async () =>
              (await listSessions(request, accessToken, { status: 'ACTIVE' })).items.length,
            { timeout: 30_000, message: 'the SCHEDULE session must be finalised after End Focus' },
          )
          .toBe(0);

        const history = await listSessions(request, accessToken);
        const finished = history.items.find(
          (item) => item.source === 'SCHEDULE' && item.status !== 'ACTIVE',
        );
        expect(finished, 'the scheduled session must be persisted in history').toBeDefined();
        expect((finished as { endedAt: string | null }).endedAt).not.toBeNull();
        expect((finished as { actualMinutes: number }).actualMinutes).toBeGreaterThanOrEqual(0);
      });
    } finally {
      await agent.close();
    }
  });
});

test.describe('Missed scheduled run (agent offline)', () => {
  // The notifications API now ships (GET /notifications), so this case runs for real — no gate.
  test('a schedule due while no agent is connected is recorded MISSED with a notification, no focus', async ({
    request,
  }) => {
    test.slow();
    test.setTimeout(DUE_WAIT_TIMEOUT_MS);

    // API-only fixture: a FRESH user (no devices, no sessions) and NO Focus Agent launched here —
    // another spec's leftover ACTIVE session can never make this offline-at-due-time test flaky.
    const { auth } = await registerUser(request);
    const accessToken = auth.accessToken;
    // A fresh account defaults to timezone `UTC` (User model), while `dueIn()` computes the due time in
    // the user's IANA timezone that the scheduler reads (`Asia/Kolkata` for the DEC-013 demo fixture).
    // Align the fixture's timezone, otherwise the schedule is due in the wrong local minute.
    const profile = await rawApiRequest(request, accessToken, 'PATCH', '/users/me', {
      timezone: USER_TIMEZONE,
    });
    expect(profile.status, 'the missed-run fixture must use the demo timezone').toBe(200);

    // The seed already contains one SCHEDULE_MISSED notification; take a baseline so only the NEW
    // notification created for this schedule can satisfy the assertion (no false positive).
    const baseline = new Set(
      (await listNotifications(request, accessToken)).items.map((item) => item.id),
    );

    const due = dueIn(LEAD_MINUTES);
    const schedule = await createSchedule(request, accessToken, {
      name: 'E2E missed focus',
      days: due.days,
      startTime: due.startTime,
      durationMin: 25,
      enabled: true,
    });

    const wasMissed = async (): Promise<{ message: string } | null> => {
      const notifications = await listNotifications(request, accessToken);
      const fresh = notifications.items.filter((item) => !baseline.has(item.id));
      return (
        fresh.find(
          (item) => item.type === 'SCHEDULE_MISSED' && item.message.includes(schedule.name),
        ) ?? null
      );
    };

    await test.step('the real scheduler records the MISSED run and notifies the user', async () => {
      await expect
        .poll(async () => (await wasMissed()) !== null, {
          timeout: DUE_WAIT_TIMEOUT_MS - 20_000,
          intervals: [2_000],
          message: `no SCHEDULE_MISSED notification for "${schedule.name}" appeared (due ${due.dueAt.toISOString()})`,
        })
        .toBe(true);

      const missed = await wasMissed();
      expect(missed?.message).toMatch(/was missed/i);
    });

    await test.step('nothing was forced: no ACTIVE session, and the run stamp was recorded', async () => {
      const active = await listSessions(request, accessToken, { status: 'ACTIVE' });
      expect(active.items, 'a missed run must never start or fake a session').toHaveLength(0);

      const schedules = await listSchedules(request, accessToken);
      expect(schedules.items.find((item) => item.id === schedule.id)?.lastRunAt).not.toBeNull();
    });
  });
});
