// server/src/services/auth.service.ts — register/login business logic (T-012, FR-001).
// Why: routes stay thin; this module owns the security-critical rules — bcrypt cost 12 (SEC-1),
// one account per email (409 CONFLICT), no user enumeration (same 401 for unknown email and wrong
// password), `isActive` check → 403 ACCOUNT_DISABLED, lastLoginAt bookkeeping, and issuing the
// HS256 access token (utils/jwt.ts). Registration always creates role USER; the request schema has
// no role field and strict objects reject one (FR-001/FR-019).
// Invariants: passwords are only ever hashed here and never returned/logged; `passwordHash` is
// select:false on the model and is only requested explicitly on login; no caller can set role.

import bcrypt from 'bcryptjs';
import { ERROR_CODES, type LoginInput, type RegisterInput } from '@focus-mode/shared';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { signAccessToken } from '../utils/jwt.js';
import { isDuplicateKeyError } from '../utils/mongo-errors.js';
import { toSafeUser, type PublicUser } from './user.service.js';

/** SEC-1: bcrypt cost >= 12 (deliberately slow on purpose). */
export const BCRYPT_COST = 12;

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';
const DISABLED_ACCOUNT_MESSAGE = 'This account has been disabled.';
const DUPLICATE_EMAIL_MESSAGE = 'An account with this email already exists.';

/**
 * A real cost-12 hash of a throwaway password. When the email is unknown we still run one bcrypt
 * comparison so response time does not reveal whether an account exists (user enumeration).
 */
const DUMMY_PASSWORD_HASH = '$2b$12$d/MOKOhWHuKkrgXN4VZzvuUzfzmjJeA5889BJtg3YrY3V2MQq1s7.';

/** `{accessToken, user}` — the `auth result` shape in INTEGRATION CONTRACTS §3.3. */
export interface AuthResult {
  accessToken: string;
  user: PublicUser;
}

/** Create a USER account and log it in (201). Unknown/extra fields were already rejected. */
export async function registerUser(input: RegisterInput): Promise<AuthResult> {
  const existing = await User.exists({ email: input.email });
  if (existing !== null) {
    throw new AppError(ERROR_CODES.CONFLICT, DUPLICATE_EMAIL_MESSAGE);
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  try {
    const user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash,
      role: 'USER',
    });
    const safeUser = toSafeUser(user);
    return { accessToken: signAccessToken(safeUser.id, safeUser.role), user: safeUser };
  } catch (error) {
    // Two concurrent registrations can both pass the exists() check; the unique email index wins.
    if (isDuplicateKeyError(error)) {
      throw new AppError(ERROR_CODES.CONFLICT, DUPLICATE_EMAIL_MESSAGE);
    }
    throw error;
  }
}

/** Verify credentials, reject disabled accounts, record lastLoginAt and issue a token (200). */
export async function loginUser(input: LoginInput): Promise<AuthResult> {
  const user = await User.findOne({ email: input.email }).select('+passwordHash');

  if (typeof user?.passwordHash !== 'string') {
    await bcrypt.compare(input.password, DUMMY_PASSWORD_HASH);
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, INVALID_CREDENTIALS_MESSAGE);
  }

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, INVALID_CREDENTIALS_MESSAGE);
  }
  if (!user.isActive) {
    throw new AppError(ERROR_CODES.ACCOUNT_DISABLED, DISABLED_ACCOUNT_MESSAGE);
  }

  user.lastLoginAt = new Date();
  await user.save();
  const safeUser = toSafeUser(user);
  return { accessToken: signAccessToken(safeUser.id, safeUser.role), user: safeUser };
}
