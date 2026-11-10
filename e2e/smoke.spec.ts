// e2e/smoke.spec.ts — the E2E harness' own health checks that must stay green TODAY
// (T-047 prep, owner A8; complements e2e/pairing.spec.ts, which is blocked on W2).
// Why: before the pairing features land, the team needs a real signal that the harness works end to
// end: the API boots against an in-memory MongoDB with the DEC-013 demo data, the dashboard serves
// the auth pages, a real signup/login round-trip reaches the dashboard shell, the router guard
// redirects anonymous visitors, and Playwright can attach to the real Electron Focus Agent process
// and read its 6-digit pairing code. These are exactly the building blocks pairing needs, so a
// harness regression surfaces here instead of inside a W2 feature branch.
// Invariants: no mocked backend and no fake assertions — every step uses the production code paths,
// and nothing is asserted that the current product cannot actually reach (no fake passes).

import { expect, test } from '@playwright/test';

import { checkHealth, registerUser } from './helpers/api';
import { launchAgent, expectAgentWindow } from './helpers/agent';
import { expectLoginError, openLogin, openSignup, signInViaUi, signUpViaUi } from './helpers/auth';
import { CLIENT_ORIGIN, DEMO_USER, uniqueEmail } from './helpers/config';

test.describe('API + dashboard smoke', () => {
  test('the E2E API is up with a connected in-memory database', async ({ request }) => {
    const health = await checkHealth(request);
    expect(health.status).toBe('ok');
  });

  test('/login renders the real auth form', async ({ page }) => {
    await openLogin(page);
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeEnabled();
    await expect(page.getByRole('link', { name: /Sign up/ })).toBeVisible();
  });

  test('/signup renders the real signup form', async ({ page }) => {
    await openSignup(page);
    await expect(page.getByLabel('Name')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  test('the seeded demo user can log in and reaches the dashboard shell', async ({ page }) => {
    await signInViaUi(page, DEMO_USER);
    // The demo user is Kabir (DEC-013/INTEGRATION_CONTRACTS §1.8); the shell greeting is real data.
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Devices' })).toBeVisible();
    await expect(page.getByRole('status', { name: /Focus Agent status:/ })).toBeVisible();
  });

  test('a new account can be created through the signup form', async ({ page }) => {
    await signUpViaUi(page, {
      name: 'E2E Signup',
      email: uniqueEmail('signup'),
      password: 'E2ePass123',
    });
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  });

  test('a wrong password shows the real 401 copy and stays on /login', async ({
    page,
    request,
  }) => {
    const { credentials } = await registerUser(request);
    await openLogin(page);
    await page.getByLabel('Email').fill(credentials.email);
    await page.getByLabel('Password').fill('DefinitelyWrong1');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expectLoginError(page, 'Email or password is incorrect.');
  });

  test('an anonymous visitor is redirected from a protected route to /login', async ({ page }) => {
    await page.goto(`${CLIENT_ORIGIN}/devices`);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });
});

test.describe('Focus Agent Electron harness', () => {
  test('launches with the FakeDriver and shows a 6-digit pairing code', async () => {
    // Requires `npm run build -w @focus-mode/agent` (root pretest:e2e); the helper fails clearly
    // if the compiled agent is missing. Electron quirks are isolated in the helper (KI-008/KI-009).
    const agent = await launchAgent();
    try {
      await expectAgentWindow(agent);
      expect(agent.pairingCode).toMatch(/^\d{6}$/);
      // W1 agent state: code shown, no cloud pairing yet — the exact starting point for W2.
      await expect(agent.window.locator('#state-line')).toContainText('Not paired');
    } finally {
      await agent.close();
    }
  });
});
