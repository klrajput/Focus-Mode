/*
 * NotificationBell — the AppShell header bell (UX_SPEC §3/§4.7, INTEGRATION_CONTRACTS §3.1
 * #22–#23, FR-025). It shows the unread count derived from the real `GET /notifications` list,
 * polls every 30 s, and marks one notification read through `PATCH /notifications/:id/read`.
 * Empty, loading, error and success states are explicit; no count is ever invented while loading.
 */

import { useEffect, useRef, useState } from 'react';
import { Bell, BellRing, CheckCheck } from 'lucide-react';

import type { NotificationItem } from '../../api/types';
import { copyForError } from '../../copy/errors';
import {
  unreadCount,
  useMarkNotificationRead,
  useNotifications,
} from '../../hooks/use-notifications';
import { formatDateTime } from '../../lib/format';
import { errorCodeOf } from '../../lib/route-state';
import { cn } from '../../lib/cn';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/loading';

function NotificationRow({
  item,
  onRead,
}: {
  item: NotificationItem;
  onRead: (item: NotificationItem) => void;
}) {
  const unread = item.readAt === null;

  return (
    <li>
      <button
        type="button"
        onClick={() => onRead(item)}
        className={cn(
          'flex min-h-11 w-full items-start gap-2 px-3 py-3 text-left',
          'hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          unread ? 'bg-primary-subtle' : 'bg-transparent',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
            unread ? 'bg-focus-strong' : 'bg-border',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-[1.45] break-words text-ink">
            {item.message}
          </span>
          <span className="mt-1 block text-[13px] text-muted">
            {formatDateTime(item.createdAt)} · {unread ? 'Unread' : 'Read'}
          </span>
        </span>
      </button>
    </li>
  );
}

export function NotificationBell() {
  const notificationsQuery = useNotifications();
  const markRead = useMarkNotificationRead();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent): void {
      if (containerRef.current?.contains(event.target as Node) === true) return;
      setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const items = notificationsQuery.data ?? [];
  const unread = unreadCount(items);
  const badge = unread > 9 ? '9+' : String(unread);
  const errorCode = errorCodeOf(notificationsQuery.error);
  const label = unread === 0 ? 'Notifications' : `Notifications, ${unread} unread`;

  function handleRead(item: NotificationItem): void {
    if (item.readAt !== null) return;
    markRead.mutate(item.id);
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="notifications-panel"
        aria-label={label}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void notificationsQuery.refetch();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        className="relative flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] text-ink hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
      >
        {unread > 0 ? (
          <BellRing aria-hidden="true" className="h-5 w-5" />
        ) : (
          <Bell aria-hidden="true" className="h-5 w-5" />
        )}
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute top-1.5 right-1.5 inline-flex min-w-4 items-center justify-center rounded-[var(--radius-pill)] bg-focus-strong px-1 text-[11px] leading-4 font-semibold text-white"
          >
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id="notifications-panel"
          role="dialog"
          aria-label="Notifications"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
          className="absolute right-0 z-[var(--fm-z-nav)] mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-modal)]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <p className="text-[13px] font-semibold text-ink">Notifications</p>
            <p className="text-[13px] text-muted">
              {notificationsQuery.isSuccess
                ? unread === 0
                  ? 'All read'
                  : `${unread} unread`
                : null}
            </p>
          </div>

          {notificationsQuery.isPending ? (
            <div role="status" aria-live="polite" className="space-y-2 p-3">
              <span className="sr-only">Loading your notifications…</span>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : null}

          {notificationsQuery.isError ? (
            <div role="alert" className="p-3">
              <p className="text-[13px] leading-[1.45] text-danger-text">
                We couldn't load your notifications.
              </p>
              <p className="mt-1 text-[13px] text-muted">
                Check your connection and try again.
                {errorCode === undefined ? null : ` (Ref: ${errorCode})`}
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                onClick={() => void notificationsQuery.refetch()}
              >
                Retry
              </Button>
            </div>
          ) : null}

          {markRead.isError ? (
            <p
              role="alert"
              className="border-t border-border bg-danger-subtle px-3 py-2 text-[13px] font-medium text-danger-text"
            >
              {copyForError(markRead.error)}
            </p>
          ) : null}

          {notificationsQuery.isSuccess && items.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <CheckCheck aria-hidden="true" className="mx-auto h-5 w-5 text-focus-strong" />
              <p className="mt-2 text-[15px] font-medium text-ink">No notifications yet.</p>
              <p className="mt-1 text-[13px] leading-[1.45] text-muted">
                Missed scheduled sessions will show up here.
              </p>
            </div>
          ) : null}

          {items.length > 0 ? (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {items.map((item) => (
                <NotificationRow key={item.id} item={item} onRead={handleRead} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
