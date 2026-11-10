/*
 * `/settings` (UX_SPEC §4.9, FR-029).
 *
 * Three sections with real behaviour, stacked so every control is reachable without hunting:
 *   · Profile  — name, IANA timezone and default duration (1–480) via `PATCH /users/me`; email and
 *                role are read-only account facts.
 *   · Security — current + new password via `POST /users/me/password`; a wrong current password is
 *                an inline field error, never a redirect.
 *   · Focus Agent — installer downloads from the public `GET /agent-links` and a confirmed
 *                `POST /devices/unpair-all`. Start at login stays in the agent tray (REC-008).
 * Every form reuses the shared validation rules and shows the §6.1 loading/error/success states.
 */

import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Download, LogOut, MonitorSmartphone, Settings as SettingsIcon } from 'lucide-react';
import { z } from 'zod';
import {
  displayNameSchema,
  passwordSchema,
  timezoneSchema,
  type ChangePasswordInput,
  type ProfilePatchInput,
} from '@focus-mode/shared';

import { devicesApi } from '../api/endpoints/devices';
import { isApiError } from '../api/errors';
import type { PublicUser } from '../api/types';
import { useAuth } from '../auth/auth-context';
import { DownloadLinks } from '../components/settings/download-links';
import { Button } from '../components/ui/button';
import { Card, CardBody, CardHeader } from '../components/ui/card';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { ErrorState } from '../components/ui/error-state';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/loading';
import { PageHeader } from '../components/ui/page-header';
import { Select } from '../components/ui/select';
import { ERROR_MESSAGES, copyForError } from '../copy/errors';
import { useChangePassword, useUpdateProfile } from '../hooks/use-account';
import { useMe } from '../hooks/use-me';
import { useRateLimit } from '../hooks/use-rate-limit';
import { queryKeys } from '../hooks/query-keys';
import { formatDate, formatDuration } from '../lib/format';
import { errorCodeOf } from '../lib/route-state';
import { listTimeZones } from '../lib/timezones';

/** Friendly bounds mirroring `durationMinSchema` (1–480, integer minutes). */
const profileFormSchema = z.object({
  name: displayNameSchema,
  timezone: timezoneSchema,
  defaultDurationMin: z
    .number({ error: 'Enter a whole number of minutes.' })
    .int('Enter a whole number of minutes.')
    .min(1, 'Enter at least 1 minute.')
    .max(480, 'Enter 480 minutes or less.'),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

/** `changePasswordSchema` plus the confirm field, which never leaves the browser. */
const passwordFormSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, 'Enter your current password.')
      .max(72, '72 characters or less.'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'Repeat the new password.'),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'New password must differ from the current password.',
  });

type PasswordFormValues = z.infer<typeof passwordFormSchema>;

function ReadOnlyFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="truncate text-[15px] text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}

