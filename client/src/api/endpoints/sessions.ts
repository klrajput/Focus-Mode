// Session endpoints (INTEGRATION_CONTRACTS §3.1 #12–#14, FR-010/FR-024).
// `actualMinutes` is the focused-time number the UI shows; `plannedMinutes` is never called
// "focused time" (REQUIREMENTS §6). A session is created only after the Focus Agent confirms.

import type { Paginated, SessionCreateInput, SessionPatchInput } from '@focus-mode/shared';

import { apiRequest } from '../http';
import type { FocusSession, SessionListParams } from '../types';

export const sessionsApi = {
  list: (query: SessionListParams = {}): Promise<Paginated<FocusSession>> =>
    apiRequest<Paginated<FocusSession>>('/sessions', { query }),

  create: (input: SessionCreateInput): Promise<FocusSession> =>
    apiRequest<FocusSession>('/sessions', { method: 'POST', body: input }),

  /** Finalise exactly once; an identical repeat stays idempotent (409 only on a real conflict). */
  patch: (id: string, input: SessionPatchInput): Promise<FocusSession> =>
    apiRequest<FocusSession>(`/sessions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    }),
};
