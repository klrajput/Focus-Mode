// `/allowlist` reads and mutations (INTEGRATION_CONTRACTS §3.1 #15–#16, FR-008/FR-020, INV-3).
// `useAllowlist` reads the protected + user apps. `useUpdateAllowlist` sends the whole `userApps`
// array (the only mutable part) with an optimistic cache update that is rolled back on any error,
// and `useApplyPreset` merges or replaces the user apps through the server helper. Protected rows
// are never part of either payload, so the client cannot even attempt to change them.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppEntry } from '@focus-mode/shared';

import { allowlistApi, type PresetApplyMode } from '../api/endpoints/allowlist';
import type { AllowList } from '../api/types';
import { queryKeys } from './query-keys';

export function useAllowlist() {
  return useQuery({
    queryKey: queryKeys.allowlist,
    queryFn: allowlistApi.get,
  });
}

/** Optimistic PUT /allowlist: the row disappears immediately and comes back if the API refuses. */
export function useUpdateAllowlist() {
  const queryClient = useQueryClient();

  return useMutation<AllowList, unknown, AppEntry[], { previous: AllowList | undefined }>({
    mutationFn: (userApps) => allowlistApi.put({ userApps }),
    onMutate: async (userApps) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.allowlist });
      const previous = queryClient.getQueryData<AllowList>(queryKeys.allowlist);
      if (previous !== undefined) {
        queryClient.setQueryData<AllowList>(queryKeys.allowlist, { ...previous, userApps });
      }
      return { previous };
    },
    onError: (_error, _userApps, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData<AllowList>(queryKeys.allowlist, context.previous);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData<AllowList>(queryKeys.allowlist, data);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.allowlist });
    },
  });
}

/** Apply an admin preset; the server decides the merged/replaced set and returns it whole. */
export function useApplyPreset() {
  const queryClient = useQueryClient();

  return useMutation<AllowList, unknown, { id: string; mode: PresetApplyMode }>({
    mutationFn: ({ id, mode }) => allowlistApi.applyPreset(id, mode),
    onSuccess: (data) => {
      queryClient.setQueryData<AllowList>(queryKeys.allowlist, data);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.allowlist });
    },
  });
}
