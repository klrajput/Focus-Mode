// `GET /insights?range=7d|30d|90d` (INTEGRATION_CONTRACTS §3.1 #21, FR-013).
// The range is part of the cache key so switching tabs shows the right loading state, never
// yesterday's numbers under a new label.

import { useQuery } from '@tanstack/react-query';
import type { InsightsRange } from '@focus-mode/shared';

import { insightsApi } from '../api/endpoints/insights';
import { queryKeys } from './query-keys';

export function useInsights(range: InsightsRange) {
  return useQuery({
    queryKey: queryKeys.insights(range),
    queryFn: () => insightsApi.get(range),
  });
}
