// Shared presets (INTEGRATION_CONTRACTS §3.1 #24). Any authenticated user can read the presets
// admins publish; `/allowlist` can apply one later (T-034). Create/update lives in `admin.ts`.

import type { Paginated } from '@focus-mode/shared';

import { apiRequest } from '../http';
import type { Preset } from '../types';

export const presetsApi = {
  list: (): Promise<Paginated<Preset>> => apiRequest<Paginated<Preset>>('/presets'),
};
