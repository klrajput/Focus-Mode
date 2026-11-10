// e2e/notifications.spec.ts — the AppShell notifications bell (W5 gate; FR-025, contract
// §3.1 #22–#23).
//
// Why: FR-025 requires missed scheduled runs to be visible to the user. The bell must reflect real
// `GET /notifications` data (never a fake count), and clicking a notification must persist the read
// through `PATCH /notifications/:id/read`. This spec proves both against the real API and the real
// AppShell component (`client/src/components/layout/notification-bell.tsx`).
//
// Fixture facts (DEC-013 seed): the seeded USER starts with 2 notifications, exactly one unread
// (a missed-run alert) and one already read. A freshly signed-up user has none → empty state.
//
// Self-gating: needs A5's `GET/PATCH /notifications` API (the bell UI exists and polls it, so until
// the API is merged the bell renders its error state instead of data).

import { expect, test } from '@playwright/test';

import { listNotifications, loginUser, unreadCount } from './helpers/api';
import { signInViaUi, signUpViaUi } from './helpers/auth';
import { DEMO_USER, uniqueEmail } from './helpers/config';
import { notificationsBellUiShipped } from './helpers/features';

const BELL_READY = notificationsBellUiShipped();

/** Escape a user-facing message for use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('Notifications bell (FR-025)', () => {
  test.fixme(
    !BELL_READY,
    'A5 W5 `GET /notifications` / `PATCH /notifications/:id/read` API is not merged into this ' +
      'checkout yet (the bell UI exists and polls it, so it currently shows its error state).',
  );

  test('seeded missed-run alert shows the real unread count and clicking marks it read', async ({
    page,
    request,
  }) => {
    const { accessToken } = await loginUser(request, DEMO_USER);
    const before = await listNotifications(request, accessToken);
    const unreadBefore = unreadCount(before.items);
    expect(unreadBefore, 'the DEC-013 seed ships one unread missed-run alert').toBeGreaterThan(0);
    const firstUnread = before.items.find((item) => item.readAt === null);
    expect(firstUnread).toBeDefined();
    if (firstUnread === undefined) return;

    await signInViaUi(page, DEMO_USER);

    const bell = page.getByRole('button', { name: /^Notifications/ }).first();
    await expect(bell).toBeVisible();
    // The bell's accessible name is `Notifications, N unread` — the real count from the API.
    await expect(bell).toHaveAttribute('aria-label', `Notifications, ${unreadBefore} unread`);
    await bell.click();

    const panel = page.getByRole('dialog', { name: 'Notifications' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(`${unreadBefore} unread`)).toBeVisible();

    // Click the unread row (its button contains the real API message) → PATCH read.
    await panel
      .getByRole('button', { name: new RegExp(escapeRegExp(firstUnread.message)) })
      .click();

    // API truth: `readAt` is set exactly once and the unread count decreased.
    await expect
      .poll(
        async () =>
          (await listNotifications(request, accessToken)).items.find(
            (item) => item.id === firstUnread.id,
          )?.readAt ?? null,
        { timeout: 10_000, message: 'clicking a notification must PATCH it to read' },
      )
      .not.toBeNull();

    await expect
      .poll(async () => unreadCount((await listNotifications(request, accessToken)).items), {
        timeout: 10_000,
      })
      .toBe(unreadBefore - 1);
  });

  test('a fresh user sees the empty state, never a fake count', async ({ page }) => {
    await signUpViaUi(page, {
      name: 'Bell Empty',
      email: uniqueEmail('bell'),
      password: 'E2ePass123',
    });

    const bell = page.getByRole('button', { name: /^Notifications/ }).first();
    await expect(bell).toBeVisible();
    // Unread 0 → the bell label has no count suffix (no invented badge).
    await expect(bell).toHaveAttribute('aria-label', 'Notifications');
    await bell.click();

    const panel = page.getByRole('dialog', { name: 'Notifications' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('No notifications yet.')).toBeVisible();
    await expect(panel.getByText('All read')).toBeVisible();
  });
});
