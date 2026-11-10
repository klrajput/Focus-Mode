// Allow-list endpoints (INTEGRATION_CONTRACTS §3.1 #15–#16 + the W4 preset helper, FR-008/FR-020).
// `protectedApps` is server-seeded and read-only for display; PUT cannot change it and answers
// 400 PROTECTED_ENTRY when a request tries. The dashboard therefore never offers an edit control
// on protected rows. Applying a preset reuses the same protected-set rules server-side; `mode`
// decides whether the preset is merged into or replaces the user apps (UX_SPEC §4.6).

import type { AllowlistPutInput } from '@focus-mode/shared';

import { apiRequest } from '../http';
import type { AllowList } from '../types';

/** `merge` keeps the user's existing apps; `replace` swaps them for the preset's set. */
export type PresetApplyMode = 'merge' | 'replace';

export const allowlistApi = {
  get: (): Promise<AllowList> => apiRequest<AllowList>('/allowlist'),

  put: (input: AllowlistPutInput): Promise<AllowList> =>
    apiRequest<AllowList>('/allowlist', { method: 'PUT', body: input }),

  /** `POST /allowlist/preset/:id?mode=merge|replace` — returns the full, already-updated list. */
  applyPreset: (id: string, mode: PresetApplyMode): Promise<AllowList> =>
    apiRequest<AllowList>(`/allowlist/preset/${encodeURIComponent(id)}`, {
      method: 'POST',
      query: { mode },
    }),
};
