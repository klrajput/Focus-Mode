// e2e/admin.spec.ts — `/admin` role guard + real admin data (W5 gate; FR-019, contract §3.1
// #26–#36).
//
// Why: the admin surface is where the role boundary is user-visible. This spec proves (a) the ADMIN
// sees the real users table and aggregate stats rendered from `GET /admin/users` /`GET /admin/stats`,
// (b) a USER is blocked both in the UI (`/403` inside the AppShell) and at the API (`403 FORBIDDEN`)
// — the client guard is UX, the API is the security boundary, and (c) the real deactivate/reactivate
// action changes the account's ability to log in (API truth), using a throwaway user so the shared
// demo identities are never mutated.
//
// UI facts (A4 W5): tabs `Users | Presets | Agent links | Stats` (`role="tab"`), users search input
// placeholder "Search name or email", row action button "Deactivate"/"Activate", pagination footer
// `Page N of M · T users`, stats cards Users/Devices/Sessions/Focused time.
//
// Self-gating: needs the W5 admin API routers (dedicated W5 worker) + the W5 admin UI.

import { expect, test } from '@playwright/test';

import {
  errorCodeOf,
  getAdminStats,
  listAdminUsers,
  loginUser,
  rawApiRequest,
  registerUser,
} from './helpers/api';
import { signInViaUi } from './helpers/auth';
import { DEMO_ADMIN, DEMO_USER } from './helpers/config';
import { adminApiShipped, clientAdminUiShipped } from './helpers/features';
import { formatMinutes } from './helpers/format';

const ADMIN_READY = adminApiShipped() && clientAdminUiShipped();

test.describe('Admin (FR-019)', () => {
  test.fixme(
    !ADMIN_READY,
    !adminApiShipped()
      ? 'The W5 admin API routers (`/admin/users`, `/admin/stats`, …) are not merged into this checkout yet.'
      : 'The A4 W5 /admin UI is not wired yet in this checkout.',
  );

  test('ADMIN sees the real users table and aggregate stats matching the API', async ({
    page,
    request,
  }) => {
    const admin = await loginUser(request, DEMO_ADMIN);
    const users = await listAdminUsers(request, admin.accessToken);
    const stats = await getAdminStats(request, admin.accessToken);
    expect(users.total).toBeGreaterThanOrEqual(2); // seeded admin + demo user
    expect(stats.users).toBeGreaterThanOrEqual(2);

    await signInViaUi(page, DEMO_ADMIN);
    await page.getByRole('link', { name: 'Admin' }).first().click();
    await expect(page).toHaveURL(/\/admin$/);

    // Users tab renders the API's users (no fixtures) with a real pagination footer.
    for (const user of users.items.slice(0, 5)) {
      await expect(page.getByText(user.email).first()).toBeVisible();
    }
    await expect(
      page.getByText(new RegExp(`Page \\d+ of \\d+ · ${users.total} users`)),
    ).toBeVisible();

    // Stats tab: aggregate-only values must match GET /admin/stats exactly (never per-user detail).
    await page.getByRole('tab', { name: 'Stats' }).click();
    await expect(page.getByText('Users', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(String(stats.users), { exact: true }).first()).toBeVisible();
    await expect(page.getByText(String(stats.sessions), { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(formatMinutes(stats.focusMinutes), { exact: true }).first(),
    ).toBeVisible();
  });

  test('a USER is blocked from /admin in the UI (403 page) and at the API (403 FORBIDDEN)', async ({
    page,
    request,
  }) => {
    const { accessToken } = await loginUser(request, DEMO_USER);

    // API is the security boundary: USER token → 403 FORBIDDEN on both admin reads.
    const forbiddenUsers = await rawApiRequest(request, accessToken, 'GET', '/admin/users');
    expect(forbiddenUsers.status).toBe(403);
    expect(errorCodeOf(forbiddenUsers)).toBe('FORBIDDEN');
    const forbiddenStats = await rawApiRequest(request, accessToken, 'GET', '/admin/stats');
    expect(forbiddenStats.status).toBe(403);
    expect(errorCodeOf(forbiddenStats)).toBe('FORBIDDEN');

    // UI guard: USER → /admin renders the /403 page inside the AppShell.
    await signInViaUi(page, DEMO_USER);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/403$/);
    await expect(page.getByRole('heading', { name: /403 — You don't have access/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  });

  test('ADMIN deactivates/reactivates a user through the real UI (login blocked while disabled)', async ({
    page,
    request,
  }) => {
    // Throwaway account so demo identities stay untouched for the other specs.
    const { credentials, auth } = await registerUser(request);
    const admin = await loginUser(request, DEMO_ADMIN);

    await signInViaUi(page, DEMO_ADMIN);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin$/);

    const search = page.getByPlaceholder('Search name or email');
    await search.fill(credentials.email);
    const row = page.getByRole('row').filter({ hasText: credentials.email }).first();
    await expect(row).toBeVisible();

    // Deactivate → API truth false + login blocked with ACCOUNT_DISABLED.
    await row.getByRole('button', { name: 'Deactivate' }).click();
    await expect
      .poll(
        async () => {
          const users = await listAdminUsers(request, admin.accessToken, {
            limit: 100,
            search: credentials.email,
          });
          return users.items[0]?.isActive;
        },
        { timeout: 15_000, message: 'the Deactivate action must PATCH /admin/users/:id' },
      )
      .toBe(false);

    const blockedLogin = await rawApiRequest(request, null, 'POST', '/auth/login', {
      email: credentials.email,
      password: credentials.password,
    });
    expect(blockedLogin.status).toBe(403);
    expect(errorCodeOf(blockedLogin)).toBe('ACCOUNT_DISABLED');

    // Reactivate → login works again.
    await search.fill(credentials.email);
    const disabledRow = page.getByRole('row').filter({ hasText: credentials.email }).first();
    await expect(disabledRow.getByText('Disabled')).toBeVisible();
    await disabledRow.getByRole('button', { name: 'Activate' }).click();
    await expect
      .poll(
        async () => {
          const users = await listAdminUsers(request, admin.accessToken, {
            limit: 100,
            search: credentials.email,
          });
          return users.items[0]?.isActive;
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    const workingLogin = await rawApiRequest(request, null, 'POST', '/auth/login', {
      email: credentials.email,
      password: credentials.password,
    });
    expect(workingLogin.status).toBe(200);
    expect((workingLogin.body as { data?: { user?: { id?: string } } }).data?.user?.id).toBe(
      auth.user.id,
    );
  });
});
