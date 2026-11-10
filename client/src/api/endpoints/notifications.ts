// Notification endpoints (INTEGRATION_CONTRACTS §3.1 #22–#23, FR-025).
// The bell + notification UI land in W5 (DEC-012 Q2); this module is the typed seam so no fake
// count is ever rendered before the API exists.

import type { Paginated } from '@focus-mode/shared';

import { apiRequest } from '../http';
import type { NotificationItem, PageParams } from '../types';

export const notificationsApi = {
  list: (query: PageParams = {}): Promise<Paginated<NotificationItem>> =>
    apiRequest<Paginated<NotificationItem>>('/notifications', { query }),

  markRead: (id: string): Promise<NotificationItem> =>
    apiRequest<NotificationItem>(`/notifications/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
    }),
};
