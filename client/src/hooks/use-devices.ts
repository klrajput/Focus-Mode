// `GET /devices` (INTEGRATION_CONTRACTS §3.1 #9). The device list is the only place the dashboard
// learns agent presence; a missing device is an empty state, not an error (UX_SPEC §4.5).

import { useQuery } from '@tanstack/react-query';

import { devicesApi } from '../api/endpoints/devices';
import type { DeviceListParams } from '../api/types';
import { queryKeys } from './query-keys';

export interface UseDevicesOptions {
  /** Background refetch while `/devices` is open, so a pairing shows up without a reload. */
  refetchInterval?: number | false;
}

export function useDevices(params: DeviceListParams = {}, options: UseDevicesOptions = {}) {
  return useQuery({
    queryKey: queryKeys.devices(params),
    queryFn: () => devicesApi.list(params),
    refetchInterval: options.refetchInterval ?? false,
  });
}
