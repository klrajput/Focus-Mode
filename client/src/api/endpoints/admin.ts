// Admin endpoints (INTEGRATION_CONTRACTS §3.1 #26–#36, FR-019).
// Every call is ADMIN-only on the server (403 FORBIDDEN for USER); the client guard is UX only.
// `/admin/stats` is aggregate-only — no per-user session detail exists in this module (PDF §6).

import type {
  AdminUserPatchInput,
  AgentLinkCreateInput,
  AgentLinkUpdateInput,
  Paginated,
  PresetCreateInput,
  PresetUpdateInput,
} from '@focus-mode/shared';

import { apiRequest } from '../http';
import type {
  AdminStats,
  AdminUserListParams,
  AgentLink,
  DeletedResource,
  Preset,
  PublicUser,
} from '../types';

export const adminApi = {
  listUsers: (query: AdminUserListParams = {}): Promise<Paginated<PublicUser>> =>
    apiRequest<Paginated<PublicUser>>('/admin/users', { query }),

  patchUser: (id: string, input: AdminUserPatchInput): Promise<PublicUser> =>
    apiRequest<PublicUser>(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    }),

  listPresets: (): Promise<Paginated<Preset>> => apiRequest<Paginated<Preset>>('/admin/presets'),

  createPreset: (input: PresetCreateInput): Promise<Preset> =>
    apiRequest<Preset>('/admin/presets', { method: 'POST', body: input }),

  updatePreset: (id: string, input: PresetUpdateInput): Promise<Preset> =>
    apiRequest<Preset>(`/admin/presets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    }),

  removePreset: (id: string): Promise<DeletedResource> =>
    apiRequest<DeletedResource>(`/admin/presets/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listAgentLinks: (): Promise<Paginated<AgentLink>> =>
    apiRequest<Paginated<AgentLink>>('/admin/agent-links'),

  createAgentLink: (input: AgentLinkCreateInput): Promise<AgentLink> =>
    apiRequest<AgentLink>('/admin/agent-links', { method: 'POST', body: input }),

  updateAgentLink: (id: string, input: AgentLinkUpdateInput): Promise<AgentLink> =>
    apiRequest<AgentLink>(`/admin/agent-links/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    }),

  removeAgentLink: (id: string): Promise<DeletedResource> =>
    apiRequest<DeletedResource>(`/admin/agent-links/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  stats: (): Promise<AdminStats> => apiRequest<AdminStats>('/admin/stats'),
};
