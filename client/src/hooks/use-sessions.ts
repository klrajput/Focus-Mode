// `GET /sessions` (INTEGRATION_CONTRACTS §3.1 #14). Used by the dashboard's recent-sessions card
// and the insights page; `actualMinutes` is rendered as focused time (REQUIREMENTS §6).

import { useQuery } from '@tanstack/react-query';

import { sessionsApi } from '../api/endpoints/sessions';
import type { SessionListParams } from '../api/types';
import { queryKeys } from './query-keys';

export function useSessions(params: SessionListParams = {}) {
  return useQuery({
    queryKey: queryKeys.sessions(params),
    queryFn: () => sessionsApi.list(params),
  });
}
