// `GET /admin/users` and `PATCH /admin/users/:id` (INTEGRATION_CONTRACTS §3.1 #26–#27).
// ADMIN-only on the server; the client route guard is UX only. Admin writes may change `role` and
// `isActive` — the only place those fields are mutable. No per-user session detail is requested
// here (PDF §6).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUserPatchInput } from '@focus-mode/shared';

import { adminApi } from '../api/endpoints/admin';
import type { AdminUserListParams, PublicUser } from '../api/types';
import { queryKeys } from './query-keys';

export function useAdminUsers(params: AdminUserListParams = {}) {
  return useQuery({
    queryKey: queryKeys.adminUsers(params),
    queryFn: () => adminApi.listUsers(params),
  });
}

export function useUpdateAdminUser() {
  const queryClient = useQueryClient();

  return useMutation<PublicUser, unknown, { id: string; input: AdminUserPatchInput }>({
    mutationFn: ({ id, input }) => adminApi.patchUser(id, input),
    onSuccess: (user) => {
      queryClient.setQueriesData<{ items: PublicUser[] }>(
        { queryKey: queryKeys.adminUsersRoot },
        (current) =>
          current === undefined
            ? current
            : {
                ...current,
                items: current.items.map((item) => (item.id === user.id ? user : item)),
              },
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsersRoot });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminStats });
    },
  });
}
