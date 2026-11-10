// `GET /allowlist` (INTEGRATION_CONTRACTS §3.1 #15, INV-3). Protected entries are displayed with a
// locked, non-interactive row; this hook only reads — editing lands with the allow-list editor.

import { useQuery } from '@tanstack/react-query';

import { allowlistApi } from '../api/endpoints/allowlist';
import { queryKeys } from './query-keys';

export function useAllowlist() {
  return useQuery({
    queryKey: queryKeys.allowlist,
    queryFn: allowlistApi.get,
  });
}
