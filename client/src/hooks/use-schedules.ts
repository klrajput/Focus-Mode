// `GET /schedules` (INTEGRATION_CONTRACTS §3.1 #17). Times are the user's IANA-zone wall clock;
// the page shows the timezone from `/auth/me` and never converts them itself.

import { useQuery } from '@tanstack/react-query';

import { schedulesApi } from '../api/endpoints/schedules';
import type { PageParams } from '../api/types';
import { queryKeys } from './query-keys';

export function useSchedules(params: PageParams = {}) {
  return useQuery({
    queryKey: queryKeys.schedules(params),
    queryFn: () => schedulesApi.list(params),
  });
}
