/*
 * `/schedules` (UX_SPEC §4.7, T-067 / FR-012/FR-025).
 *
 * Real CRUD against INTEGRATION_CONTRACTS §3.1 #17–#20: GET the list, POST a new block, PATCH edits
 * and the enable/disable switch, DELETE after a confirmation. Every time is rendered in the user's
 * IANA timezone exactly as stored (`days` 0–6, `startTime` HH:mm) and the "next run" line is a
 * client-side read of that record — the scheduler itself runs server-side (FR-012), so nothing here
 * pretends a session started. Inline validation reuses the shared schedule schemas (NFR-001).
 */

import { useState } from 'react';
import { CalendarClock, CheckCircle2, CircleSlash2, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

import type { Schedule } from '../api/types';
import { useAgentLink } from '../agent/agent-link-provider';
import { useAuth } from '../auth/auth-context';
import { ScheduleDialog, type ScheduleFormValues } from '../components/schedules/schedule-dialog';
import { Button } from '../components/ui/button';
import { Card, CardBody } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { EmptyState } from '../components/ui/empty-state';
import { ErrorState } from '../components/ui/error-state';
import { Skeleton } from '../components/ui/loading';
import { PageHeader } from '../components/ui/page-header';
import { StatusBadge } from '../components/ui/status-badge';
import { copyForError } from '../copy/errors';
import {
  useCreateSchedule,
  useDeleteSchedule,
  useSchedules,
  useUpdateSchedule,
} from '../hooks/use-schedules';
import { formatDuration, formatScheduleDays } from '../lib/format';
import { describeNextRunDay, nextScheduleRun } from '../lib/schedule-next';
import { errorCodeOf } from '../lib/route-state';

const FALLBACK_TIME_ZONE = 'UTC';

const INFO_COPY =
  'A scheduled session starts only while your Focus Agent is connected, and only after a 10-second heads-up you can cancel. Missed runs appear in notifications (bell), not here.';

const NO_AGENT_COPY = "No Focus Agent connected — this schedule can't start until one is.";

function nextRunLabel(schedule: Schedule, timeZone: string): string {
  if (!schedule.enabled) return 'Disabled — no run scheduled.';
  const run = nextScheduleRun([schedule], timeZone);
  if (run === null) return 'No run in the next 7 days.';
  return `Next run: ${describeNextRunDay(run, timeZone)} ${schedule.startTime} · ${timeZone}`;
}

function ScheduleRow({
  schedule,
  timeZone,
  onEdit,
  onDelete,
  onToggle,
  toggling,
}: {
  schedule: Schedule;
  timeZone: string;
  onEdit: (schedule: Schedule) => void;
  onDelete: (schedule: Schedule) => void;
  onToggle: (schedule: Schedule) => void;
  toggling: boolean;
}) {
  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-[20px] leading-[1.3] font-semibold text-ink">
              {schedule.name}
            </h2>
            <p className="mt-1 text-[15px] text-ink">
              {formatScheduleDays(schedule.days)} · {schedule.startTime} ·{' '}
              {formatDuration(schedule.durationMin)} · {timeZone}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={schedule.enabled}
              aria-label={`${schedule.name} enabled`}
              onClick={() => onToggle(schedule)}
              disabled={toggling}
              className="inline-flex min-h-11 items-center rounded-[var(--radius-pill)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none disabled:cursor-not-allowed"
            >
              <StatusBadge
                tone={schedule.enabled ? 'success' : 'neutral'}
                icon={schedule.enabled ? CheckCircle2 : CircleSlash2}
              >
                {schedule.enabled ? 'Enabled' : 'Disabled'}
              </StatusBadge>
            </button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onEdit(schedule)}
              leadingIcon={<Pencil aria-hidden="true" className="h-4 w-4" />}
            >
              Edit
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onDelete(schedule)}
              leadingIcon={<Trash2 aria-hidden="true" className="h-4 w-4" />}
            >
              Delete
            </Button>
          </div>
        </div>

        <p className="mt-3 text-[13px] text-muted">{nextRunLabel(schedule, timeZone)}</p>
      </CardBody>
    </Card>
  );
}

