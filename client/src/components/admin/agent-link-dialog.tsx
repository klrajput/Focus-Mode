/*
 * Admin download-link create/edit dialog (UX_SPEC §4.10, INTEGRATION_CONTRACTS §3.1 #33–#34).
 * Fields are the shared `agentLinkCreateSchema` contract plus one stricter client rule: installers
 * must be served over HTTPS. An invalid URL is surfaced inline before the request is sent, and a
 * server `VALIDATION_ERROR` is mapped back to the same field.
 */

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { z } from 'zod';
import {
  agentArchSchema,
  agentVersionSchema,
  displayNameSchema,
  osSchema,
} from '@focus-mode/shared';

import type { AgentLink } from '../../api/types';
import { isApiError } from '../../api/errors';
import { ERROR_MESSAGES, copyForError } from '../../copy/errors';
import { useCreateAgentLink, useUpdateAgentLink } from '../../hooks/use-admin-agent-links';
import { formatOs } from '../../lib/format';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { Input } from '../ui/input';
import { Select } from '../ui/select';

const agentLinkFormSchema = z.object({
  os: osSchema,
  arch: agentArchSchema,
  label: displayNameSchema,
  url: z
    .url('Enter an absolute URL.')
    .max(2048, '2048 characters or less.')
    .refine(
      (value) => value.startsWith('https://'),
      'Enter an https URL — installers must be served over HTTPS.',
    ),
  version: agentVersionSchema,
});

type AgentLinkFormValues = z.infer<typeof agentLinkFormSchema>;

const OS_OPTIONS = ['macOS', 'windows', 'linux'] as const;
const ARCH_OPTIONS = ['x64', 'arm64', 'universal'] as const;

export interface AgentLinkDialogProps {
  link: AgentLink | null;
  onClose: () => void;
}

export function AgentLinkDialog({ link, onClose }: AgentLinkDialogProps) {
  const createLink = useCreateAgentLink();
  const updateLink = useUpdateAgentLink();
  const [banner, setBanner] = useState<string | null>(null);

  const form = useForm<AgentLinkFormValues>({
    resolver: zodResolver(agentLinkFormSchema),
    defaultValues:
      link === null
        ? {
            os: 'macOS',
            arch: 'universal',
            label: '',
            url: 'https://',
            version: '1.0.0',
          }
        : {
            os: link.os,
            arch: link.arch,
            label: link.label,
            url: link.url,
            version: link.version,
          },
    mode: 'onSubmit',
  });

  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: AgentLinkFormValues): Promise<void> {
    setBanner(null);
    try {
      if (link === null) {
        await createLink.mutateAsync(values);
      } else {
        await updateLink.mutateAsync({ id: link.id, input: values });
      }
      toast.success('Download link updated');
      onClose();
    } catch (error) {
      if (isApiError(error) && error.code === 'VALIDATION_ERROR' && error.details.length > 0) {
        for (const issue of error.details) {
          if (
            issue.path === 'os' ||
            issue.path === 'arch' ||
            issue.path === 'label' ||
            issue.path === 'url' ||
            issue.path === 'version'
          ) {
            form.setError(issue.path, { type: 'server', message: issue.message });
          }
        }
        setBanner(ERROR_MESSAGES.VALIDATION_ERROR);
        return;
      }
      setBanner(copyForError(error));
    }
  }

  return (
    <Dialog
      open
      title={link === null ? 'New download link' : 'Edit download link'}
      description="Published installers appear on the landing page and in Settings."
      onClose={() => {
        if (!isSubmitting) onClose();
      }}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="agent-link-form"
            loading={isSubmitting}
            loadingLabel="Saving…"
          >
            Save link
          </Button>
        </>
      }
    >
      {banner === null ? null : (
        <p
          role="alert"
          className="mb-4 rounded-[var(--radius-control)] bg-danger-subtle px-3 py-2 text-[13px] leading-[1.45] font-medium text-danger-text"
        >
          {banner}
        </p>
      )}

      <form
        id="agent-link-form"
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
      >
        <Select
          label="Operating system"
          requiredText
          error={errors.os?.message}
          {...form.register('os')}
        >
          {OS_OPTIONS.map((os) => (
            <option key={os} value={os}>
              {formatOs(os)}
            </option>
          ))}
        </Select>

        <Select
          label="Architecture"
          requiredText
          error={errors.arch?.message}
          {...form.register('arch')}
        >
          {ARCH_OPTIONS.map((arch) => (
            <option key={arch} value={arch}>
              {arch}
            </option>
          ))}
        </Select>

        <Input
          label="Label"
          requiredText
          placeholder="Focus Agent for macOS"
          error={errors.label?.message}
          {...form.register('label')}
        />

        <Input
          label="Version"
          requiredText
          placeholder="1.4.0"
          hint="Semver, e.g. 1.4.0."
          error={errors.version?.message}
          {...form.register('version')}
        />

        <div className="sm:col-span-2">
          <Input
            label="Download URL"
            type="url"
            requiredText
            placeholder="https://downloads.example.com/focus-agent.dmg"
            hint="Must be an absolute HTTPS URL."
            error={errors.url?.message}
            {...form.register('url')}
          />
        </div>
      </form>
    </Dialog>
  );
}
