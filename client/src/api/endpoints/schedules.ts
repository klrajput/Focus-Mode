// Schedule endpoints (INTEGRATION_CONTRACTS §3.1 #17–#20, FR-012).
// Schedules are interpreted in the user's IANA timezone and only start while a Focus Agent is
// connected; the list is fixed-sort `createdAt desc` (no sort param in the frozen contract).

import type { Paginated, ScheduleCreateInput, ScheduleUpdateInput } from '@focus-mode/shared';

import { apiRequest } from '../http';
import type { DeletedResource, PageParams, Schedule } from '../types';

export const schedulesApi = {
  list: (query: PageParams = {}): Promise<Paginated<Schedule>> =>
    apiRequest<Paginated<Schedule>>('/schedules', { query }),

  create: (input: ScheduleCreateInput): Promise<Schedule> =>
    apiRequest<Schedule>('/schedules', { method: 'POST', body: input }),

  update: (id: string, input: ScheduleUpdateInput): Promise<Schedule> =>
    apiRequest<Schedule>(`/schedules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: input,
    }),

  remove: (id: string): Promise<DeletedResource> =>
    apiRequest<DeletedResource>(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
