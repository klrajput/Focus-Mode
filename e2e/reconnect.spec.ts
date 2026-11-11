// e2e/reconnect.spec.ts — T-080: real agent crash mid-focus, honest lost-contact UI, relaunch,
// re-attestation/state resync, and session finalisation through the recovery-reporting path
// (FR-014/FR-023/FR-027, INV-5).
//
// Why: reconnect is the failure mode where dishonest UIs lie to the user ("still focusing" while
// the agent is gone). This spec uses a **real SIGKILL** of the Electron main process (no fake
// clocks, no graceful shutdown), asserts the dashboard immediately shows the F-02 lost-contact
// state and a Disconnected badge, then relaunches the agent against the SAME `userData` directory:
//   · the agent restores from its journal on start (CRASH_RECOVERY, INV-4/INV-5) and queues a
//     `session.ended` cloud report;
//   · in this sandbox `safeStorage` is unavailable (macOS keychain blocked), so the device token is
//     memory-only and the relaunched agent comes up **unpaired** — the documented fallback. The spec
//     honestly re-pairs through the real dashboard UI (second code), which is the observable
//     recovery path here; where a keychain is available the same flow simply skips the re-pair.
//   · on the next cloud connection the queued CRASH_RECOVERY report flushes and the API finalises
//     the session exactly once: status CANCELLED, endReason CRASH_RECOVERY, actualMinutes bounded.
//
// What stays honest: while the agent is dead the API still shows the session ACTIVE (the server has
// not heard otherwise yet) — the spec asserts the UI shows "Lost contact" instead of pretending the
// live link is fine, and never renders a fake Connected/Focusing state.
//
// NEEDS-HUMAN: a keychain-backed relaunch (token persists → no re-pair) and the tray "End focus"
// item remain manual (KI-013); this spec covers the crash/recovery/reporting contract.

import { rmSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { listSessions, rawApiRequest } from './helpers/api';
import { startFocusViaUi, stubNativeAgentDialogs } from './helpers/focus-flow';
import { pairAgentViaUi } from './helpers/pairing';

test.describe('Reconnect after a real agent crash (T-080)', () => {
  test('SIGKILL mid-focus → honest lost-contact UI → relaunch/re-pair → session finalised CRASH_RECOVERY', async ({
    page,
    request,
  }) => {
    test.slow();
    test.setTimeout(180_000);

    const { agent, accessToken } = await pairAgentViaUi(page, request);
    // REC-004 native first-run consent is answered inside the agent process only (KI-011 seam); a web
    // page must never be able to answer it, and without the stub the first `enterFocus` never returns.
    await stubNativeAgentDialogs(agent);
    const agentUserDataDir = agent.userDataDir;
    let relaunched: Awaited<ReturnType<typeof agent.relaunch>> | undefined;
    try {
      await startFocusViaUi(page, 25);
      const [active] = (await listSessions(request, accessToken, { status: 'ACTIVE' })).items;
      expect(active, 'focus must have created an ACTIVE session before the crash').toBeDefined();
      const clientSessionId = (active as { clientSessionId: string }).clientSessionId;

      await test.step('SIGKILL the agent → the dashboard shows the honest lost-contact state', async () => {
        agent.killProcess();

        // F-02 copy on /focus + the AppShell badge must both tell the truth (no fake Connected).
        await expect(page.getByText(/Lost contact with your Focus Agent/i).first()).toBeVisible({
          timeout: 15_000,
        });
        await expect(
          page.getByRole('status', { name: 'Focus Agent status: Disconnected' }),
        ).toBeVisible({ timeout: 15_000 });

        // Server truth has not been told yet: the session is still ACTIVE, and the UI does not
        // invent a local end (the Reload/Reconnect action is the way forward).
        const stillActive = await listSessions(request, accessToken, { status: 'ACTIVE' });
        expect(stillActive.items.map((item) => item.id)).toContain(active?.id);
      });

      await test.step('relaunch on the same userData dir: journal recovery ran on start', async () => {
        relaunched = await agent.relaunch();
        // The fresh process has no window yet in the first instant; wait for the agent UI.
        await expect(relaunched.window.locator('#state-line')).toBeVisible({ timeout: 30_000 });

        // In this sandbox the token is memory-only (safeStorage unavailable) → unpaired fallback.
        // The badge must be Not paired/Connected truthfully, never a stale Connected.
        await expect(
          page.getByRole('status', { name: 'Focus Agent status: Not paired' }),
        ).toBeVisible({ timeout: 25_000 });

        // INV-5: the crash journal is consumed by the recovery restore (no stuck intent file).
        await expect
          .poll(
            async () => {
              const { existsSync } = await import('node:fs');
              const path = await import('node:path');
              return existsSync(path.join(agentUserDataDir, 'focus-journal.json'));
            },
            { timeout: 20_000, message: 'crash recovery must clear the journal after restoring' },
          )
          .toBe(false);
      });

      await test.step('re-attest after the documented re-pair fallback (badge Connected)', async () => {
        await page.getByRole('link', { name: 'Devices' }).first().click();
        await page.getByRole('button', { name: 'Pair a device' }).first().click();
        const dialog = page.getByRole('dialog', { name: 'Pair a device' });
        const code =
          (await relaunched?.window.locator('#pairing-code').textContent())?.replace(/\D/g, '') ??
          '';
        expect(code, 'the unpaired relaunched agent must show a fresh 6-digit code').toMatch(
          /^\d{6}$/,
        );
        await dialog.getByLabel('6-digit pairing code').fill(code);
        await dialog.getByRole('button', { name: 'Pair device' }).click();

        // Re-attestation: only the real EdDSA attestation path flips the badge to Connected.
        await expect(
          page.getByRole('status', { name: 'Focus Agent status: Connected' }),
        ).toBeVisible({ timeout: 45_000 });
      });

      await test.step('the queued CRASH_RECOVERY report finalises the session exactly once (API truth)', async () => {
        await expect
          .poll(
            async () => {
              const sessions = await listSessions(request, accessToken);
              return sessions.items.find((item) => item.clientSessionId === clientSessionId)
                ?.status;
            },
            { timeout: 30_000, message: 'the recovery report must finalise the crashed session' },
          )
          .not.toBe('ACTIVE');

        const sessions = await listSessions(request, accessToken);
        const recovered = sessions.items.filter((item) => item.clientSessionId === clientSessionId);
        expect(recovered, 'no duplicate session documents (REC-006 idempotency)').toHaveLength(1);
        const finished = recovered[0];
        expect(finished?.status).toBe('CANCELLED');
        expect(finished?.endReason).toBe('CRASH_RECOVERY');
        expect(finished?.endedAt).not.toBeNull();
        expect(finished?.actualMinutes).toBeGreaterThanOrEqual(0);

        // State resync: the dashboard drops the lost-contact banner and the live state is truthful.
        await expect(page.getByText(/Lost contact with your Focus Agent/i)).toHaveCount(0, {
          timeout: 20_000,
        });
        await expect(page.getByText('Focus session running')).toHaveCount(0);

        // Fixture hygiene: revoke every device token (the crash left a stale device row behind).
        const cleanup = await rawApiRequest(request, accessToken, 'POST', '/devices/unpair-all');
        expect([200, 404]).toContain(cleanup.status);
      });
    } finally {
      if (relaunched !== undefined) await relaunched.close().catch(() => undefined);
      rmSync(agentUserDataDir, { recursive: true, force: true });
    }
  });
});
