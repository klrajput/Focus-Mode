// Public Focus Agent download links (INTEGRATION_CONTRACTS §3.1 #25). Used by the landing page
// and `/settings`; no auth header is sent because the endpoint is `public`.

import type { Paginated } from '@focus-mode/shared';

import { apiRequest } from '../http';
import type { AgentLink } from '../types';

export const agentLinksApi = {
  list: (): Promise<Paginated<AgentLink>> =>
    apiRequest<Paginated<AgentLink>>('/agent-links', { auth: false }),
};
