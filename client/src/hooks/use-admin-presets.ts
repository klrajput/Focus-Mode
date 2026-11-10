// Admin preset CRUD (`/admin/presets`, INTEGRATION_CONTRACTS §3.1 #28–#31, FR-019).
// Presets are published app bundles; admins create/edit/delete them and every user can apply one
// from the allow-list editor. Mutations invalidate both the admin list and the shared `/presets`
// cache so the allow-list picker never shows a deleted preset.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PresetCreateInput, PresetUpdateInput } from '@focus-mode/shared';

import { adminApi } from '../api/endpoints/admin';
import type { DeletedResource, Preset } from '../api/types';
import { queryKeys } from './query-keys';

export function useAdminPresets() {
  return useQuery<Preset[]>({
    queryKey: queryKeys.adminPresets,
    queryFn: async () => (await adminApi.listPresets()).items,
  });
}

function useInvalidatePresets() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminPresets });
    void queryClient.invalidateQueries({ queryKey: queryKeys.presets });
  };
}

export function useCreatePreset() {
  const invalidate = useInvalidatePresets();
  return useMutation<Preset, unknown, PresetCreateInput>({
    mutationFn: adminApi.createPreset,
    onSettled: invalidate,
  });
}

export function useUpdatePreset() {
  const invalidate = useInvalidatePresets();
  return useMutation<Preset, unknown, { id: string; input: PresetUpdateInput }>({
    mutationFn: ({ id, input }) => adminApi.updatePreset(id, input),
    onSettled: invalidate,
  });
}

export function useDeletePreset() {
  const invalidate = useInvalidatePresets();
  return useMutation<DeletedResource, unknown, string>({
    mutationFn: adminApi.removePreset,
    onSettled: invalidate,
  });
}
