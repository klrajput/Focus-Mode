// shared/src/schemas/admin.ts — admin user/preset/agent-link payloads (FR-019).
// Admin writes are the only place role and isActive can change; presets and download links are
// published by admins and consumed read-only by users. Strict objects, whitelisted sorts.

import { z } from 'zod';
import {
  agentArchSchema,
  agentVersionSchema,
  displayNameSchema,
  osSchema,
  roleSchema,
} from './common.js';
import { appEntrySchema, hasDuplicateAppKeys, UNIQUE_APP_KEYS_MESSAGE } from './app.js';

const nonEmptyUpdate = (value: object): boolean => Object.keys(value).length > 0;

export const adminUsersSortSchema = z.enum([
  'name',
  '-name',
  'email',
  '-email',
  'createdAt',
  '-createdAt',
  'lastLoginAt',
  '-lastLoginAt',
]);

export const adminUserPatchSchema = z
  .strictObject({
    name: displayNameSchema.optional(),
    role: roleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(nonEmptyUpdate, 'At least one user field is required');

export const adminUserListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: adminUsersSortSchema.default('-createdAt'),
  search: z.string().trim().min(1).max(100).optional(),
});

export const presetCreateSchema = z.strictObject({
  name: displayNameSchema,
  apps: z
    .array(appEntrySchema)
    .min(1)
    .max(50)
    .refine((apps) => !hasDuplicateAppKeys(apps), UNIQUE_APP_KEYS_MESSAGE),
});

export const presetUpdateSchema = z
  .strictObject({
    name: displayNameSchema.optional(),
    apps: z
      .array(appEntrySchema)
      .min(1)
      .max(50)
      .refine((apps) => !hasDuplicateAppKeys(apps), UNIQUE_APP_KEYS_MESSAGE)
      .optional(),
  })
  .refine(nonEmptyUpdate, 'At least one preset field is required');

export const agentLinkCreateSchema = z.strictObject({
  os: osSchema,
  arch: agentArchSchema,
  label: displayNameSchema,
  url: z.url('Expected an absolute URL').max(2048),
  version: agentVersionSchema,
});

export const agentLinkUpdateSchema = z
  .strictObject({
    os: osSchema.optional(),
    arch: agentArchSchema.optional(),
    label: displayNameSchema.optional(),
    url: z.url('Expected an absolute URL').max(2048).optional(),
    version: agentVersionSchema.optional(),
  })
  .refine(nonEmptyUpdate, 'At least one agent link field is required');

export type AdminUserPatchInput = z.infer<typeof adminUserPatchSchema>;
export type AdminUserListQuery = z.infer<typeof adminUserListQuerySchema>;
export type PresetCreateInput = z.infer<typeof presetCreateSchema>;
export type PresetUpdateInput = z.infer<typeof presetUpdateSchema>;
export type AgentLinkCreateInput = z.infer<typeof agentLinkCreateSchema>;
export type AgentLinkUpdateInput = z.infer<typeof agentLinkUpdateSchema>;
