// Admin installer links (`/admin/agent-links`, INTEGRATION_CONTRACTS §3.1 #32–#35, FR-019).
// These links are the only source of the public landing/settings download buttons, so a mutation
// invalidates `GET /agent-links` too and users see a published/replaced URL immediately.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentLinkCreateInput, AgentLinkUpdateInput } from '@focus-mode/shared';

import { adminApi } from '../api/endpoints/admin';
import type { AgentLink, DeletedResource } from '../api/types';
import { queryKeys } from './query-keys';

export function useAdminAgentLinks() {
  return useQuery<AgentLink[]>({
    queryKey: queryKeys.adminAgentLinks,
    queryFn: async () => (await adminApi.listAgentLinks()).items,
  });
}

function useInvalidateAgentLinks() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminAgentLinks });
    void queryClient.invalidateQueries({ queryKey: queryKeys.agentLinks });
  };
}

export function useCreateAgentLink() {
  const invalidate = useInvalidateAgentLinks();
  return useMutation<AgentLink, unknown, AgentLinkCreateInput>({
    mutationFn: adminApi.createAgentLink,
    onSettled: invalidate,
  });
}

export function useUpdateAgentLink() {
  const invalidate = useInvalidateAgentLinks();
  return useMutation<AgentLink, unknown, { id: string; input: AgentLinkUpdateInput }>({
    mutationFn: ({ id, input }) => adminApi.updateAgentLink(id, input),
    onSettled: invalidate,
  });
}

export function useDeleteAgentLink() {
  const invalidate = useInvalidateAgentLinks();
  return useMutation<DeletedResource, unknown, string>({
    mutationFn: adminApi.removeAgentLink,
    onSettled: invalidate,
  });
}
