// e2e/settings.spec.ts — account self-service on `/settings` (W5 gate; FR-029, contract §3.1
// #6/#7/#25 + W5 delta C-23 unpair-all).
//
// Why: settings is where a user changes their password, unlinks devices and downloads the Focus
// Agent. Each of those is a security-relevant promise:
//   · password change → the old password must stop working and the new one must work (API truth);
//   · unpair-all → every device token is revoked (API truth) and a paired agent is actually revoked
//     (it loses its token and returns to unpaired — the local link closes, KI-010 fix);
//   · download links → only the real URLs published by `GET /agent-links` may be rendered (no
//     invented installers).
// A throwaway account is used for the password change so the shared demo identities stay intact.
//
// Self-gating: needs A4's `/settings` UI + A5's `PATCH /users/me` / `POST /users/me/password`
// (+ `/agent-links`, `/devices/unpair-all` for the relevant cases).

import { expect, test } from '@playwright/test';

import { errorCodeOf, listAgentLinks, listDevices, loginUser, rawApiRequest } from './helpers/api';
import { signInViaUi, signUpViaUi } from './helpers/auth';
import { DEMO_USER, uniqueEmail } from './helpers/config';
import {
  agentLinksApiShipped,
  clientSettingsUiShipped,
  unpairAllShipped,
  usersSelfServiceApiShipped,
} from './helpers/features';
import { pairAgentViaUi } from './helpers/pairing';

const SETTINGS_READY = clientSettingsUiShipped() && usersSelfServiceApiShipped();
const UNPAIR_READY = SETTINGS_READY && unpairAllShipped();
const DOWNLOADS_READY = SETTINGS_READY && agentLinksApiShipped();

test.describe('Settings — change password (FR-029)', () => {
  test.fixme(
    !SETTINGS_READY,
    'A4 W5 /settings UI (password form) and/or A5 users self-service API ' +
      '(`POST /users/me/password`) are not merged into this checkout yet.',
  );

  test('changing the password makes the old one fail and the new one work', async ({
    page,
    request,
  }) => {
    const credentials = {
      name: 'Settings Password',
      email: uniqueEmail('settings-pw'),
      password: 'E2ePass123',
    };
    const newPassword = 'E2ePass456';

    // Real signup through the UI establishes the session the settings page runs under.
    await signUpViaUi(page, credentials);
    await page.getByRole('link', { name: 'Settings' }).first().click();
    await expect(page).toHaveURL(/\/settings$/);

    await page
      .getByLabel(/current password/i)
      .first()
      .fill(credentials.password);
    await page
      .getByLabel(/^new password/i)
      .first()
      .fill(newPassword);
    await page
      .getByLabel(/confirm/i)
      .first()
      .fill(newPassword);
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.getByText(/password updated/i)).toBeVisible({ timeout: 15_000 });

    // API truth: old password rejected, new password accepted.
    const oldLogin = await rawApiRequest(request, null, 'POST', '/auth/login', {
      email: credentials.email,
      password: credentials.password,
    });
    expect(oldLogin.status).toBe(401);
    expect(errorCodeOf(oldLogin)).toBe('UNAUTHENTICATED');

    const newLogin = await rawApiRequest(request, null, 'POST', '/auth/login', {
      email: credentials.email,
      password: newPassword,
    });
    expect(newLogin.status).toBe(200);
  });
});

test.describe('Settings — unpair all devices (FR-029, C-23)', () => {
  test.fixme(
    !UNPAIR_READY,
    'A5 W5 `POST /devices/unpair-all` (delta C-23) and/or the A4 /settings UI are not merged ' +
      'into this checkout yet.',
  );

  test('unpair-all revokes the paired agent and every device token', async ({ page, request }) => {
    const { agent } = await pairAgentViaUi(page, request);
    try {
      const token = (await loginUser(request, DEMO_USER)).accessToken;
      expect((await listDevices(request, token)).total).toBeGreaterThan(0);

      await page.goto('/settings');
      await expect(page).toHaveURL(/\/settings$/);
      await page
        .getByRole('button', { name: /unpair all/i })
        .first()
        .click();
      // Confirmation dialog (UX_SPEC §4.9: confirm; revokes agent tokens).
      const confirm = page
        .getByRole('dialog')
        .filter({ hasText: /unpair/i })
        .first();
      if ((await confirm.count()) > 0) {
        await confirm
          .getByRole('button', { name: /unpair all|confirm|unpair/i })
          .last()
          .click();
      }
      await expect(page.getByText(/all devices unpaired/i)).toBeVisible({ timeout: 15_000 });

      // API truth: no devices remain for the account.
      await expect
        .poll(async () => (await listDevices(request, token)).total, { timeout: 15_000 })
        .toBe(0);

      // Agent truth: it was revoked, so the local link closes and it is no longer Connected.
      await expect(page.getByRole('status', { name: 'Focus Agent status: Connected' })).toHaveCount(
        0,
        { timeout: 20_000 },
      );
      await expect(agent.window.locator('#state-line')).toContainText(/Not paired|Paired — ready/, {
        timeout: 20_000,
      });
    } finally {
      await agent.close();
    }
  });
});

test.describe('Settings — download links (contract §3.1 #25)', () => {
  test.fixme(
    !DOWNLOADS_READY,
    'A5 W5 public `GET /agent-links` API and/or the A4 /settings download section are not merged ' +
      'into this checkout yet.',
  );

  test('download links render only the real URLs published by GET /agent-links', async ({
    page,
    request,
  }) => {
    const links = await listAgentLinks(request);
    expect(
      links.items.length,
      'the seed must publish at least one Focus Agent download',
    ).toBeGreaterThan(0);
    const publishedUrls = new Set(links.items.map((item) => item.url));
    for (const url of publishedUrls) expect(url).toMatch(/^https?:\/\//);

    await signInViaUi(page, DEMO_USER);
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings$/);
    // /settings is a lazy route (A4's route split) and the download section fetches
    // GET /agent-links after mount — wait for the real links instead of reading them mid-fetch.
    await expect(page.getByRole('heading', { level: 1, name: /Settings/ }).first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('a[href^="http"]').first()).toBeVisible({ timeout: 20_000 });

    const anchors = page.locator('a[href^="http"]');
    const count = await anchors.count();
    expect(count, 'settings must render the real download links').toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const href = await anchors.nth(index).getAttribute('href');
      expect(
        href !== null && publishedUrls.has(href),
        `no invented download URLs: anchor ${String(index)} (${String(href)}) must be a published agent link`,
      ).toBe(true);
    }
  });
});
