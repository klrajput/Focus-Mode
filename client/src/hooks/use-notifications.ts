// Notifications for the AppShell bell (`GET /notifications`, `PATCH /notifications/:id/read` —
// INTEGRATION_CONTRACTS §3.1 #22–#23, FR-025). The list is polled every 30 s so a missed scheduled
// session shows up without a reload. Unread is derived from `readAt === null`; the API exposes no
// separate counter, so the client never claims a number it cannot see.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { notificationsApi } from '../api/endpoints/notifications';
import type { NotificationItem } from '../api/types';
import { queryKeys } from './query-keys';

export const NOTIFICATIONS_REFETCH_MS = 30_000;
const NOTIFICATION_PAGE_SIZE = 20;

export function useNotifications() {
  return useQuery<NotificationItem[]>({
    queryKey: queryKeys.notifications({ limit: NOTIFICATION_PAGE_SIZE }),
    queryFn: async () => (await notificationsApi.list({ limit: NOTIFICATION_PAGE_SIZE })).items,
    refetchInterval: NOTIFICATIONS_REFETCH_MS,
  });
}

/** Unread count from the loaded page (never more than the page size, never invented). */
export function unreadCount(items: readonly NotificationItem[]): number {
  return items.filter((item) => item.readAt === null).length;
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation<NotificationItem, unknown, string>({
    mutationFn: notificationsApi.markRead,
    onSuccess: (updated) => {
      queryClient.setQueryData<NotificationItem[]>(
        queryKeys.notifications({ limit: NOTIFICATION_PAGE_SIZE }),
        (current) =>
          current === undefined
            ? current
            : current.map((item) => (item.id === updated.id ? updated : item)),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.notificationsRoot });
    },
  });
}
