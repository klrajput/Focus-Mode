// e2e/helpers/pairing.ts — reusable "bring a real Focus Agent from unpaired to Connected" fixture
// (T-047, owner A8).
// Why: the focus flow needs a paired, attested agent before it can start; duplicating the W2 pairing
// steps in every spec would drift. This helper performs the same real steps as `pairing.spec.ts`
// (API-seeded account → real Electron agent → Pair dialog → `POST /devices/pair` → agent polls its
// token → real EdDSA attestation) and returns the live handles.
// Invariants: no mocks (real API + real Electron + FakeDriver); the DEC-013 demo devices are
// unpaired first so the dashboard's `GET /devices` attestation target is the agent under test.
// No page reload is needed: KI-010 is fixed — the agent re-issues `hello {paired:true}` + a fresh
// challenge to connected dashboards, so the badge flips to `Connected` live (verified W4).
// Callers MUST `await fixture.agent.close()` (or let the helper clean up on failure) in a finally block.

import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { launchAgent, type LaunchedAgent } from './agent';
import { listDevices, loginUser, revokeDevice, type ApiDevice } from './api';
import { signInViaUi } from './auth';
import { DEMO_USER } from './config';

export interface PairedAgentFixture {
  readonly agent: LaunchedAgent;
  readonly device: ApiDevice;
  /** Bearer token of the seeded USER that owns the paired device (for API-truth assertions). */
  readonly accessToken: string;
}

/** Sign up nothing, fake nothing: pair the real agent to the seeded USER through the real UI. */
export async function pairAgentViaUi(
  page: Page,
  request: APIRequestContext,
): Promise<PairedAgentFixture> {
  const session = await loginUser(request, DEMO_USER);

  // Deterministic target: the seed ships demo devices; unpair them through the real API first.
  for (const seededDevice of (await listDevices(request, session.accessToken)).items) {
    await revokeDevice(request, session.accessToken, seededDevice.id);
  }
  expect((await listDevices(request, session.accessToken)).total).toBe(0);

  const agent = await launchAgent();
  try {
    await signInViaUi(page, DEMO_USER);
    await page.getByRole('link', { name: 'Devices' }).first().click();
    await expect(page).toHaveURL(/\/devices$/);

    await page.getByRole('button', { name: 'Pair a device' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Pair a device' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('6-digit pairing code').fill(agent.pairingCode);
    await dialog.getByRole('button', { name: 'Pair device' }).click();
    await expect(page.getByText('Agent connected')).toBeVisible({ timeout: 15_000 });

    await expect
      .poll(async () => (await listDevices(request, session.accessToken)).items[0]?.status, {
        timeout: 30_000,
        message: 'the paired Focus Agent must open its cloud link (status CONNECTED)',
      })
      .toBe('CONNECTED');

    const [device] = (await listDevices(request, session.accessToken)).items;
    if (device === undefined)
      throw new Error('pairing succeeded but GET /devices returned no device');

    // KI-010 fixed: the live badge reaches `Connected` without any page reload.
    await expect(page.getByRole('status', { name: 'Focus Agent status: Connected' })).toBeVisible({
      timeout: 30_000,
    });

    return { agent, device, accessToken: session.accessToken };
  } catch (error) {
    await agent.close();
    throw error;
  }
}
