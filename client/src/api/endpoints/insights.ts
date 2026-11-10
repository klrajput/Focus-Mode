// Insights endpoint (INTEGRATION_CONTRACTS §3.1 #21, FR-013).
// Only the frozen `7d | 30d | 90d` ranges exist; the timezone override is optional because the
// server prefers the user's stored IANA zone. Numbers are focused time (`actualMinutes`).

import type { InsightsRange } from '@focus-mode/shared';

import { apiRequest } from '../http';
import type { Insights } from '../types';

export const insightsApi = {
  get: (range: InsightsRange, timezone?: string): Promise<Insights> =>
    apiRequest<Insights>('/insights', { query: { range, timezone } }),
};
