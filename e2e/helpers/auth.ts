// e2e/helpers/auth.ts — drive the real login/signup forms, exactly like a user (T-047 prep, A8).
// Why: pairing specs must start from an authenticated dashboard session; doing that through the UI
// (instead of injecting a token into storage) keeps the test honest about the auth flow, the router
// guards and the API contract together.
// Invariants: selectors are the user-facing labels/roles from UX_SPEC §4.2 (not CSS classes); every
// helper waits for the route it promises, so a redirect regression fails here, once.

import { expect, type Page } from '@playwright/test';

import { CLIENT_ORIGIN } from './config';

/** The shape both auth helpers accept (a subset of the shared `registerSchema`/`loginSchema`). */
export interface UiCredentials {
  name?: string;
  email: string;
  password: string;
}

/** Open `/login` and wait for its real heading (login copy lives in client/src/copy/auth.ts). */
export async function openLogin(page: Page): Promise<void> {
  await page.goto(`${CLIENT_ORIGIN}/login`);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
}

/** Open `/signup` and wait for its real heading. */
export async function openSignup(page: Page): Promise<void> {
  await page.goto(`${CLIENT_ORIGIN}/signup`);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
}

/** Fill `/login`, submit, and wait until the authenticated dashboard shell is visible. */
export async function signInViaUi(
  page: Page,
  credentials: Pick<UiCredentials, 'email' | 'password'>,
): Promise<void> {
  await openLogin(page);
  await page.getByLabel('Email').fill(credentials.email);
  await page.getByLabel('Password').fill(credentials.password);
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  // The AppShell only renders for an authenticated user (RequireAuth → AppShell, FR-021).
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
}

/** Fill `/signup`, submit, and wait until the new account lands on the dashboard (FR-001). */
export async function signUpViaUi(page: Page, credentials: UiCredentials): Promise<void> {
  if (credentials.name === undefined) {
    throw new Error('signUpViaUi requires a name — the signup form validates it');
  }

  await openSignup(page);
  await page.getByLabel('Name').fill(credentials.name);
  await page.getByLabel('Email').fill(credentials.email);
  await page.getByLabel('Password').fill(credentials.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
}

/** Assert the login form's real failure banner (UX_SPEC §4.2 copy for 401 UNAUTHENTICATED). */
export async function expectLoginError(page: Page, message: string): Promise<void> {
  await expect(page.getByRole('alert')).toHaveText(message);
  await expect(page).toHaveURL(/\/login/);
}
