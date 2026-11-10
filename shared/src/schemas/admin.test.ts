// shared/src/schemas/admin.test.ts — admin user/preset/agent-link payloads (FR-019).
// Role and isActive are admin-only fields; presets and download links are validated (unique app
// keys, absolute URLs, semver versions) and every object is strict (NFR-013).

import { describe, expect, it } from 'vitest';
import {
  adminUserListQuerySchema,
  adminUserPatchSchema,
  adminUsersSortSchema,
  agentLinkCreateSchema,
  agentLinkUpdateSchema,
  presetCreateSchema,
  presetUpdateSchema,
} from './admin.js';
import { appEntrySchema, type AppEntry } from './app.js';

const slack: AppEntry = { key: 'slack', label: 'Slack', win: ['slack.exe'] };
const vscode: AppEntry = { key: 'vscode', label: 'Visual Studio Code', win: ['Code.exe'] };

const validLink = {
  os: 'macOS',
  arch: 'arm64',
  label: 'Focus Agent for macOS (Apple silicon)',
  url: 'https://github.com/klrajput/Focus-Mode/releases/download/v1.0.0/Focus-Agent-1.0.0-arm64.dmg',
  version: '1.0.0',
};

describe('adminUserPatchSchema (GET/PATCH /admin/users)', () => {
  it('accepts any non-empty subset of admin-managed fields', () => {
    expect(adminUserPatchSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(adminUserPatchSchema.safeParse({ role: 'ADMIN' }).success).toBe(true);
    expect(adminUserPatchSchema.safeParse({ name: 'Kabir' }).success).toBe(true);
  });

  it('rejects empty patches, unknown roles and non-admin fields', () => {
    expect(adminUserPatchSchema.safeParse({}).success).toBe(false);
    expect(adminUserPatchSchema.safeParse({ role: 'ROOT' }).success).toBe(false);
    expect(adminUserPatchSchema.safeParse({ passwordHash: 'x' }).success).toBe(false);
    expect(adminUserPatchSchema.safeParse({ email: 'x@y.co' }).success).toBe(false);
  });

  it('admin user list query defaults and sort whitelist', () => {
    const parsed = adminUserListQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
    expect(parsed.sort).toBe('-createdAt');
    expect(adminUsersSortSchema.safeParse('-lastLoginAt').success).toBe(true);
    expect(adminUsersSortSchema.safeParse('passwordHash').success).toBe(false);
    expect(adminUserListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(adminUserListQuerySchema.safeParse({ search: '' }).success).toBe(false);
    expect(adminUserListQuerySchema.safeParse({ unknown: 1 }).success).toBe(false);
  });
});

describe('presets (GET/POST/PATCH/DELETE /admin/presets)', () => {
  it('accepts a valid preset', () => {
    expect(presetCreateSchema.safeParse({ name: 'Coding', apps: [vscode, slack] }).success).toBe(
      true,
    );
  });

  it('rejects empty, duplicated and oversized app lists and bad names', () => {
    expect(presetCreateSchema.safeParse({ name: 'Coding', apps: [] }).success).toBe(false);
    expect(presetCreateSchema.safeParse({ name: 'Coding', apps: [slack, slack] }).success).toBe(
      false,
    );
    expect(presetCreateSchema.safeParse({ name: 'C', apps: [slack] }).success).toBe(false);
    const apps = Array.from({ length: 51 }, (_unused, index) => ({
      key: `app-${index}`,
      label: `App ${index}`,
    }));
    expect(presetCreateSchema.safeParse({ name: 'Coding', apps }).success).toBe(false);
    expect(
      presetCreateSchema.safeParse({ name: 'Coding', apps: [{ key: 'Bad Key', label: 'x' }] })
        .success,
    ).toBe(false);
    expect(presetCreateSchema.safeParse({ name: 'Coding', apps: [slack], extra: 1 }).success).toBe(
      false,
    );
  });

  it('update accepts partial patches and rejects empty/invalid ones', () => {
    expect(presetUpdateSchema.safeParse({ name: 'Deep work' }).success).toBe(true);
    expect(presetUpdateSchema.safeParse({ apps: [vscode] }).success).toBe(true);
    expect(presetUpdateSchema.safeParse({}).success).toBe(false);
    expect(presetUpdateSchema.safeParse({ apps: [] }).success).toBe(false);
    expect(presetUpdateSchema.safeParse({ apps: [slack, slack] }).success).toBe(false);
    expect(presetUpdateSchema.safeParse({ createdBy: 'someone' }).success).toBe(false);
  });
});

describe('agent download links (GET/POST/PATCH/DELETE /admin/agent-links)', () => {
  it('accepts a valid download link', () => {
    expect(agentLinkCreateSchema.safeParse(validLink).success).toBe(true);
    expect(agentLinkCreateSchema.parse(validLink).url).toBe(validLink.url);
  });

  it('rejects bad OS, architecture, URL and version', () => {
    expect(agentLinkCreateSchema.safeParse({ ...validLink, os: 'android' }).success).toBe(false);
    expect(agentLinkCreateSchema.safeParse({ ...validLink, arch: 'ia32' }).success).toBe(false);
    expect(agentLinkCreateSchema.safeParse({ ...validLink, url: 'not-a-url' }).success).toBe(false);
    expect(agentLinkCreateSchema.safeParse({ ...validLink, version: 'v1.0.0' }).success).toBe(
      false,
    );
    expect(agentLinkCreateSchema.safeParse({ ...validLink, label: 'A' }).success).toBe(false);
    expect(agentLinkCreateSchema.safeParse({ ...validLink, publishedBy: 'admin' }).success).toBe(
      false,
    );
  });

  it('update accepts partial patches and rejects empty/invalid ones', () => {
    expect(agentLinkUpdateSchema.safeParse({ version: '1.5.0' }).success).toBe(true);
    expect(agentLinkUpdateSchema.safeParse({ url: 'https://example.com/agent.exe' }).success).toBe(
      true,
    );
    expect(agentLinkUpdateSchema.safeParse({}).success).toBe(false);
    expect(agentLinkUpdateSchema.safeParse({ url: 'nope' }).success).toBe(false);
    expect(agentLinkUpdateSchema.safeParse({ arch: 'x86' }).success).toBe(false);
    expect(agentLinkUpdateSchema.safeParse({ publishedBy: 'admin' }).success).toBe(false);
  });

  it('uses the shared app-entry schema for preset apps', () => {
    expect(appEntrySchema.safeParse(slack).success).toBe(true);
  });
});
