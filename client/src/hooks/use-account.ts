// Account self-service mutations (INTEGRATION_CONTRACTS §3.1 #6–#7, FR-029).
// Both payloads are the shared zod inputs, so the browser cannot send a shape the API rejects for
// a different reason than the form shows. A successful profile PATCH updates the cached public user
// so the sidebar/settings reflect the new name and duration without a refetch.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ChangePasswordInput, ProfilePatchInput } from '@focus-mode/shared';

import { usersApi } from '../api/endpoints/users';
import type { PasswordChanged, PublicUser } from '../api/types';
import { queryKeys } from './query-keys';

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation<PublicUser, unknown, ProfilePatchInput>({
    mutationFn: usersApi.updateProfile,
    onSuccess: (user) => {
      queryClient.setQueryData<PublicUser>(queryKeys.me, user);
    },
  });
}

export function useChangePassword() {
  return useMutation<PasswordChanged, unknown, ChangePasswordInput>({
    mutationFn: usersApi.changePassword,
  });
}