function ProfilePanel({ user }: { user: PublicUser }) {
  const updateProfile = useUpdateProfile();
  const [banner, setBanner] = useState<string | null>(null);
  const timeZones = useMemo(() => listTimeZones(user.timezone), [user.timezone]);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      name: user.name,
      timezone: user.timezone,
      defaultDurationMin: user.defaultDurationMin,
    },
    mode: 'onSubmit',
  });

  const { errors, isSubmitting } = form.formState;
  const duration = form.watch('defaultDurationMin');

  async function onSubmit(values: ProfileFormValues): Promise<void> {
    setBanner(null);
    try {
      await updateProfile.mutateAsync(values satisfies ProfilePatchInput);
      toast.success('Settings saved');
    } catch (error) {
      if (isApiError(error) && error.code === 'VALIDATION_ERROR' && error.details.length > 0) {
        for (const issue of error.details) {
          if (issue.path === 'name' || issue.path === 'timezone') {
            form.setError(issue.path, { type: 'server', message: issue.message });
          }
          if (issue.path === 'defaultDurationMin') {
            form.setError('defaultDurationMin', { type: 'server', message: issue.message });
          }
        }
        setBanner(ERROR_MESSAGES.VALIDATION_ERROR);
        return;
      }
      setBanner(copyForError(error));
    }
  }

  return (
    <div className="grid gap-4">
      <Card ariaLabelledBy="profile-heading">
        <CardHeader
          title="Profile"
          titleId="profile-heading"
          description="Your name, timezone and default focus duration."
        />
        <CardBody>
          <dl className="mb-5 grid gap-4 border-b border-border pb-5 sm:grid-cols-3">
            <ReadOnlyFact label="Email" value={user.email} />
            <ReadOnlyFact label="Role" value={user.role === 'ADMIN' ? 'Admin' : 'User'} />
            <ReadOnlyFact label="Member since" value={formatDate(user.createdAt)} />
          </dl>

          {banner === null ? null : (
            <p
              role="alert"
              className="mb-4 rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-[13px] leading-[1.45] font-medium text-danger-text"
            >
              {banner}
            </p>
          )}

          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={form.handleSubmit(onSubmit)}
            noValidate
          >
            <Input
              label="Name"
              autoComplete="name"
              requiredText
              error={errors.name?.message}
              {...form.register('name')}
            />

            <Select
              label="Timezone"
              requiredText
              hint="Used for schedules, insights days and the times shown here."
              error={errors.timezone?.message}
              {...form.register('timezone')}
            >
              {timeZones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>

            <div className="sm:col-span-2">
              <Input
                label="Default duration (minutes)"
                type="number"
                inputMode="numeric"
                min={1}
                max={480}
                step={1}
                requiredText
                hint="1–480 minutes. The Start focus card offers this first."
                error={errors.defaultDurationMin?.message}
                {...form.register('defaultDurationMin', { valueAsNumber: true })}
              />
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Common durations">
                {[25, 50, 60].map((minutes) => {
                  const active = Number(duration) === minutes;
                  return (
                    <button
                      key={minutes}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        form.setValue('defaultDurationMin', minutes, { shouldValidate: true });
                      }}
                      className={
                        active
                          ? 'inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-primary bg-primary-subtle px-3 text-sm font-medium text-primary-active focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-10'
                          : 'inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm font-medium text-ink hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-10'
                      }
                    >
                      {minutes} m
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="sm:col-span-2">
              <Button type="submit" loading={isSubmitting} loadingLabel="Saving…">
                Save changes
              </Button>
            </div>
          </form>

          <p className="mt-4 text-[13px] text-muted">
            Email is managed by your account; changing it needs an admin. Start at login is
            controlled in the Focus Agent tray, never from this dashboard.
          </p>
        </CardBody>
      </Card>

      <Card ariaLabelledBy="session-heading">
        <CardHeader title="This session" titleId="session-heading" />
        <CardBody>
          <SignOutButton />
        </CardBody>
      </Card>
    </div>
  );
}

function SignOutButton() {
  const { logout } = useAuth();

  return (
    <Button
      variant="secondary"
      onClick={() => void logout()}
      leadingIcon={<LogOut aria-hidden="true" className="h-4 w-4" />}
    >
      Sign out
    </Button>
  );
}

function SecurityPanel() {
  const changePassword = useChangePassword();
  const rateLimit = useRateLimit();
  const [banner, setBanner] = useState<string | null>(null);

  const form = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    mode: 'onSubmit',
  });

  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: PasswordFormValues): Promise<void> {
    setBanner(null);
    const input: ChangePasswordInput = {
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    };

    try {
      await changePassword.mutateAsync(input);
      toast.success('Password updated');
      form.reset();
    } catch (error) {
      if (isApiError(error) && error.code === 'RATE_LIMITED') {
        rateLimit.start();
        setBanner(ERROR_MESSAGES.RATE_LIMITED);
        return;
      }
      if (isApiError(error) && error.code === 'VALIDATION_ERROR' && error.details.length > 0) {
        for (const issue of error.details) {
          if (issue.path === 'currentPassword') {
            // UX_SPEC §4.9: a wrong current password is an inline field error.
            form.setError('currentPassword', {
              type: 'server',
              message: 'Current password is incorrect.',
            });
          } else if (issue.path === 'newPassword') {
            form.setError('newPassword', { type: 'server', message: issue.message });
          }
        }
        setBanner(ERROR_MESSAGES.VALIDATION_ERROR);
        return;
      }
      setBanner(copyForError(error));
    }
  }

  return (
    <Card ariaLabelledBy="security-heading">
      <CardHeader
        title="Security"
        titleId="security-heading"
        description="Change the password for this account."
      />
      <CardBody>
        {banner === null ? null : (
          <p
            role="alert"
            className="mb-4 rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-[13px] leading-[1.45] font-medium text-danger-text"
          >
            {banner}
          </p>
        )}

        <form className="grid max-w-xl gap-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <Input
            label="Current password"
            type="password"
            autoComplete="current-password"
            requiredText
            error={errors.currentPassword?.message}
            {...form.register('currentPassword')}
          />
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            requiredText
            hint="8–72 characters with at least one letter and one digit."
            error={errors.newPassword?.message}
            {...form.register('newPassword')}
          />
          <Input
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            requiredText
            error={errors.confirmPassword?.message}
            {...form.register('confirmPassword')}
          />

          <div>
            <Button
              type="submit"
              loading={isSubmitting}
              loadingLabel="Updating…"
              disabled={rateLimit.isLimited}
            >
              Update password
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function FocusAgentPanel() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unpairAll = useMutation({
    mutationFn: devicesApi.unpairAll,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.devicesRoot });
    },
  });

  async function confirmUnpairAll(): Promise<void> {
    setError(null);
    try {
      await unpairAll.mutateAsync();
      toast.success('All devices unpaired');
      setDialogOpen(false);
    } catch (failure) {
      setError(copyForError(failure));
    }
  }

  return (
    <div className="grid gap-4">
      <Card ariaLabelledBy="downloads-heading">
        <CardHeader
          title="Focus Agent"
          titleId="downloads-heading"
          description="The desktop companion that applies focus."
          action={<Download aria-hidden="true" className="h-5 w-5 text-muted" />}
        />
        <CardBody>
          <DownloadLinks />
          <p className="mt-4 text-[13px] leading-[1.45] text-muted">
            Start at login is controlled in the Focus Agent tray, never from this dashboard.
          </p>
        </CardBody>
      </Card>

      <Card ariaLabelledBy="unpair-all-heading">
        <CardHeader
          title="Paired devices"
          titleId="unpair-all-heading"
          description="Unpairing revokes every Focus Agent token for this account."
        />
        <CardBody>
          <Button
            variant="secondary"
            onClick={() => {
              setError(null);
              setDialogOpen(true);
            }}
            leadingIcon={<MonitorSmartphone aria-hidden="true" className="h-4 w-4" />}
          >
            Unpair all devices
          </Button>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={dialogOpen}
        title="Unpair all devices?"
        description="Every Focus Agent paired to this account loses access until you pair it again. Any running focus session ends and your windows are restored."
        confirmLabel="Unpair all"
        loadingLabel="Unpairing…"
        pending={unpairAll.isPending}
        error={error}
        onClose={() => setDialogOpen(false)}
        onConfirm={() => void confirmUnpairAll()}
      />
    </div>
  );
}

