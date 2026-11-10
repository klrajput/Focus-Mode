// e2e/pairing.spec.ts — full dashboard ↔ Focus Agent pairing flow (T-047, FR-003/FR-004, REC-002).
// STATUS: blocked on W2 and marked `fixme` on purpose — no fake pass. The flow below is written
// against the frozen contracts so enabling it is a one-line change once the features merge:
//   INTEGRATION_CONTRACTS §2 (numbered pairing sequence) and §3.1 #8/#37/#38,
//   UX_SPEC §4.5 (/devices: list, Pair dialog, unpair), FR-003 acceptance criteria.
//
// Why it is blocked today (verified against merged `main` @ f3b847e; the W2 code itself was still
// uncommitted in the shared working tree when this file was written, so it cannot be trusted yet):
//   1. Server: `server/src/routes/index.ts` mounts ONLY `/auth`. The pairing endpoints
//      `POST /agent/register`, `POST /devices/pair`, `GET /devices`, `DELETE /devices/:id` and
//      `POST /agent/enroll/poll` (T-040) are not merged → the dashboard cannot pair a device.
//   2. Focus Agent: there is no cloud client yet (no `agent/src/cloud/`), `paired` is hard-coded
//      `false` in `agent/src/main.ts`, and the agent never calls `/agent/register` (T-042), so the
//      code shown in the window is not registered anywhere. Link auth/attestation is T-044.
//   3. Dashboard: `client/src/pages/devices.tsx` renders a DISABLED "Pair a device" button and no
//      dialog/unpair control; the live AgentLink provider (port scan 4545–4549, badge updates) is
//      T-045/T-046. The badge therefore always shows "Disconnected" in W1.
//   4. KI-009: the agent's headless mode creates no renderer window, so the pairing code can only be
//      read from the visible agent window (`AGENT_HEADLESS=0`) until A7 exposes it test-safely.
//
// The steps that ALREADY work and are covered by e2e/smoke.spec.ts: real signup/login to the
// dashboard, and launching the real Electron agent + reading its 6-digit code. Keep those green;
// delete the `test.fixme(...)` call below when items 1–3 merge (item 4 can stay as the launch mode),
// then re-check the dialog/button labels against the merged UX copy before trusting a green run.

import { expect, test } from '@playwright/test';

import { launchAgent } from './helpers/agent';
import { signUpViaUi } from './helpers/auth';
import { uniqueEmail } from './helpers/config';

test.describe('Pairing: dashboard ↔ Focus Agent (W2)', () => {
  test.fixme(
    true,
    'Blocked on W2: pairing REST endpoints (T-040), agent cloud client + link auth (T-042/T-044) ' +
      'and the dashboard Pair/Unpair UI + AgentLink provider (T-045/T-046) are not merged to main.',
  );

  test('signup → pair a device → Connected badge + device listed → unpair → Disconnected', async ({
    page,
  }) => {
    // The real agent starts unpaired and pre-registers its pairing digest (INTEGRATION_CONTRACTS §2.1;
    // the registration call lands with T-042 — the helper only launches the app and reads the code).
    const agent = await launchAgent();
    try {
      const pairingCode = agent.pairingCode;
      expect(pairingCode).toMatch(/^\d{6}$/);

      // A fresh USER account owns the device (REC-002: pairing requires a signed-in user).
      await signUpViaUi(page, {
        name: 'Pairing E2E',
        email: uniqueEmail('pairing'),
        password: 'E2ePass123',
      });

      // §2.3: the user types the agent-displayed code into the dashboard /devices Pair dialog.
      await page.getByRole('link', { name: 'Devices' }).click();
      await expect(page).toHaveURL(/\/devices$/);
      await page.getByRole('button', { name: 'Pair a device' }).click();
      await page.getByLabel('Pairing code').fill(pairingCode);
      await page.getByRole('button', { name: 'Pair device' }).click();

      // §2.4–2.5: dashboard nudges the agent, the agent polls and receives the device token, then the
      // live local link (T-045) flips the persistent badge and lists the device (FR-003/FR-004).
      await expect(page.getByRole('status', { name: 'Focus Agent status: Connected' })).toBeVisible(
        { timeout: 15_000 },
      );
      await expect(page.getByRole('listitem').filter({ hasText: 'Focus Agent' })).toBeVisible();

      // Unpair revokes the device token and returns the agent to IDLE (INTEGRATION_CONTRACTS §3.1 #10).
      await page.getByRole('button', { name: 'Unpair' }).click();
      await page.getByRole('button', { name: 'Unpair device' }).click();
      await expect(page.getByRole('listitem').filter({ hasText: 'Focus Agent' })).toHaveCount(0);
      await expect(
        page.getByRole('status', { name: 'Focus Agent status: Not paired' }),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await agent.close();
    }
  });
});
