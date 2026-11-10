// e2e/helpers/focus-flow.ts — reusable "start/end a focus session through the real UI" steps
// (W4 gate, owner A8).
// Why: the focus, schedule and session-reporting specs all need the same Start → consent → /focus
// sequence and the same native-dialog handling; one helper keeps the selectors (UX_SPEC §4.3/§5,
// `components/focus/*`) in one place so a copy change breaks one file, not three.
// Invariants: everything is the production UI + production local channel; only the native Electron
// dialogs (REC-004 consent, scheduled heads-up) are stubbed INSIDE the agent main process, because a
// web page must never be able to answer them (KI-011). No fake focus and no fake session.

import { expect, type Locator, type Page } from '@playwright/test';

import type { LaunchedAgent } from './agent';

/** Consent modal title for a duration (ConsentModal renders `Start a ${n}-minute focus session?`). */
export function consentDialogName(minutes: number): RegExp {
  return new RegExp(`Start a ${minutes}-minute focus session\\?`);
}

/**
 * Answer the agent-side native dialogs from inside the agent process (test-only seam, KI-011).
 * Returns the first/default button ({response: 0}) — the documented "Allow and continue" default.
 * Also used for the W4 scheduled heads-up: its accept path is the default button too.
 */
export async function stubNativeAgentDialogs(agent: LaunchedAgent): Promise<void> {
  await agent.app.evaluate(({ dialog }) => {
    const nativeDialog = dialog as unknown as Record<string, unknown>;
    nativeDialog.showMessageBox = async () => ({
      response: 0,
      checkboxChecked: false,
      checkboxLabel: '',
    });
    nativeDialog.showMessageBoxSync = () => 0;
  });
}

/** The persistent dashboard badge (AppShell AgentStatusBadge). */
export function agentStatusBadge(page: Page): Locator {
  return page.getByRole('status', { name: /Focus Agent status:/ });
}

/** Navigate to `/dashboard` via the sidebar (SPA navigation, socket stays alive). */
export async function openDashboard(page: Page): Promise<void> {
  if (page.url().includes('/dashboard')) return;
  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/**
 * Start a focus session exactly as a user does: duration chip → Start Focus → consent modal →
 * Confirm. Waits for the live `/focus` page and its End Focus action.
 */
export async function startFocusViaUi(page: Page, minutes: number): Promise<void> {
  await openDashboard(page);

  // DurationChips renders 25/50/60 as `aria-pressed` buttons (`{minutes} min`).
  await page.getByRole('button', { name: `${minutes} min`, exact: true }).click();
  await page.getByRole('button', { name: 'Start Focus' }).click();

  const consent = page.getByRole('dialog', { name: consentDialogName(minutes) });
  await expect(consent).toBeVisible();
  await expect(consent.getByRole('heading', { name: 'These stay open' })).toBeVisible();
  await consent.getByRole('button', { name: 'Confirm — start focus' }).click();

  await expect(page).toHaveURL(/\/focus$/, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'End Focus' }).first()).toBeVisible();
}

/** End the session from the dashboard `/focus` page and wait for the success banner. */
export async function endFocusFromDashboard(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'End Focus' }).first().click();
  await expect(page.getByText(/Focus ended — your windows are back\./)).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * End the session from the Focus Agent's own window. This is the same `controller.exitFocus` path
 * the tray menu uses (INV-5); the tray menu itself is a native macOS menu, which Playwright cannot
 * click — that literal click stays NEEDS-HUMAN (see docs/KNOWN_ISSUES.md KI-013).
 */
export async function endFocusFromAgentWindow(agent: LaunchedAgent): Promise<void> {
  const endButton = agent.window.getByRole('button', { name: 'End Focus' });
  await expect(endButton).toBeVisible({ timeout: 20_000 });
  await endButton.click();
}
