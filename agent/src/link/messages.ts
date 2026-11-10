// link/messages.ts — builders for agent → dashboard frames, validated by the frozen schemas.
// Centralising construction keeps `link/server.ts` free of protocol literals and guarantees the
// agent can never send an extra field (which the strict schemas would reject). DEC-003: no
// builder here has access to the pairing code.

import {
  appsMessageSchema,
  authErrorMessageSchema,
  authOkMessageSchema,
  challengeMessageSchema,
  focusRejectedMessageSchema,
  helloMessageSchema,
  stateMessageSchema,
  type AgentCapabilities,
  type AgentState,
  type AppEntry,
  type AppsMessage,
  type AuthErrorMessage,
  type AuthOkMessage,
  type ChallengeMessage,
  type ErrorCode,
  type FocusRejectedCode,
  type FocusRejectedMessage,
  type HelloMessage,
  type OsName,
  type RunningApp,
  type SessionInfo,
  type StateMessage,
} from '@focus-mode/shared';

/** The subset of agent truth the link reports (INV-5). Never includes the pairing code. */
export interface LinkSnapshot {
  readonly state: AgentState;
  readonly paired: boolean;
  readonly session?: SessionInfo;
  readonly protected: readonly AppEntry[];
  readonly allowList: readonly AppEntry[];
}

export interface AgentIdentity {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly os: OsName;
  readonly capabilities: AgentCapabilities;
}

let messageCounter = 0;

/** Short correlation id, unique per process; the dashboard echoes it back. */
export function nextMessageId(prefix: 'a' | 'd' = 'a'): string {
  messageCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${messageCounter.toString(36)}`;
}

/** First frame after upgrade. `paired` lets the dashboard decide whether to wait for auth. */
export function buildHello(snapshot: LinkSnapshot, identity: AgentIdentity): HelloMessage {
  return helloMessageSchema.parse({
    v: 1,
    id: nextMessageId('a'),
    type: 'hello',
    agentId: identity.agentId,
    agentVersion: identity.agentVersion,
    os: identity.os,
    state: snapshot.state,
    paired: snapshot.paired,
    capabilities: identity.capabilities,
  });
}

/** Answer to `getState`; the only supported read in W1 (control messages need attestation). */
/** Single-use handshake step 2 (contract §4.4); only sent while the agent is paired. */
export function buildChallenge(nonce: string): ChallengeMessage {
  return challengeMessageSchema.parse({
    v: 1,
    id: nextMessageId('a'),
    type: 'challenge',
    nonce,
  });
}

/** Handshake success: no secret travels here, only the ids the attestation was bound to. */
export function buildAuthOk(deviceId: string, userId: string): AuthOkMessage {
  return authOkMessageSchema.parse({
    v: 1,
    id: nextMessageId('a'),
    type: 'authOk',
    deviceId,
    userId,
  });
}

/** Controlled rejection; used for unauthenticated control messages and unavailable features. */
export function buildFocusRejected(code: FocusRejectedCode, message: string): FocusRejectedMessage {
  return focusRejectedMessageSchema.parse({
    v: 1,
    id: nextMessageId('a'),
    type: 'focusRejected',
    code,
    message,
  });
}

/** REC-007 answer: key + label + running only, never window titles (INV-6). */
export function buildApps(apps: readonly RunningApp[]): AppsMessage {
  return appsMessageSchema.parse({
    v: 1,
    id: nextMessageId('a'),
    type: 'apps',
    apps,
  });
}

export function buildState(snapshot: LinkSnapshot): StateMessage {
  return stateMessageSchema.parse({
    v: 1,
    id: nextMessageId('a'),
    type: 'state',
    state: snapshot.state,
    ...(snapshot.session === undefined ? {} : { session: snapshot.session }),
    protected: snapshot.protected,
    allowList: snapshot.allowList,
  });
}

/** Fail-closed rejection; never carries a stack trace or OS internals (NFR-010). */
export function buildAuthError(code: ErrorCode, message: string): AuthErrorMessage {
  return authErrorMessageSchema.parse({
    v: 1,
    id: nextMessageId('a'),
    type: 'authError',
    code,
    message,
  });
}
