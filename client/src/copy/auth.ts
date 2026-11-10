/*
 * Copy that belongs to the auth screens (UX_SPEC §4.2). Kept beside the error deck so the login and
 * signup pages never inline a user-facing string that A3 did not approve.
 */

/** UX_SPEC §4.2 success toast (used for login and signup — both end authenticated). */
export const SIGNED_IN_TOAST = 'Signed in';

/** UX_SPEC §4.2: 409 CONFLICT on signup means the email already has an account. */
export const EMAIL_TAKEN_COPY = 'An account with that email already exists. Try logging in.';

/** UX_SPEC §4.2 helper under the password field. */
export const PASSWORD_HINT = '8–72 characters, at least one letter and one digit.';

/** UX_SPEC §4.2 page titles. */
export const LOGIN_TITLE = 'Welcome back';
export const SIGNUP_TITLE = 'Create your account';

/** UX_SPEC §4.2 loading labels. */
export const LOGIN_LOADING_LABEL = 'Logging in…';
export const SIGNUP_LOADING_LABEL = 'Creating account…';

/**
 * Demo identities seeded by A6 (DEC-013 / INTEGRATION_CONTRACTS §1.8), shown only in code comments
 * and never rendered: `admin@demo.com / Admin@123` (ADMIN) and `kabir@demo.com / Kabir@123` (USER).
 * They exist so a reviewer can sign in during the W1 demo; the UI itself stays credential-neutral.
 */
