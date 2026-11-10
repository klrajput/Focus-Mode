// e2e/focus.spec.ts — end-to-end focus session on the real FakeDriver (T-047; T-050–T-051,
// T-056–T-058, T-060; FR-005/FR-006/FR-007/FR-009/FR-010/FR-024/FR-027, REC-004).
//
// Why: this is the product's core loop — dashboard Start → pre-session consent (client modal, no
// `enterFocus` before Confirm) → agent journals intent, applies the FakeDriver aside set and answers
// `focusStarted` → dashboard records the session (POST /sessions) and shows the live countdown →
// End Focus → agent restores idempotently and answers `focusEnded` → dashboard finalises the session.
// Every layer here is the production implementation: real Vite dashboard, real Express + in-memory
// MongoDB API, real Electron Focus Agent with `AGENT_FOCUS_DRIVER=fake`. Nothing is mocked.
//
// What is observed without touching product code:
//   · API truth via `GET /sessions` (ACTIVE → CANCELLED) — contract §3.1 #12–#14;
//   · INV-4/INV-5 via the agent's real journal file (`focus-journal.json` in its temp `userData`):
//     present while FOCUSING, gone after the idempotent restore (agent/src/focus/journal.ts);
//   · the agent window's own headline (`AGENT_STATE_HEADLINES` in agent/src/ui/view-state.ts) and the
//     live dashboard ring (`FocusRing`, role="img" aria-label "Focus session: …").
// REC-004's native first-run consent dialog runs inside the Electron main process; the spec stubs
// `dialog.showMessageBox` INSIDE the agent process (test-only seam, production code untouched) so a
// native modal cannot hang the run. That is also the honest proof the page cannot answer it: the
// dialog is answered in the agent's own process, never through the browser.
//
// Requires A7's T-051 wiring (`agent/src/link/handlers.ts`, `focus/consent.ts`, `main.ts`) and A4's
// T-056–T-058 UI (`components/focus/*`, dashboard Start wiring, live `/focus` page) — both are
// merged when this test runs; there is no fixme here because the flow is exercised for real.

import { existsSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { listSessions, rawApiRequest } from './helpers/api';
import { CLIENT_ORIGIN } from './helpers/config';
import {
  agentFocusLinkShipped,
  clientFocusUiShipped,
  sessionsAndAllowlistApiShipped,
} from './helpers/features';
import { pairAgentViaUi } from './helpers/pairing';

const JOURNAL_FILE_NAME = 'focus-journal.json';
const PLANNED_MINUTES = 25;

const FOCUS_MISSING = [
  !sessionsAndAllowlistApiShipped() &&
    'A5 sessions API (POST/GET /sessions; server W3 branch feat/a5-w3-sessions-allowlist not merged)',
  !clientFocusUiShipped() && 'A4 Start/Consent//focus UI wiring (components/focus/* not wired)',
  !agentFocusLinkShipped() &&
    'A7 focus link handlers + native consent (agent/src/link/handlers.ts)',
].filter((entry): entry is string => entry !== false && entry !== undefined);

test.describe('Focus session (FakeDriver)', () => {
  // Self-gating (see e2e/helpers/features.ts): runs for real as soon as every W3 piece is in the
  // checkout under test; otherwise it is a `fixme` naming the exact missing piece — never a fake pass.
  test.fixme(
    FOCUS_MISSING.length > 0,
    `Blocked on W3 features missing from this checkout: ${FOCUS_MISSING.join('; ')}.`,
  );

  test('Start → consent → /focus countdown → End Focus → agent restores → session CANCELLED in API', async ({
    page,
    request,
  }) => {
    const { agent, device, accessToken } = await pairAgentViaUi(page, request);
    try {
      // REC-004: answer the agent's native first-run consent dialog inside the agent process only.
      await agent.app.evaluate(({ dialog }) => {
        const nativeDialog = dialog as unknown as Record<string, unknown>;
        nativeDialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
        nativeDialog.showMessageBoxSync = () => 0;
      });

      await test.step('Start Focus opens the consent gate and no session exists yet (FR-009)', async () => {
        await page.getByRole('link', { name: 'Dashboard' }).click();
        await expect(page).toHaveURL(/\/dashboard$/);

        // DurationChips renders 25/50/60 as buttons (`{minutes} min`) — UX_SPEC §4.3 / T-056.
        await page.getByRole('button', { name: `${PLANNED_MINUTES} min`, exact: true }).click();
        await page.getByRole('button', { name: 'Start Focus' }).click();

        // ConsentModal title: `Start a ${durationMin}-minute focus session?` (UX_SPEC §5 copy).
        const consent = page.getByRole('dialog', {
          name: `Start a ${PLANNED_MINUTES}-minute focus session?`,
        });
        await expect(consent).toBeVisible();
        await expect(consent.getByRole('heading', { name: 'These stay open' })).toBeVisible();
        await expect(
          consent.getByRole('heading', { name: 'You can end focus any time' }),
        ).toBeVisible();

        // No `enterFocus` may have happened before Confirm → no ACTIVE session in the API.
        expect(
          (await listSessions(request, accessToken, { status: 'ACTIVE' })).items,
          'no session may exist before the user confirms',
        ).toHaveLength(0);

        await consent.getByRole('button', { name: 'Confirm — start focus' }).click();
      });

      let activeSessionId: string;
      await test.step('focus applied: the live /focus ring shows and the API records ACTIVE', async () => {
        await expect(page).toHaveURL(/\/focus$/, { timeout: 20_000 });
        await expect(page.getByRole('button', { name: 'End Focus' }).first()).toBeVisible();
        // FocusRing exposes the full sentence as its accessible name (UX_SPEC §10.4).
        await expect(page.getByRole('img', { name: /Focus session: .*remaining/i })).toBeVisible();

        await expect
          .poll(
            async () =>
              (await listSessions(request, accessToken, { status: 'ACTIVE' })).items.length,
            { timeout: 20_000, message: 'the dashboard must POST /sessions after focusStarted' },
          )
          .toBe(1);

        const [active] = (await listSessions(request, accessToken, { status: 'ACTIVE' })).items;
        expect(active).toBeDefined();
        activeSessionId = (active as { id: string }).id;
        expect((active as { deviceId: string }).deviceId).toBe(device.id);
        expect((active as { plannedMinutes: number }).plannedMinutes).toBe(PLANNED_MINUTES);
        expect((active as { source: string }).source).toBe('MANUAL');

        // INV-4: the journal exists while focus is applied (written before the driver aside call).
        const journalPath = path.join(agent.userDataDir, JOURNAL_FILE_NAME);
        await expect.poll(() => existsSync(journalPath), { timeout: 10_000 }).toBe(true);

        // The agent's own window is the OS-truth surface (`AGENT_STATE_HEADLINES.FOCUSING`).
        await expect(agent.window.locator('#state-line')).toContainText('focus session running');
      });

      await test.step('End Focus restores and finalises the session (FR-006, INV-5)', async () => {
        await page.getByRole('button', { name: 'End Focus' }).first().click();
        await expect(page.getByText(/Focus ended — your windows are back\./)).toBeVisible({
          timeout: 20_000,
        });

        await expect
          .poll(
            async () =>
              (await listSessions(request, accessToken, { status: 'ACTIVE' })).items.length,
            { timeout: 20_000, message: 'the dashboard must PATCH the session after focusEnded' },
          )
          .toBe(0);

        const history = await listSessions(request, accessToken, { status: 'CANCELLED' });
        const finished = history.items.find((item) => item.id === activeSessionId);
        expect(finished, 'the manually ended session must be CANCELLED in history').toBeDefined();
        expect((finished as { endedAt: string | null }).endedAt).not.toBeNull();
        expect((finished as { actualMinutes: number }).actualMinutes).toBeGreaterThanOrEqual(0);
        expect((finished as { endReason: string | null }).endReason).toBeTruthy();

        // INV-5: the journal is cleared once restore completed, and the agent reports ready again.
        const journalPath = path.join(agent.userDataDir, JOURNAL_FILE_NAME);
        await expect.poll(() => existsSync(journalPath), { timeout: 10_000 }).toBe(false);
        await expect(agent.window.locator('#state-line')).toContainText('Paired — ready', {
          timeout: 20_000,
        });
      });

      await test.step('the dashboard is back to a normal, non-focusing state', async () => {
        await expect(page.getByText('Focus session running')).toHaveCount(0, { timeout: 15_000 });
        // Keep the fixture tidy for the next spec: unpair through the real API.
        const unpair = await rawApiRequest(
          request,
          accessToken,
          'DELETE',
          `/devices/${encodeURIComponent(device.id)}`,
        );
        expect([200, 404]).toContain(unpair.status);
        await page.goto(`${CLIENT_ORIGIN}/devices`);
      });
    } finally {
      await agent.close();
    }
  });
});
