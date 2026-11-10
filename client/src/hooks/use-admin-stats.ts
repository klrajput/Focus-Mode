// Admin aggregate stats (`GET /admin/stats`, INTEGRATION_CONTRACTS §3.1 #36, FR-019).
// Counts and minutes only — the endpoint never returns per-user session detail (PDF §6), so this
// hook cannot leak one into the UI.

import { useQuery } from '@tanstack/react-query';

import { adminApi } from '../api/endpoints/admin';
import type { AdminStats } from '../api/types';
import { queryKeys } from './query-keys';

export function useAdminStats() {
  return useQuery<AdminStats>({
    queryKey: queryKeys.adminStats,
    queryFn: adminApi.stats,
  });
}
