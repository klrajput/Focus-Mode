// shared/src/protocol.ts — the frozen wire protocol for BOTH channels of the Focus Agent
// (TECHNICAL_DESIGN §6). Local channel: dashboard ↔ Focus Agent over ws://127.0.0.1:4545/link.
// Cloud channel: Focus Agent ↔ API over wss://…/agent-link. Every message carries the envelope
// `{v: 1, id}` plus a `type` discriminator and is strict, so unknown fields are rejected.
// DEC-003/INV-3: the 6-digit pairing code never appears in any local-channel message — the local
// agent UI is the only place it is shown (asserted by the schema-key scan in protocol.test.ts).

import { z } from 'zod';
import { errorCodeSchema } from './errors.js';
import { appEntrySchema, appKeySchema } from './schemas/app.js';
import {
  actualMinutesSchema,
  agentVersionSchema,
  durationMinSchema,
  endReasonSchema,
  focusSourceSchema,
  isoDateTimeSchema,
  nonceSchema,
  objectIdSchema,
  osSchema,
  terminalSessionStatusSchema,
  uuidSchema,
} from './schemas/common.js';

/** Wire version of both channels. Bump only with an ADR + contracts update (AGENTS §5). */
export const PROTOCOL_VERSION = 1;

/** Correlation id generated per message by the sender; echoed by the responder. */
const messageIdSchema = z.string().min(1).max(64);

/** Envelope rule for every protocol message, usable on its own for logging/validation. */
export const envelopeSchema = z.strictObject({
  v: z.literal(PROTOCOL_VERSION),
  id: messageIdSchema,
});
export type Envelope = z.infer<typeof envelopeSchema>;

const ENVELOPE_SHAPE = { v: z.literal(PROTOCOL_VERSION), id: messageIdSchema } as const;

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/** Focus Agent state machine (TECHNICAL_DESIGN §7.2). */
export const agentStateSchema = z.enum(['IDLE', 'PAIRED', 'FOCUSING']);
export type AgentState = z.infer<typeof agentStateSchema>;

/** Honest capability flag — `unsupported` blocks Start on the dashboard (FR-005, DEC §7.5). */
export const focusCapabilitySchema = z.enum(['full', 'partial', 'unsupported']);
export type FocusCapability = z.infer<typeof focusCapabilitySchema>;

export const agentCapabilitiesSchema = z.strictObject({
  focus: focusCapabilitySchema,
  reasons: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
});
export type AgentCapabilities = z.infer<typeof agentCapabilitiesSchema>;

/** Active-session snapshot inside a `state` message (source of dashboard countdown truth). */
export const sessionInfoSchema = z.strictObject({
  sessionId: uuidSchema,
  startedAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  plannedMinutes: durationMinSchema,
  source: focusSourceSchema,
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;

/** Local-only rejection codes for `focusRejected` (TECHNICAL_DESIGN §6.2). */
export const focusRejectedCodeSchema = z.enum([
  'ALREADY_FOCUSING',
  'UNAUTHENTICATED',
  'NOT_PAIRED',
  'CONSENT_REQUIRED',
  'UNSUPPORTED',
  'INVALID',
]);
export type FocusRejectedCode = z.infer<typeof focusRejectedCodeSchema>;

/** REC-007 — `listApps` returns key/label/running only, never window titles (INV-6). */
export const runningAppSchema = z.strictObject({
  key: appKeySchema,
  label: z.string().trim().min(1).max(60),
  running: z.boolean(),
});
export type RunningApp = z.infer<typeof runningAppSchema>;

/** Consent record carried by `enterFocus` (FR-009); the agent still shows its native dialog first. */
export const consentSchema = z.strictObject({
  acceptedAt: isoDateTimeSchema,
  version: z.string().trim().min(1).max(32),
});
export type Consent = z.infer<typeof consentSchema>;

// ---------------------------------------------------------------------------
// Local channel — agent → dashboard
// ---------------------------------------------------------------------------

/** `hello` is the first frame after upgrade; unpaired agents report `state: 'IDLE'`. */
export const helloMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('hello'),
  agentId: z.string().min(1).max(100),
  agentVersion: agentVersionSchema,
  os: osSchema,
  state: agentStateSchema,
  paired: z.boolean(),
  capabilities: agentCapabilitiesSchema,
});
export type HelloMessage = z.infer<typeof helloMessageSchema>;

/** Only sent when paired; the dashboard turns the nonce into an attestation request. */
export const challengeMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('challenge'),
  nonce: nonceSchema,
});
export type ChallengeMessage = z.infer<typeof challengeMessageSchema>;

/** authOk proves the attestation was accepted (REC-003); no secrets travel here. */
export const authOkMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('authOk'),
  deviceId: objectIdSchema,
  userId: objectIdSchema,
});
export type AuthOkMessage = z.infer<typeof authOkMessageSchema>;

export const authErrorMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('authError'),
  code: errorCodeSchema,
  message: z.string().trim().min(1).max(300),
});
export type AuthErrorMessage = z.infer<typeof authErrorMessageSchema>;

