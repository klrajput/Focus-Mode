/*
 * Error code → user-facing copy (UX_SPEC §6.2, INTEGRATION_CONTRACTS §7).
 * The dashboard maps the frozen 13-code vocabulary to A3's approved strings in exactly one place,
 * so a page never invents an error message and support can still see the real code as muted text.
 */

import { ERROR_CODES, type ErrorCode } from '@focus-mode/shared';

import { isApiError } from '../api/errors';

/** Verbatim UX_SPEC §6.2 messages. Never edit one without an A3 copy change. */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = Object.freeze({
  VALIDATION_ERROR: 'Check the highlighted fields and try again.',
  UNAUTHENTICATED: 'Your session has expired. Please log in again.',
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "We couldn't find that. It may have been removed.",
  CONFLICT: 'That action conflicts with something already in progress. Refresh and try again.',
  RATE_LIMITED: 'Too many attempts. Please wait a minute and try again.',
  INVALID_PAIRING_CODE:
    'That pairing code is wrong or has expired. Check the 6 digits in your Focus Agent and try again.',
  PAIRING_EXPIRED:
    'This pairing code expired. Your Focus Agent is showing a new code — enter that one.',
  PROTECTED_ENTRY: "This app is protected and must stay open during focus. It can't be removed.",
  ALREADY_FOCUSING:
    'A focus session is already running on this device. End it before starting another.',
  NO_DEVICE_CONNECTED: 'No device connected — start your Focus Agent.',
  ACCOUNT_DISABLED:
    'This account has been disabled. Contact an admin if you think this is a mistake.',
  INTERNAL: 'Something went wrong on our side. Please try again.',
});

/**
 * Login-form specific copy for a rejected credential pair (401 on `/auth/login`).
 * PROVISIONAL: UX_SPEC §6.2 only defines the session-expiry wording for 401, which would be
 * misleading on a login form. Requested as an A3 copy addition (see the A4 W1 report); the string
 * stays sentence-case, second-person and free of exclamation marks per §6.1.
 */
export const LOGIN_REJECTED_COPY = 'Email or password is incorrect.';

/** Copy for any thrown value: contract code when available, else the generic INTERNAL message. */
export function copyForError(error: unknown): string {
  return isApiError(error) ? ERROR_MESSAGES[error.code] : ERROR_MESSAGES[ERROR_CODES.INTERNAL];
}

export function copyForCode(code: ErrorCode): string {
  return ERROR_MESSAGES[code];
}
