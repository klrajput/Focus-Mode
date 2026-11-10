// e2e/session-reporting.spec.ts — the dashboard-closed session path (W4 gate, REC-006/FR-027,
// INV-5; DEC-021).
//
// Why: FR-027 says a session must survive the dashboard being closed, and the agent is the only
// component still running then. This spec proves the merge path: start focus from the dashboard,
// close the browser tab, end the session from the Focus Agent itself, and assert the session is
// persisted through the agent's cloud report — exactly once (same `clientSessionId`, no duplicate
// document) — with the terminal status and actualMinutes set.
//
// What is automated vs NEEDS-HUMAN:
//   · automated here: closing the page (dashboard gone), ending focus from the agent's own window
//     (same `controller.exitFocus` path the tray uses, INV-5), and the API/DB truth via the REST
//     contract (`GET /sessions`).
//   · NEEDS-HUMAN: the literal native macОS **tray menu click** ("End focus") — Playwright cannot
//     drive a native NSMenu; see KI-013. The agent-window button exercises the identical controller
//     path, so the reporting contract is covered; the physical tray click is on the Phase-8 checklist.
//
// Self-gating: needs A7's agent→cloud `session.started/ended` reports + A5's reporting merge. Until
// those are in the checkout this file reports `test.fixme` with the exact missing piece.

import { expect, test } from '@playwright/test';

import { listSessions } from './helpers/api';
import {
  agentCloudSessionReportingShipped,
  agentFocusLinkShipped,
  clientFocusUiShipped,
  serverSessionReportingShipped,
  sessionsAndAllowlistApiShipped,
} from './helpers/features';
import {
  endFocusFromAgentWindow,
  startFocusViaUi,
  stubNativeAgentDialogs,
} from './helpers/focus-flow';
import { pairAgentViaUi } from './helpers/pairing';

const REPORTING_READY =
  sessionsAndAllowlistApiShipped() &&
  clientFocusUiShipped() &&
  agentFocusLinkShipped() &&
  agentCloudSessionReportingShipped() &&
  serverSessionReportingShipped();

test.describe('Session reporting with the dashboard closed (FR-027, REC-006)', () => {
  test.fixme(
    !REPORTING_READY,
    [
      !sessionsAndAllowlistApiShipped() && 'A5 sessions/allow-list API',
      !clientFocusUiShipped() && 'A4 focus UI',
      !agentFocusLinkShipped() && 'A7 focus link handlers',
      !agentCloudSessionReportingShipped() &&
        'A7 agent→cloud session.started/session.ended reporting (dashboard-closed path)',
      !serverSessionReportingShipped() && 'A5 cloud reporting merge (REC-006 idempotent finalise)',
    ]
      .filter((entry): entry is string => entry !== false)
      .join('; ') + ' — not in this checkout yet, so the dashboard-closed path cannot be verified.',
  );

  test('dashboard closed → agent reports the end → exactly one finalised session', async ({
    page,
    request,
  }) => {
    test.slow();
    const { agent, accessToken } = await pairAgentViaUi(page, request);
    try {
      await stubNativeAgentDialogs(agent);
      await startFocusViaUi(page, 25);

      let sessionId: string;
      let clientSessionId: string;
      await test.step('the dashboard recorded the ACTIVE session before it closes', async () => {
        await expect
          .poll(
            async () =>
              (await listSessions(request, accessToken, { status: 'ACTIVE' })).items.length,
            { timeout: 20_000, message: 'POST /sessions must happen after focusStarted' },
          )
          .toBe(1);
        const [active] = (await listSessions(request, accessToken, { status: 'ACTIVE' })).items;
        expect(active).toBeDefined();
        sessionId = (active as { id: string }).id;
        clientSessionId = (active as { clientSessionId: string }).clientSessionId;
      });

      const totalBeforeClose = (await listSessions(request, accessToken)).total;

      await test.step('close the dashboard tab — the agent keeps running (FR-027)', async () => {
        await page.close();
      });

      await test.step('end focus from the agent and let its cloud report persist the session', async () => {
        await endFocusFromAgentWindow(agent);

        await expect
          .poll(
            async () =>
              (await listSessions(request, accessToken, { status: 'ACTIVE' })).items.length,
            { timeout: 30_000, message: 'the agent report must finalise the session' },
          )
          .toBe(0);
      });

      await test.step('exactly one finalised session exists — no duplicate from the merge', async () => {
        const history = await listSessions(request, accessToken);
        const withSameClientId = history.items.filter(
          (item) => item.clientSessionId === clientSessionId,
        );
        expect(
          withSameClientId,
          'the agent report and the dashboard document must merge on clientSessionId (REC-006)',
        ).toHaveLength(1);

        const finished = withSameClientId[0];
        expect(finished?.id).toBe(sessionId);
        expect(['COMPLETED', 'CANCELLED']).toContain(finished?.status);
        expect(finished?.endedAt).not.toBeNull();
        expect(finished?.actualMinutes).toBeGreaterThanOrEqual(0);

        expect(history.total, 'reporting merge must not create extra session documents').toBe(
          totalBeforeClose,
        );
      });
    } finally {
      await agent.close();
    }
  });
});
