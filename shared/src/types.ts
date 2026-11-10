// shared/src/types.ts — transport types that are not payload schemas: the REST envelopes (NFR-002),
// the paginated list shape (NFR-009) and the dashboard's aggregate agent status.
// Defined separately from protocol/schemas so the barrel stays free of duplicate export names.

import type { ErrorCode } from './errors.js';

/** One zod issue flattened for the UI (`details[]` in the API error envelope). */
export interface ValidationIssue {
  path: string;
  message: string;
}

/** NFR-002 success envelope: `{success, data, message?}`. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}

/** NFR-002 error envelope: `{success: false, error: {code, message, details?}}`. */
export interface ApiErrorBody {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: ValidationIssue[];
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiErrorBody;

/** NFR-009 list shape returned by every paginated endpoint. */
export interface Paginated<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** `DISCONNECTED` is a dashboard-only status; the agent itself never reports it. */
export type AgentConnectionStatus = 'DISCONNECTED' | 'IDLE' | 'PAIRED' | 'FOCUSING';
