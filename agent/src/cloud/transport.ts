// cloud/transport.ts — the Focus Agent's typed HTTP transport for cloud calls (T-042).
// `AGENT_API_BASE_URL` is the FULL base including `/api/v1` (DEC-013), so callers pass only the
// endpoint path and no module hard-codes the prefix. Responses are parsed as JSON and unwrapped
// from the frozen `{success,data}` envelope; network/timeout failures throw a retryable
// CloudNetworkError while HTTP failures keep the shared ErrorCode, never a raw body (NFR-002).

import { errorCodeSchema, type ErrorCode } from '@focus-mode/shared';
import { z } from 'zod';

/** Request timeout for a single cloud call; polling retries on expiry. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** The cloud could not be reached (DNS/TLS/timeout/aborted) — callers retry with backoff. */
export class CloudNetworkError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'CloudNetworkError';
    if (cause !== undefined) this.cause = cause;
  }
}

/** A cloud response with a non-2xx status; `code` is the shared error vocabulary when present. */
export class CloudApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;

  constructor(status: number, code: ErrorCode | undefined, message: string) {
    super(message);
    this.name = 'CloudApiError';
    this.status = status;
    this.code = code;
  }
}

export interface CloudHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

/** Joins the validated full base URL with an endpoint path from the frozen contract (§3). */
export function apiUrl(baseUrl: string, path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(`Cloud endpoint paths must start with "/" (got "${path}")`);
  }
  return `${baseUrl}${path}`;
}

/**
 * Derives `wss://<host>/<base>/agent-link` from `AGENT_API_BASE_URL` (contract §5.1): https → wss
 * for deployed APIs, http → ws for local development only.
 */
export function agentLinkUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/agent-link`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** Success envelope per contract §1.4; extra fields are tolerated on the response side. */
const successEnvelopeSchema = z.looseObject({
  success: z.literal(true),
  data: z.unknown(),
});

/** Error envelope per contract §1.4; `details` and other server extras are ignored. */
const errorEnvelopeSchema = z.looseObject({
  success: z.literal(false),
  error: z.looseObject({
    code: errorCodeSchema,
    message: z.string().optional(),
  }),
});

export interface CloudRequestOptions {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly body?: unknown;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Extra headers (the WS upgrade uses `Authorization`, REST here needs none). */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Performs one JSON request. Never throws for an HTTP status — the caller classifies it — and
 * throws `CloudNetworkError` when no response arrives, so a status can never be confused with a
 * transport failure. Redirects are refused: the API contract has none and following one could
 * send the body (an enroll secret) to an unexpected host.
 */
export async function requestJson(options: CloudRequestOptions): Promise<CloudHttpResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  try {
    const response = await fetchImpl(options.url, {
      method: options.method,
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      redirect: 'error',
      signal: abort.signal,
    });

    const text = await response.text();
    let body: unknown;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
    }
    return { status: response.status, body };
  } catch (error) {
    throw new CloudNetworkError('The cloud API could not be reached', error);
  } finally {
    clearTimeout(timer);
  }
}

export function postJson(options: Omit<CloudRequestOptions, 'method'>): Promise<CloudHttpResponse> {
  return requestJson({ ...options, method: 'POST' });
}

export function getJson(options: Omit<CloudRequestOptions, 'method'>): Promise<CloudHttpResponse> {
  return requestJson({ ...options, method: 'GET' });
}

/** Builds the typed error for a non-2xx response (contract §1.4 / §1.5). */
export function cloudApiErrorFrom(response: CloudHttpResponse, endpoint: string): CloudApiError {
  const parsed = errorEnvelopeSchema.safeParse(response.body);
  const code = parsed.success ? parsed.data.error.code : undefined;
  const message =
    parsed.success && parsed.data.error.message !== undefined
      ? parsed.data.error.message
      : `${endpoint} failed with HTTP ${response.status}`;
  return new CloudApiError(response.status, code, message);
}

/**
 * Requires a 2xx response and returns the `data` value of the success envelope. The caller then
 * validates `data` with its own strict schema (response schemas are contract §C-04 follow-up).
 */
export function readSuccessEnvelope(response: CloudHttpResponse, endpoint: string): unknown {
  if (response.status < 200 || response.status >= 300) {
    throw cloudApiErrorFrom(response, endpoint);
  }
  const parsed = successEnvelopeSchema.safeParse(response.body);
  if (!parsed.success) {
    throw new CloudApiError(
      response.status,
      undefined,
      `${endpoint} returned an unexpected response envelope`,
    );
  }
  return parsed.data.data;
}
