// Barrel for the typed API layer. Components and hooks import endpoint objects from here;
// nothing in this directory renders UI, so tests can mock one endpoint module at a time.

export { adminApi } from './endpoints/admin';
export { agentLinksApi } from './endpoints/agent-links';
export { allowlistApi } from './endpoints/allowlist';
export { authApi } from './endpoints/auth';
export { devicesApi } from './endpoints/devices';
export { insightsApi } from './endpoints/insights';
export { notificationsApi } from './endpoints/notifications';
export { presetsApi } from './endpoints/presets';
export { schedulesApi } from './endpoints/schedules';
export { sessionsApi } from './endpoints/sessions';
export { usersApi } from './endpoints/users';
export { ApiError, isApiError, toApiError, errorCodeForStatus } from './errors';
export { apiRequest } from './http';
export type * from './types';
