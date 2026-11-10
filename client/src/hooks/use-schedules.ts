// `/schedules` reads and mutations (INTEGRATION_CONTRACTS §3.1 #17–#20, FR-012).
// Times are the user's IANA-zone wall clock; the page shows the timezone from `/auth/me` and never
// converts the value itself. Creating/editing/toggling/deleting a schedule only changes the record —
// starting the session is the server scheduler's job (FR-012), never the dashboard's.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ScheduleCreateInput, ScheduleUpdateInput } from '@focus-mode/shared';

import { schedulesApi } from '../api/endpoints/schedules';
import type { PageParams, Schedule } from '../api/types';
import { queryKeys } from './query-keys';

export function useSchedules(params: PageParams = {}) {
  return useQuery({
    queryKey: queryKeys.schedules(params),
    queryFn: () => schedulesApi.list(params),
  });
}

function useInvalidateSchedules() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.schedulesRoot });
  };
}

/** `POST /schedules` — one new recurring block (enabled by default on the server). */
export function useCreateSchedule() {
  const invalidate = useInvalidateSchedules();
  return useMutation<Schedule, unknown, ScheduleCreateInput>({
    mutationFn: schedulesApi.create,
    onSettled: invalidate,
  });
}

/** `PATCH /schedules/:id` — edit the block or flip `enabled`. */
export function useUpdateSchedule() {
  const invalidate = useInvalidateSchedules();
  return useMutation<Schedule, unknown, { id: string; input: ScheduleUpdateInput }>({
    mutationFn: ({ id, input }) => schedulesApi.update(id, input),
    onSettled: invalidate,
  });
}

/** `DELETE /schedules/:id` — the record is removed; nothing else is touched. */
export function useDeleteSchedule() {
  const invalidate = useInvalidateSchedules();
  return useMutation<{ id: string }, unknown, string>({
    mutationFn: schedulesApi.remove,
    onSettled: invalidate,
  });
}