/** Agent truth: state plus the optional active session, protected set and user allow-list. */
export const stateMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('state'),
  state: agentStateSchema,
  session: sessionInfoSchema.optional(),
  protected: z.array(appEntrySchema).max(200),
  allowList: z.array(appEntrySchema).max(50),
});
export type StateMessage = z.infer<typeof stateMessageSchema>;

export const appsMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('apps'),
  apps: z.array(runningAppSchema).max(300),
});
export type AppsMessage = z.infer<typeof appsMessageSchema>;

/** Emitted only after journal-first apply succeeded (INV-4); `sessionId` is the clientSessionId. */
export const focusStartedMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('focusStarted'),
  at: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  protected: z.array(appEntrySchema).max(200),
  state: z.literal('FOCUSING'),
  sessionId: uuidSchema,
  source: focusSourceSchema,
});
export type FocusStartedMessage = z.infer<typeof focusStartedMessageSchema>;

/** The dashboard's request failed safely — the agent has restored / never applied focus. */
export const focusRejectedMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('focusRejected'),
  code: focusRejectedCodeSchema,
  message: z.string().trim().min(1).max(300),
});
export type FocusRejectedMessage = z.infer<typeof focusRejectedMessageSchema>;

/** Emitted on every end trigger (dashboard, tray, timer, sleep, crash recovery, unpair, quit). */
export const focusEndedMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('focusEnded'),
  sessionId: uuidSchema,
  at: isoDateTimeSchema,
  reason: endReasonSchema,
  actualMinutes: actualMinutesSchema,
});
export type FocusEndedMessage = z.infer<typeof focusEndedMessageSchema>;

/** Purely informational +10 s heads-up before a scheduled session (FR-012). */
export const scheduleHeadsUpMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('scheduleHeadsUp'),
  scheduleId: objectIdSchema,
  startsAt: isoDateTimeSchema,
});
export type ScheduleHeadsUpMessage = z.infer<typeof scheduleHeadsUpMessageSchema>;

// ---------------------------------------------------------------------------
// Local channel — dashboard → agent
// ---------------------------------------------------------------------------

/** Message 3 of the handshake: the dashboard's cloud-signed attestation for this nonce. */
export const authMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('auth'),
  attestation: z.string().min(20).max(4096),
});
export type AuthMessage = z.infer<typeof authMessageSchema>;

/** Nudge only — a forged `paired` can at worst make the agent poll (TECHNICAL_DESIGN §5.1). */
export const pairedMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('paired'),
});
export type PairedMessage = z.infer<typeof pairedMessageSchema>;

export const getStateMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('getState'),
});
export type GetStateMessage = z.infer<typeof getStateMessageSchema>;

export const listAppsMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('listApps'),
});
export type ListAppsMessage = z.infer<typeof listAppsMessageSchema>;

/** Control message: only valid on an attested socket (SEC-7, REC-003). */
export const enterFocusMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('enterFocus'),
  durationMin: durationMinSchema,
  allowList: z.array(appEntrySchema).max(50),
  reaside: z.boolean().optional(),
  consent: consentSchema,
  clientSessionId: uuidSchema,
});
export type EnterFocusMessage = z.infer<typeof enterFocusMessageSchema>;

export const exitFocusMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('exitFocus'),
  sessionId: uuidSchema.optional(),
});
export type ExitFocusMessage = z.infer<typeof exitFocusMessageSchema>;

// ---------------------------------------------------------------------------
// Cloud channel (TECHNICAL_DESIGN §6.3, REC-001): INV-2 forbids anything else cloud → agent.
// ---------------------------------------------------------------------------

/** Agent → cloud presence ping every 15 s; the server marks the device DISCONNECTED after 45 s. */
export const heartbeatMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('heartbeat'),
  state: agentStateSchema,
  sessionId: uuidSchema.optional(),
});
export type HeartbeatMessage = z.infer<typeof heartbeatMessageSchema>;

/** Agent → cloud session report; idempotent on `clientSessionId` (REC-006). */
export const sessionStartedMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('session.started'),
  clientSessionId: uuidSchema,
  startedAt: isoDateTimeSchema,
  plannedMinutes: durationMinSchema,
  source: focusSourceSchema,
});
export type SessionStartedMessage = z.infer<typeof sessionStartedMessageSchema>;

/** Agent → cloud finalisation; a repeated report with the same body is a no-op (REC-006). */
export const sessionEndedMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('session.ended'),
  clientSessionId: uuidSchema,
  endedAt: isoDateTimeSchema,
  actualMinutes: actualMinutesSchema,
  status: terminalSessionStatusSchema,
  endReason: endReasonSchema,
});
export type SessionEndedMessage = z.infer<typeof sessionEndedMessageSchema>;

/** Cloud → agent: the only way focus can start without a dashboard (INV-2, FR-012). */
export const scheduleDueMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('scheduleDue'),
  runId: objectIdSchema,
  scheduleId: objectIdSchema,
  durationMin: durationMinSchema,
  allowListVersion: z.number().int().min(0),
});
export type ScheduleDueMessage = z.infer<typeof scheduleDueMessageSchema>;

