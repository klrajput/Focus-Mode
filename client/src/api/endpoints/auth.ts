// Auth endpoints (INTEGRATION_CONTRACTS §3.1 #2–#5). Public calls set `auth:false` so a stale
// token can never be attached to login/register. Request bodies use the frozen shared schemas.

import type { LoginInput, RegisterInput } from '@focus-mode/shared';

import { apiRequest } from '../http';
import type { AuthResult, LogoutResult, PublicUser } from '../types';

export const authApi = {
  login: (input: LoginInput): Promise<AuthResult> =>
    apiRequest<AuthResult>('/auth/login', { method: 'POST', body: input, auth: false }),

  register: (input: RegisterInput): Promise<AuthResult> =>
    apiRequest<AuthResult>('/auth/register', { method: 'POST', body: input, auth: false }),

  /** Server-side logout; the dashboard also drops the token locally regardless of the answer. */
  logout: (): Promise<LogoutResult> => apiRequest<LogoutResult>('/auth/logout', { method: 'POST' }),

  /** Current user — used to rehydrate the session from sessionStorage on reload. */
  me: (): Promise<PublicUser> => apiRequest<PublicUser>('/auth/me'),
};
