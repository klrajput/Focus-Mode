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
  sessions: (params: SessionListParams = {}) => ['sessions', params] as const,
  insights: (range: InsightsRange) => ['insights', range] as const,
  devices: (params: DeviceListParams = {}) => ['devices', params] as const,
  allowlist: ['allowlist'] as const,
  schedules: (params: PageParams = {}) => ['schedules', params] as const,
  adminUsers: (params: AdminUserListParams = {}) => ['admin', 'users', params] as const,
  notifications: (params: PageParams = {}) => ['notifications', params] as const,
};
