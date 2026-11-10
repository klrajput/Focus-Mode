// Allow-list endpoints (INTEGRATION_CONTRACTS §3.1 #15–#16, FR-008/FR-020, INV-3).
// `protectedApps` is server-seeded and read-only for display; PUT cannot change it and answers
// 400 PROTECTED_ENTRY when a request tries. The dashboard therefore never offers an edit control
// on protected rows.

import type { AllowlistPutInput } from '@focus-mode/shared';

import { apiRequest } from '../http';
import type { AllowList } from '../types';

export const allowlistApi = {
  get: (): Promise<AllowList> => apiRequest<AllowList>('/allowlist'),

  put: (input: AllowlistPutInput): Promise<AllowList> =>
    apiRequest<AllowList>('/allowlist', { method: 'PUT', body: input }),
};
