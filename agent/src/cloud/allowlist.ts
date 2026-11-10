// cloud/allowlist.ts — the scheduled-start allow-list fetch (`GET /agent/allowlist`, C-20).
// DEC-021 step 2: before a scheduled session applies focus the agent asks the cloud for the
// user's current list (device-token auth, never the browser) so the session uses the same list
// the dashboard shows. Failure is never guessed: the result is a classified `ok: false` with a
// human reason, and the caller must start no session and log that reason (FR-012 honesty).
// INV-6: only app keys/labels travel; no window title, URL or content is read here.

import { appEntrySchema, type AppEntry, type ErrorCode } from '@focus-mode/shared';
import { z } from 'zod';
import { noopLogger, type Logger } from '../log.js';
import {
  apiUrl,
  cloudApiErrorFrom,
  CloudApiError,
  CloudNetworkError,
  getJson,
  readSuccessEnvelope,
} from './transport.js';

/** Contract C-20: `GET {AGENT_API_BASE_URL}/agent/allowlist` (device-token auth). */
export const AGENT_ALLOWLIST_PATH = '/agent/allowlist';

/**
 * Response data `{protectedApps,userApps,version}`. Loose on purpose: the server may add fields
 * (forward compatible) but the three this flow depends on are required and validated.
 */
const agentAllowListDataSchema = z.looseObject({
  protectedApps: z.array(appEntrySchema).max(200).default([]),
  userApps: z.array(appEntrySchema).max(50).default([]),
  version: z.number().int().min(0).default(0),
});

export interface AgentAllowList {
  readonly protectedApps: readonly AppEntry[];
  readonly userApps: readonly AppEntry[];
  /** Server-side allow-list version; compared with `scheduleDue.allowListVersion` for the log. */
  readonly version: number;
}

/** Honest outcome: either a validated list, or a reason the scheduled start must not proceed. */
export type AllowListFetchResult =
  | { readonly ok: true; readonly allowList: AgentAllowList }
  | {
      readonly ok: false;
      /** Short, log-safe reason (never a raw response body, NFR-016). */
      readonly reason: string;
      readonly code?: ErrorCode;
      readonly status?: number;
    };

export interface FetchAgentAllowListOptions {
  /** Full API base including `/api/v1` (DEC-013). */
  readonly baseUrl: string;
  /** Device token, sent as `Authorization: Bearer …`; never logged. */
  readonly deviceToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly logger?: Logger;
}

/**
 * Fetches the allow-list once. Never throws: a network error, a non-2xx status and a body that
 * does not match the contract all become `ok: false` with a distinct reason, so the caller can
 * log exactly why a scheduled session did not start.
 */
export async function fetchAgentAllowList(
  options: FetchAgentAllowListOptions,
): Promise<AllowListFetchResult> {
  const logger = options.logger ?? noopLogger;

  try {
    const response = await getJson({
      url: apiUrl(options.baseUrl, AGENT_ALLOWLIST_PATH),
      headers: { Authorization: `Bearer ${options.deviceToken}` },
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });

    if (response.status < 200 || response.status >= 300) {
      const error = cloudApiErrorFrom(response, AGENT_ALLOWLIST_PATH);
      return {
        ok: false,
        reason: error.message,
        status: error.status,
        ...(error.code === undefined ? {} : { code: error.code }),
      };
    }

    const data = readSuccessEnvelope(response, AGENT_ALLOWLIST_PATH);
    const parsed = agentAllowListDataSchema.safeParse(data);
    if (!parsed.success) {
      return { ok: false, reason: 'the allow-list response did not match the contract' };
    }
    return {
      ok: true,
      allowList: {
        protectedApps: parsed.data.protectedApps,
        userApps: parsed.data.userApps,
        version: parsed.data.version,
      },
    };
  } catch (error) {
    if (error instanceof CloudNetworkError) {
      return { ok: false, reason: 'the cloud API could not be reached' };
    }
    if (error instanceof CloudApiError) {
      return {
        ok: false,
        reason: error.message,
        status: error.status,
        ...(error.code === undefined ? {} : { code: error.code }),
      };
    }
    // Last resort: never rethrow into the scheduler path (it must fail closed, not crash).
    logger.error('Unexpected allow-list fetch failure', error);
    return { ok: false, reason: 'unexpected allow-list fetch failure' };
  }
}
