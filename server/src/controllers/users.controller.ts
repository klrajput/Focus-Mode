// server/src/controllers/users.controller.ts — `/users/me` profile + password handlers (T-072, FR-029).
// Why: the settings page edits the caller's own profile and password. Bodies use the frozen shared
// schemas, so client form validation and the server cannot drift; the public-user mapper is shared
// with /auth/me. Invariants: authenticated user only (contract §3.1 #6–#7 access label `auth`, so
// ADMIN may edit its own profile too); GET /users/me (W5 additive, delta C-21) returns the same
// public user shape as /auth/me; the password endpoint never returns or logs either password.

import type { RequestHandler } from 'express';
import {
  type ApiSuccess,
  type ChangePasswordInput,
  type ProfilePatchInput,
} from '@focus-mode/shared';
import { getAuthenticatedUser } from '../middlewares/auth.js';
import {
  changePassword,
  updateProfile,
  type PasswordChanged,
  type PublicUser,
} from '../services/user.service.js';

type RouteParams = Record<string, string>;

/** GET /api/v1/users/me — 200 the authenticated user (fresh from the requireAuth DB load). */
export const getMe: RequestHandler<RouteParams, ApiSuccess<PublicUser>> = (req, res) => {
  res.status(200).json({ success: true, data: getAuthenticatedUser(req) });
};

/** PATCH /api/v1/users/me — 200 updated public user. */
export const patchMe: RequestHandler<
  RouteParams,
  ApiSuccess<PublicUser>,
  ProfilePatchInput
> = async (req, res) => {
  const user = getAuthenticatedUser(req);
  const data = await updateProfile(user.id, req.body);
  res.status(200).json({ success: true, data });
};

/** POST /api/v1/users/me/password — 200 `{changed:true}`; wrong current password → 401. */
export const changeMyPassword: RequestHandler<
  RouteParams,
  ApiSuccess<PasswordChanged>,
  ChangePasswordInput
> = async (req, res) => {
  const user = getAuthenticatedUser(req);
  const data = await changePassword(user.id, req.body);
  res.status(200).json({ success: true, data });
};
