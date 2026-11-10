// `GET /admin/users` (INTEGRATION_CONTRACTS §3.1 #26). ADMIN-only on the server; the client route
// guard is UX only. Aggregate/admin reads never expose per-user session detail (PDF §6).

import { useQuery } from '@tanstack/react-query';

import { adminApi } from '../api/endpoints/admin';
import type { AdminUserListParams } from '../api/types';
import { queryKeys } from './query-keys';

export function useAdminUsers(params: AdminUserListParams = {}) {
  return useQuery({
    queryKey: queryKeys.adminUsers(params),
    queryFn: () => adminApi.listUsers(params),
  });
}
