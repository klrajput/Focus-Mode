/*
 * Query key registry — one place so invalidation after a mutation can target exactly what changed.
 * Keys are tuples (TanStack convention); parameterised lists include their params so page/range
 * switches produce distinct cache entries instead of silently reusing stale data.
 */

import type { InsightsRange } from '@focus-mode/shared';

import type {
  AdminUserListParams,
  DeviceListParams,
  PageParams,
  SessionListParams,
} from '../api/types';

export const queryKeys = {
  me: ['me'] as const,
  /** Prefix for every `GET /sessions` list (also used to invalidate all of them at once). */
  sessionsRoot: ['sessions'] as const,
  sessions: (params: SessionListParams = {}) => ['sessions', params] as const,
  /** Prefix for every `GET /insights` range query. */
  insightsRoot: ['insights'] as const,
  insights: (range: InsightsRange) => ['insights', range] as const,
  devices: (params: DeviceListParams = {}) => ['devices', params] as const,
  /** Prefix for every `GET /devices` list (unpair-all invalidates all of them). */
  devicesRoot: ['devices'] as const,
  allowlist: ['allowlist'] as const,
  /** Shared admin-published presets (GET /presets) used by the allow-list editor. */
  presets: ['presets'] as const,
  /** Prefix for every `GET /schedules` list (mutations invalidate all of them). */
  schedulesRoot: ['schedules'] as const,
  schedules: (params: PageParams = {}) => ['schedules', params] as const,
  adminUsers: (params: AdminUserListParams = {}) => ['admin', 'users', params] as const,
  /** Prefix for every `GET /admin/users` list (role/active edits invalidate all pages). */
  adminUsersRoot: ['admin', 'users'] as const,
  adminPresets: ['admin', 'presets'] as const,
  adminAgentLinks: ['admin', 'agent-links'] as const,
  adminStats: ['admin', 'stats'] as const,
  /** Public installer links (GET /agent-links) shared by the landing page and /settings. */
  agentLinks: ['agent-links'] as const,
  /** Prefix for every `GET /notifications` list; marking one read invalidates all of them. */
  notificationsRoot: ['notifications'] as const,
  notifications: (params: PageParams = {}) => ['notifications', params] as const,
};
