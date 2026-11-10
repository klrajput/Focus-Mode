// Public installer downloads (`GET /agent-links`, INTEGRATION_CONTRACTS §3.1 #25, FR-029).
// The endpoint needs no auth, so the landing page can offer real downloads to signed-out visitors.
// Only URLs the admin actually published are rendered; nothing is invented or guessed per OS.

import { useQuery } from '@tanstack/react-query';

import { agentLinksApi } from '../api/endpoints/agent-links';
import type { AgentLink } from '../api/types';
import { queryKeys } from './query-keys';

export function useAgentLinks() {
  return useQuery<AgentLink[]>({
    queryKey: queryKeys.agentLinks,
    queryFn: async () => (await agentLinksApi.list()).items,
  });
}
