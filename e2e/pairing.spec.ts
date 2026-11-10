// e2e/pairing.spec.ts — the full dashboard ↔ Focus Agent pairing flow, executed for real
// (T-047, FR-003/FR-004, REC-002/REC-003; INTEGRATION_CONTRACTS §2 and §3.1 #8/#9/#10/#11).
//
// Why this spec exists: pairing is the only flow that spans all three components — the dashboard
// types a 6-digit code, the Express API binds the pending device, and the real Electron Focus Agent
// polls for its device token, opens the cloud link, and then authenticates the dashboard over the
// loopback WebSocket with a cloud-signed EdDSA attestation. A mocked layer would prove nothing (the
// exam forbids faked backend/agent), so every step below uses the production code paths:
//   dashboard (Vite) → real API (Express + in-memory MongoDB + DEC-013 seed) → real Electron agent.
//
// Notes that make the run deterministic (each one is an honest arrangement, never a fake pass):
//   1. The DEC-013 seed ships TWO demo devices for the seeded USER, one of them `CONNECTED`
//      (`Kabir-MacBook`). The dashboard resolves the device it should attest from `GET /devices`
//      (first CONNECTED, then first paired), so leaving stale demo devices in place makes the
//      attestation target ambiguous. The spec first unpairs those demo devices via the real
//      `DELETE /devices/:id` API — the same action a user takes — so the agent under test is the
//      only device on the account.
//   2. KI-009: `AGENT_HEADLESS=1` creates no renderer window, so the 6-digit code can only be read
//      from the agent's real window; the helper launches with `AGENT_HEADLESS=0` (a display is
//      required — local macOS is fine, Linux CI needs `xvfb-run`).
//   3. KI-010 is FIXED (W4): the agent re-issues `hello {paired:true}` + a fresh challenge to already
//      connected dashboards and closes authenticated sockets on unpair (1008), so the persistent
//      badge flips `Connected` / `Disconnected` live — this spec asserts that WITHOUT any reload.

import { expect, test, type Page } from '@playwright/test';

import { launchAgent } from './helpers/agent';
import { listDevices, loginUser, revokeDevice, type ApiDevice } from './helpers/api';
import { signInViaUi } from './helpers/auth';
import { DEMO_USER } from './helpers/config';

/** The persistent badge from AppShell (its aria-label is `Focus Agent status: <label>`). */
function agentBadge(page: Page) {
  return page.getByRole('status', { name: /Focus Agent status:/ });
}

/** Text of the row that shows one device on `/devices`. */
function deviceRow(page: Page, deviceName: string) {
  return page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: deviceName }) });
}

