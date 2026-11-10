// server/src/utils/jwt.ts — mints and verifies the HS256 access token (SEC-2, FR-001).
// Why: the Bearer token is the only credential the REST API accepts; pinning the algorithm, issuer
// and audience on both sign and verify blocks algorithm-confusion and token-reuse-elsewhere
// attacks, and the decoded payload is re-validated with the frozen shared schemas so a malformed or
// forged token always becomes 401 UNAUTHENTICATED (never a 500).
// Invariants: secret only from validated env (>= 32 chars); TTL from JWT_EXPIRES_IN (30m, SEC-2);
// `sub` is a 24-char ObjectId; `role` is USER|ADMIN; nothing secret is ever put inside the token.

import jwt, { type SignOptions } from 'jsonwebtoken';
import { z } from 'zod';
import { ERROR_CODES, objectIdSchema, roleSchema, type Role } from '@focus-mode/shared';
import { env } from '../config/env.js';
import { AppError } from './AppError.js';

const ACCESS_TOKEN_ALGORITHM = 'HS256';
const TOKEN_ISSUER = 'focus-mode-api';
const TOKEN_AUDIENCE = 'focus-mode-dashboard';
const INVALID_TOKEN_MESSAGE = 'Invalid or expired access token.';

/** Claims this API trusts; anything else in the payload is ignored. */
const accessTokenPayloadSchema = z.object({
  sub: objectIdSchema,
  role: roleSchema,
});

export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

/** Sign a short-lived access token for an authenticated user. */
export function signAccessToken(userId: string, role: Role): string {
  const options: SignOptions = {
    algorithm: ACCESS_TOKEN_ALGORITHM,
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    subject: userId,
  };
  return jwt.sign({ role }, env.JWT_SECRET, options);
}

/** Verify signature/expiry/issuer/audience and validate the claim shape; throws 401 on any failure. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: [ACCESS_TOKEN_ALGORITHM],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
    });
  } catch {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, INVALID_TOKEN_MESSAGE);
  }

  const parsed = accessTokenPayloadSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, INVALID_TOKEN_MESSAGE);
  }
  return parsed.data;
}