function SectionLink({ id, label }: { id: string; label: string }) {
  return (
    <a
      href={`#${id}`}
      className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-border-strong bg-card px-3 text-sm font-medium text-ink hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none md:min-h-10"
    >
      {label}
    </a>
  );
}

export function SettingsPage() {
  const meQuery = useMe();
  const me = meQuery.data;

  return (
    <>
      <PageHeader title="Settings" description="Your profile, security and Focus Agent setup." />

      {meQuery.isPending ? (
        <div role="status" aria-live="polite" className="space-y-4">
          <span className="sr-only">Loading your settings…</span>
          <Skeleton className="h-10 w-60" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : null}

      {meQuery.isError ? (
        <ErrorState
          title="We couldn't load your settings."
          message="Check your connection and try again."
          code={errorCodeOf(meQuery.error)}
          onRetry={() => void meQuery.refetch()}
        />
      ) : null}

      {meQuery.isSuccess && me !== undefined ? (
        <>
          <nav aria-label="Settings sections" className="mb-4 flex flex-wrap gap-2">
            <SectionLink id="profile" label="Profile" />
            <SectionLink id="security" label="Security" />
            <SectionLink id="agent" label="Focus Agent" />
          </nav>

          <div className="grid gap-4">
            <div id="profile" className="scroll-mt-6">
              <ProfilePanel user={me} />
            </div>
            <div id="security" className="scroll-mt-6">
              <SecurityPanel />
            </div>
            <div id="agent" className="scroll-mt-6">
              <FocusAgentPanel />
            </div>
          </div>

          <p className="mt-6 flex items-center gap-2 text-[13px] text-muted">
            <SettingsIcon aria-hidden="true" className="h-4 w-4" />
            Default duration is {formatDuration(me.defaultDurationMin)}; timezone {me.timezone}.
          </p>
        </>
      ) : null}
    </>
  );
}
