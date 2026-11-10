// e2e/insights.spec.ts — `/insights` against real analytics (W5 gate; FR-013, contract §3.1 #21).
//
// Why: "honest analytics" is a graded part of the product — the page must render the API's real
// numbers (never fixtures), and a fresh account must show the approved empty state instead of
// invented charts. This spec reads `GET /insights?range=7d` through the API and asserts the same
// values are visible in the UI, using the dashboard's own formatters (`formatMinutes`/`formatPercent`
// mirrored in e2e/helpers/format.ts).
//
// Seed fact (DEC-013): the seeded USER has 32 days of completed/cancelled sessions, so `7d` totals
// are non-zero. A fresh signup has no sessions → empty state.
//
// Self-gating: needs A5's `GET /insights` router; the client page already renders real data.

import { expect, test } from '@playwright/test';

import { getInsights, loginUser } from './helpers/api';
import { signInViaUi, signUpViaUi } from './helpers/auth';
import { DEMO_USER, uniqueEmail } from './helpers/config';
import { insightsApiShipped, clientInsightsUiShipped } from './helpers/features';
import { formatMinutes, formatPercent } from './helpers/format';

const INSIGHTS_READY = insightsApiShipped() && clientInsightsUiShipped();

test.describe('Insights (FR-013)', () => {
  test.fixme(
    !INSIGHTS_READY,
    !insightsApiShipped()
      ? 'A5 W5 `GET /insights` API is not merged into this checkout yet (client page is ready and shows its error state).'
      : 'A4 W5 /insights UI is not wired yet in this checkout.',
  );

  test('seeded totals rendered in the UI match GET /insights exactly', async ({
    page,
    request,
  }) => {
    const { accessToken } = await loginUser(request, DEMO_USER);
    const api = await getInsights(request, accessToken, '7d');
    expect(
      api.totals.sessions,
      'the seeded user must have real sessions in the last 7 days',
    ).toBeGreaterThan(0);

    await signInViaUi(page, DEMO_USER);
    await page.getByRole('link', { name: 'Insights' }).first().click();
    await expect(page).toHaveURL(/\/insights$/);

    // Metric cards (UX_SPEC §4.8): Focused time, Completion, Current streak, Best hours.
    await expect(page.getByText('Focused time').first()).toBeVisible();
    await expect(page.getByText(formatMinutes(api.totals.focusMinutes)).first()).toBeVisible();
    await expect(page.getByText(formatPercent(api.totals.completionRate)).first()).toBeVisible();
    await expect(page.getByText(`${api.totals.currentStreak} days`).first()).toBeVisible();
    await expect(
      page.getByText(`${api.totals.sessions} sessions · ${api.totals.cancelled} cancelled`),
    ).toBeVisible();

    // Range switch uses the frozen 7d/30d/90d contract and marks the active chip.
    const range30 = page.getByRole('button', { name: '30 days' });
    await range30.click();
    await expect(range30).toHaveAttribute('aria-pressed', 'true');
  });

  test('a fresh account shows the approved empty state, not invented data', async ({ page }) => {
    await signUpViaUi(page, {
      name: 'Insights Empty',
      email: uniqueEmail('insights'),
      password: 'E2ePass123',
    });
    await page.getByRole('link', { name: 'Insights' }).first().click();
    await expect(page).toHaveURL(/\/insights$/);

    await expect(
      page.getByText('No focus data for this range yet. Finish a session to see your progress.'),
    ).toBeVisible();
    // Metrics are "—" for an empty range (UX_SPEC §4.8).
    await expect(page.getByText('—').first()).toBeVisible();
  });
});