export function SchedulesPage() {
  const { user } = useAuth();
  const agent = useAgentLink();
  const timeZone = user?.timezone ?? FALLBACK_TIME_ZONE;

  const schedulesQuery = useSchedules({ limit: 50 });
  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();
  const deleteSchedule = useDeleteSchedule();

  const schedules = schedulesQuery.data?.items ?? [];
  const agentConnected = agent.status === 'PAIRED' || agent.status === 'FOCUSING';

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Schedule | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const mutating = createSchedule.isPending || updateSchedule.isPending;

  function openCreate(): void {
    setBanner(null);
    setEditing(undefined);
    setDialogOpen(true);
  }

  function openEdit(schedule: Schedule): void {
    setBanner(null);
    setEditing(schedule);
    setDialogOpen(true);
  }

  function reportError(error: unknown): void {
    const message = copyForError(error);
    setBanner(message);
    toast.error(message);
  }

  async function save(values: ScheduleFormValues): Promise<boolean> {
    setBanner(null);
    try {
      if (editing === undefined) {
        await createSchedule.mutateAsync(values);
      } else {
        await updateSchedule.mutateAsync({ id: editing.id, input: values });
      }
      toast.success('Schedule saved');
      return true;
    } catch (error) {
      reportError(error);
      return false;
    }
  }

  async function toggleEnabled(schedule: Schedule): Promise<void> {
    setBanner(null);
    setTogglingId(schedule.id);
    try {
      await updateSchedule.mutateAsync({ id: schedule.id, input: { enabled: !schedule.enabled } });
      toast.success(schedule.enabled ? 'Schedule disabled' : 'Schedule saved');
    } catch (error) {
      reportError(error);
    } finally {
      setTogglingId(null);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (deleteTarget === null) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    setBanner(null);
    try {
      await deleteSchedule.mutateAsync(target.id);
      toast.success('Schedule deleted');
    } catch (error) {
      reportError(error);
    }
  }

  return (
    <>
      <PageHeader
        title="Schedules"
        description={`Times shown in ${timeZone}.`}
        actions={
          <Button
            onClick={openCreate}
            leadingIcon={<Plus aria-hidden="true" className="h-4 w-4" />}
          >
            New schedule
          </Button>
        }
      />

      {banner === null ? null : (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius-control)] bg-danger-subtle px-4 py-3 text-[13px] leading-[1.45] font-medium text-danger-text"
        >
          {banner}
        </p>
      )}

      {!agentConnected && schedulesQuery.isSuccess ? (
        <p
          role="status"
          className="mb-4 flex items-start gap-2 rounded-[var(--radius-control)] bg-amber-subtle px-4 py-3 text-[13px] leading-[1.45] text-amber-text"
        >
          <CircleSlash2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{NO_AGENT_COPY}</span>
        </p>
      ) : null}

      {schedulesQuery.isPending ? (
        <div role="status" aria-live="polite" className="space-y-3">
          <span className="sr-only">Loading your schedules…</span>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {schedulesQuery.isError ? (
        <ErrorState
          title="We couldn't load your schedules."
          message="Check your connection and try again."
          code={errorCodeOf(schedulesQuery.error)}
          onRetry={() => void schedulesQuery.refetch()}
        />
      ) : null}

      {schedulesQuery.isSuccess && schedules.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No schedules yet. Add one for your next deep-work block."
          action={<Button onClick={openCreate}>New schedule</Button>}
          footnote={INFO_COPY}
        />
      ) : null}

      {schedulesQuery.isSuccess && schedules.length > 0 ? (
        <div className="grid gap-4">
          <ul className="grid gap-4">
            {schedules.map((schedule) => (
              <li key={schedule.id} className="min-w-0">
                <ScheduleRow
                  schedule={schedule}
                  timeZone={timeZone}
                  onEdit={openEdit}
                  onDelete={setDeleteTarget}
                  onToggle={(target) => void toggleEnabled(target)}
                  toggling={togglingId === schedule.id}
                />
              </li>
            ))}
          </ul>

          <p className="text-[13px] leading-[1.45] text-muted">{INFO_COPY}</p>
        </div>
      ) : null}

      <ScheduleDialog
        open={dialogOpen}
        schedule={editing}
        onClose={() => setDialogOpen(false)}
        onSubmit={save}
        busy={mutating}
      />

      <Dialog
        open={deleteTarget !== null}
        title="Delete this schedule?"
        description={
          deleteTarget === null
            ? undefined
            : `“${deleteTarget.name}” will no longer start a focus session. This can't be undone.`
        }
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteSchedule.isPending}
              loadingLabel="Deleting…"
              onClick={() => void confirmDelete()}
            >
              Delete schedule
            </Button>
          </>
        }
      >
        <p className="text-[15px] text-ink">
          The schedule is removed from your account. Sessions that already ran are kept in your
          history.
        </p>
      </Dialog>
    </>
  );
}