test.describe('Pairing: dashboard ↔ Focus Agent', () => {
  test('a real Focus Agent pairs on /devices, connects, and unpairs again', async ({
    page,
    request,
  }) => {
    // Arrange with the real API: the same identity the UI will use (seeded USER, DEC-013).
    const session = await loginUser(request, DEMO_USER);

    await test.step('clear the seeded demo devices (real DELETE /devices/:id)', async () => {
      const seeded = await listDevices(request, session.accessToken);
      for (const device of seeded.items) {
        await revokeDevice(request, session.accessToken, device.id);
      }
      expect((await listDevices(request, session.accessToken)).total).toBe(0);
    });

    // The real unpaired Focus Agent: registers its code digest with the API, shows the code only in
    // its own window (DEC-003), and waits for the dashboard to pair it.
    const agent = await launchAgent();
    try {
      const pairingCode = agent.pairingCode;
      expect(pairingCode).toMatch(/^\d{6}$/);

      await test.step('sign in as the seeded USER and open /devices', async () => {
        await signInViaUi(page, DEMO_USER);
        await page.getByRole('link', { name: 'Devices' }).click();
        await expect(page).toHaveURL(/\/devices$/);
        // Both the page header and the empty state offer the action; the header one is first in DOM.
        await expect(page.getByRole('button', { name: 'Pair a device' }).first()).toBeVisible();
      });

      const badgeBefore = await agentBadge(page).getAttribute('aria-label');
      console.log(`[pairing] badge before pairing: ${badgeBefore}`);

      await test.step('enter the agent-displayed code in the Pair dialog', async () => {
        await page.getByRole('button', { name: 'Pair a device' }).first().click();
        const dialog = page.getByRole('dialog', { name: 'Pair a device' });
        await expect(dialog).toBeVisible();
        await dialog.getByLabel('6-digit pairing code').fill(pairingCode);
        await dialog.getByRole('button', { name: 'Pair device' }).click();

        // §2.3 succeeds against the real API; UX_SPEC §4.5 approved success sentence.
        await expect(page.getByText('Agent connected')).toBeVisible({ timeout: 15_000 });
        await expect(dialog).toBeHidden({ timeout: 15_000 });
      });

      let pairedDevice: ApiDevice;
      await test.step('the API bound exactly one device and the agent went CONNECTED', async () => {
        await expect
          .poll(async () => (await listDevices(request, session.accessToken)).total, {
            timeout: 30_000,
            message: 'the newly paired Focus Agent must appear in GET /devices',
          })
          .toBe(1);

        const [device] = (await listDevices(request, session.accessToken)).items;
        expect(device, 'GET /devices must return the paired Focus Agent').toBeDefined();
        pairedDevice = device as ApiDevice;
        expect(pairedDevice.pairedAt).not.toBeNull();

        // §2.5 + §5.1: the agent polls its token and opens `/agent-link`; the hub marks it CONNECTED.
        await expect
          .poll(async () => (await listDevices(request, session.accessToken)).items[0]?.status, {
            timeout: 30_000,
            message: 'the agent under test must open its cloud link (status CONNECTED)',
          })
          .toBe('CONNECTED');
      });

      await test.step('the paired device is listed in the dashboard', async () => {
        await expect(deviceRow(page, pairedDevice.name)).toBeVisible({ timeout: 15_000 });
      });

      await test.step('the attested handshake flips the persistent badge to Connected (no reload)', async () => {
        // REC-003: the dashboard asks the API for a 60 s attestation and the agent verifies it.
        // KI-010 fixed: the agent re-hellos/challenges connected dashboards, so this is live.
        await expect(
          page.getByRole('status', { name: 'Focus Agent status: Connected' }),
        ).toBeVisible({ timeout: 30_000 });
        console.log(
          `[pairing] badge after pairing, NO reload: ${await agentBadge(page).getAttribute('aria-label')}`,
        );
        await expect(deviceRow(page, pairedDevice.name)).toBeVisible();
      });

      await test.step('unpair removes the device and clears the Connected state', async () => {
        await deviceRow(page, pairedDevice.name).getByRole('button', { name: 'Unpair' }).click();
        const confirm = page.getByRole('dialog', { name: 'Unpair this device?' });
        await expect(confirm).toBeVisible();
        await confirm.getByRole('button', { name: 'Unpair', exact: true }).click();

        await expect(page.getByText('Device unpaired')).toBeVisible({ timeout: 15_000 });
        await expect(deviceRow(page, pairedDevice.name)).toHaveCount(0, { timeout: 20_000 });
        await expect(page.getByText('No device connected — start your Focus Agent')).toBeVisible({
          timeout: 20_000,
        });
        await expect
          .poll(async () => (await listDevices(request, session.accessToken)).total, {
            timeout: 20_000,
            message: 'DELETE /devices/:id must remove the device server-side',
          })
          .toBe(0);

        // KI-010 fixed: unpair closes the authenticated sockets (1008) and the badge drops live.
        await expect(
          page.getByRole('status', { name: 'Focus Agent status: Connected' }),
        ).toHaveCount(0, { timeout: 20_000 });
        console.log(
          `[pairing] badge after unpair, NO reload: ${await agentBadge(page).getAttribute('aria-label')}`,
        );
        await expect(page.getByText('No device connected — start your Focus Agent')).toBeVisible({
          timeout: 20_000,
        });
      });
    } finally {
      await agent.close();
    }
  });
});
