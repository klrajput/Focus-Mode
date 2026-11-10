// server/src/controllers/auth.controller.ts — thin HTTP layer for /auth/* (T-012).
// Why: controllers only translate validated input to service calls and shape the NFR-002 success
// envelope; business rules stay in services/auth.service.ts. Route-level generics type the body and
// the response, so no `any`/casts are needed here.
// Invariants: 201 for register, 200 for the rest (contract §3.1); /auth/me returns the same public
// user object login/register return; no response ever contains passwordHash.

import type { RequestHandler } from 'express';
import {
  ERROR_CODES,
  type ApiSuccess,
  type LoginInput,
  type RegisterInput,
} from '@focus-mode/shared';
import { loginUser, registerUser, type AuthResult } from '../services/auth.service.js';
import type { PublicUser } from '../services/user.service.js';
import { AppError } from '../utils/AppError.js';

type RouteParams = Record<string, string>;

export const register: RequestHandler<RouteParams, ApiSuccess<AuthResult>, RegisterInput> = async (
  req,
  res,
) => {
  const result = await registerUser(req.body);
  res.status(201).json({ success: true, data: result });
};

export const login: RequestHandler<RouteParams, ApiSuccess<AuthResult>, LoginInput> = async (
  req,
  res,
) => {
  const result = await loginUser(req.body);
  res.status(200).json({ success: true, data: result });
};

/**
 * Logout. The access token is stateless (contract §3.1: "logout is client-side token drop +
 * optional token version bump"), so the server only confirms the authenticated caller's request;
 * the dashboard discards the token from memory/sessionStorage. Requiring auth here means an
 * anonymous caller still gets 401 UNAUTHENTICATED, as documented.
 */
export const logout: RequestHandler = (_req, res) => {
  res.status(200).json({ success: true, data: { loggedOut: true } });
};

/** Current user, fresh from the database (requireAuth reloads it on every request). */
export const me: RequestHandler<RouteParams, ApiSuccess<PublicUser>> = (req, res) => {
  if (!req.user) {
    throw new AppError(ERROR_CODES.UNAUTHENTICATED, 'Authentication required.');
  }
  res.status(200).json({ success: true, data: req.user });
};
