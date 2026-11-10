// `GET /presets` (INTEGRATION_CONTRACTS §3.1 #24, FR-020). Any authenticated user can read the
// presets admins publish; the allow-list editor can merge or replace its user apps with one.

import { useQuery } from '@tanstack/react-query';

import { presetsApi } from '../api/endpoints/presets';
import { queryKeys } from './query-keys';

export function usePresets() {
  return useQuery({
    queryKey: queryKeys.presets,
    queryFn: presetsApi.list,
  });
}