/** Cloud → agent: device token revoked; the agent restores if needed, then returns to IDLE. */
export const revokedMessageSchema = z.strictObject({
  ...ENVELOPE_SHAPE,
  type: z.literal('revoked'),
});
export type RevokedMessage = z.infer<typeof revokedMessageSchema>;

// ---------------------------------------------------------------------------
// Discriminated unions + runtime metadata
// ---------------------------------------------------------------------------

export const localMessageSchema = z.discriminatedUnion('type', [
  helloMessageSchema,
  challengeMessageSchema,
  authMessageSchema,
  authOkMessageSchema,
  authErrorMessageSchema,
  pairedMessageSchema,
  getStateMessageSchema,
  stateMessageSchema,
  listAppsMessageSchema,
  appsMessageSchema,
  enterFocusMessageSchema,
  focusStartedMessageSchema,
  focusRejectedMessageSchema,
  exitFocusMessageSchema,
  focusEndedMessageSchema,
  scheduleHeadsUpMessageSchema,
]);
export type LocalMessage = z.infer<typeof localMessageSchema>;
export type LocalMessageType = LocalMessage['type'];
export type LocalMessageDirection = 'AGENT_TO_DASHBOARD' | 'DASHBOARD_TO_AGENT';

/** Runtime list derived from the union so it can never omit a message. */
export const LOCAL_MESSAGE_TYPES: readonly LocalMessageType[] = Object.freeze(
  localMessageSchema.options.map((option) => option.shape.type.value),
);

/** Direction table — the agent and tests use it to reject frames sent the wrong way (NFR-010). */
export const LOCAL_MESSAGE_DIRECTIONS: Readonly<Record<LocalMessageType, LocalMessageDirection>> =
  Object.freeze({
    hello: 'AGENT_TO_DASHBOARD',
    challenge: 'AGENT_TO_DASHBOARD',
    auth: 'DASHBOARD_TO_AGENT',
    authOk: 'AGENT_TO_DASHBOARD',
    authError: 'AGENT_TO_DASHBOARD',
    paired: 'DASHBOARD_TO_AGENT',
    getState: 'DASHBOARD_TO_AGENT',
    state: 'AGENT_TO_DASHBOARD',
    listApps: 'DASHBOARD_TO_AGENT',
    apps: 'AGENT_TO_DASHBOARD',
    enterFocus: 'DASHBOARD_TO_AGENT',
    focusStarted: 'AGENT_TO_DASHBOARD',
    focusRejected: 'AGENT_TO_DASHBOARD',
    exitFocus: 'DASHBOARD_TO_AGENT',
    focusEnded: 'AGENT_TO_DASHBOARD',
    scheduleHeadsUp: 'AGENT_TO_DASHBOARD',
  });

/** NFR-010: before `authOk`, the agent accepts only these inbound local messages. */
export const UNAUTHENTICATED_INBOUND_TYPES: readonly LocalMessageType[] = Object.freeze([
  'auth',
  'getState',
  'paired',
]);

export const cloudMessageSchema = z.discriminatedUnion('type', [
  heartbeatMessageSchema,
  sessionStartedMessageSchema,
  sessionEndedMessageSchema,
  scheduleDueMessageSchema,
  revokedMessageSchema,
]);
export type CloudMessage = z.infer<typeof cloudMessageSchema>;
export type CloudMessageType = CloudMessage['type'];
export type CloudMessageDirection = 'AGENT_TO_CLOUD' | 'CLOUD_TO_AGENT';

export const CLOUD_MESSAGE_TYPES: readonly CloudMessageType[] = Object.freeze(
  cloudMessageSchema.options.map((option) => option.shape.type.value),
);

export const CLOUD_MESSAGE_DIRECTIONS: Readonly<Record<CloudMessageType, CloudMessageDirection>> =
  Object.freeze({
    heartbeat: 'AGENT_TO_CLOUD',
    'session.started': 'AGENT_TO_CLOUD',
    'session.ended': 'AGENT_TO_CLOUD',
    scheduleDue: 'CLOUD_TO_AGENT',
    revoked: 'CLOUD_TO_AGENT',
  });

export type ProtocolMessage = LocalMessage | CloudMessage;

// ---------------------------------------------------------------------------
// Type guards (runtime validation, never `as` casts)
// ---------------------------------------------------------------------------

export function isEnvelope(value: unknown): value is Envelope {
  return envelopeSchema.safeParse(value).success;
}

export function isLocalMessage(value: unknown): value is LocalMessage {
  return localMessageSchema.safeParse(value).success;
}

export function isCloudMessage(value: unknown): value is CloudMessage {
  return cloudMessageSchema.safeParse(value).success;
}

export function isProtocolMessage(value: unknown): value is ProtocolMessage {
  return isLocalMessage(value) || isCloudMessage(value);
}

export function isAgentState(value: unknown): value is AgentState {
  return agentStateSchema.safeParse(value).success;
}
