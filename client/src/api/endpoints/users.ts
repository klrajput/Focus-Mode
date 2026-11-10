// User profile endpoints (INTEGRATION_CONTRACTS §3.1 #6–#7, FR-029). Bodies are the shared
// `profilePatchSchema` / `changePasswordSchema` inputs, so client validation cannot drift.

import type { ChangePasswordInput, ProfilePatchInput } from '@focus-mode/shared';

import { apiRequest } from '../http';
import type { PasswordChanged, PublicUser } from '../types';

export const usersApi = {
  updateProfile: (input: ProfilePatchInput): Promise<PublicUser> =>
    apiRequest<PublicUser>('/users/me', { method: 'PATCH', body: input }),

  changePassword: (input: ChangePasswordInput): Promise<PasswordChanged> =>
    apiRequest<PasswordChanged>('/users/me/password', { method: 'POST', body: input }),
};
