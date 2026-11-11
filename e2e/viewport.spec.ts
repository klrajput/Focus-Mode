// e2e/viewport.spec.ts — NFR-006 responsive proof (F-110): every route at 360×740, 768×1024 and
// 1440×900 must have NO horizontal page scroll (`documentElement.scrollWidth <= clientWidth`),
// usable navigation and the route's key content visible.
//
// Why this spec exists: until now the 360 px verdict was static analysis only — A3's W5 review
// flagged the missing real-browser proof (F-110). This runs the actual built dashboard in Chromium
// at the three UX_SPEC §8 viewports over public, USER and ADMIN routes plus the 403/404 pages and
// the two densest dialogs (pair dialog, mobile nav drawer).
//
// Invariants: assertions are measured on the live DOM (`scrollWidth`/`clientWidth`), not eyeballed;
// one vertical-scroll allowance is NOT made — a route that horizontally overflows fails.

import { expect, test, type Page } from '@playwright/test';

import { signInViaUi } from './helpers/auth';
import { CLIENT_ORIGIN, DEMO_ADMIN, DEMO_USER } from './helpers/config';

const VIEWPORTS = [
  { name: '360x740', width: 360, height: 740 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1440x900', width: 1440, height: 900 },
] as const;

interface RouteCase {
  readonly path: string;
  readonly heading: RegExp;
  readonly name: string;
}

const PUBLIC_ROUTES: readonly RouteCase[] = [
  { name: 'landing', path: '/', heading: /Focus on one thing\./ },
  { name: 'login', path: '/login', heading: /Welcome back/ },
  { name: 'signup', path: '/signup', heading: /Create your account/ },
  { name: '404', path: '/this-route-does-not-exist', heading: /404 — We couldn.t find that page/ },
];

const USER_ROUTES: readonly RouteCase[] = [
  { name: 'dashboard', path: '/dashboard', heading: /Dashboard/ },
  { name: 'focus', path: '/focus', heading: /^Focus$/ },
  { name: 'devices', path: '/devices', heading: /Devices/ },
  { name: 'allowlist', path: '/allowlist', heading: /Allow-list/ },
  { name: 'schedules', path: '/schedules', heading: /Schedules/ },
  { name: 'insights', path: '/insights', heading: /Insights/ },
  { name: 'settings', path: '/settings', heading: /Settings/ },
];

const ADMIN_ROUTES: readonly RouteCase[] = [{ name: 'admin', path: '/admin', heading: /Admin/ }];

/** NFR-006: no horizontal document scroll and no wider-than-viewport body. */
async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(
    metrics.scrollWidth,
    `${label}: documentElement.scrollWidth (${metrics.scrollWidth}) must be <= clientWidth (${metrics.clientWidth})`,
  ).toBeLessThanOrEqual(metrics.clientWidth);
  expect(
    metrics.bodyScrollWidth,
    `${label}: body.scrollWidth (${metrics.bodyScrollWidth}) must not exceed the viewport (${metrics.clientWidth})`,
  ).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

/** Navigation must stay usable at every width: drawer button < lg, persistent sidebar >= lg. */
async function expectNavUsable(page: Page, width: number): Promise<void> {
  if (width < 1024) {
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  } else {
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).first()).toBeVisible();
  }
}

async function expectRouteRenders(
  page: Page,
  route: RouteCase,
  viewportWidth: number,
  options: { assertNav?: boolean } = {},
): Promise<void> {
  await page.goto(`${CLIENT_ORIGIN}${route.path}`);
  await expect(page.getByRole('heading', { level: 1, name: route.heading }).first()).toBeVisible({
    timeout: 15_000,
  });
  await expectNoHorizontalScroll(page, `${route.name} @ ${viewportWidth}px`);
  if (options.assertNav !== false) await expectNavUsable(page, viewportWidth);
}

test.describe('NFR-006 viewport — public routes', () => {
  for (const viewport of VIEWPORTS) {
    test(`public routes have no horizontal scroll @ ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of PUBLIC_ROUTES) {
        // Public pages have their own chrome; the AppShell nav check applies to authenticated routes.
        await expectRouteRenders(page, route, viewport.width, { assertNav: false });
      }
    });
  }
});

test.describe('NFR-006 viewport — authenticated USER routes', () => {
  for (const viewport of VIEWPORTS) {
    test(`USER routes have no horizontal scroll @ ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await signInViaUi(page, DEMO_USER);
      for (const route of USER_ROUTES) {
        await expectRouteRenders(page, route, viewport.width);
      }
    });
  }
});

test.describe('NFR-006 viewport — ADMIN route and 403 page', () => {
  for (const viewport of VIEWPORTS) {
    test(`admin + 403 have no horizontal scroll @ ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      await signInViaUi(page, DEMO_ADMIN);
      for (const route of ADMIN_ROUTES) {
        await expectRouteRenders(page, route, viewport.width);
      }

      // USER hitting /admin is redirected to /403 inside the AppShell — same viewport contract.
      // Drop the ADMIN session first (the token lives in sessionStorage; a full reload rehydrates).
      await page.evaluate(() => sessionStorage.clear());
      await page.goto(`${CLIENT_ORIGIN}/login`);
      await signInViaUi(page, DEMO_USER);
      await page.goto(`${CLIENT_ORIGIN}/admin`);
      await expect(page).toHaveURL(/\/403$/);
      await expect(
        page.getByRole('heading', { level: 1, name: /403 — You don't have access/ }),
      ).toBeVisible();
      await expectNoHorizontalScroll(page, `403 @ ${viewport.width}px`);
      await expectNavUsable(page, viewport.width);
    });
  }
});

test.describe('NFR-006 viewport — dialogs and drawer at 360 px', () => {
  test('pair dialog and mobile navigation drawer stay inside a 360×740 viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await signInViaUi(page, DEMO_USER);
    await page.goto(`${CLIENT_ORIGIN}/devices`);
    await expect(page.getByRole('heading', { level: 1, name: /Devices/ }).first()).toBeVisible();

    // Pair dialog: a full-width bottom sheet at 360 px — its panel must not overflow horizontally.
    await page.getByRole('button', { name: 'Pair a device' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Pair a device' });
    await expect(dialog).toBeVisible();
    await expectNoHorizontalScroll(page, 'pair dialog @ 360px');
    const dialogWidth = await dialog.evaluate((element) => element.getBoundingClientRect().width);
    expect(dialogWidth).toBeLessThanOrEqual(360);
    await page.keyboard.press('Escape');

    // Mobile navigation drawer (the 360 px nav path).
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const drawer = page.getByRole('dialog', { name: 'Main navigation' });
    await expect(drawer).toBeVisible();
    await expectNoHorizontalScroll(page, 'nav drawer @ 360px');
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  });
});
