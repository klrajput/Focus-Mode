// link/messages.ts — builders for agent → dashboard frames, validated by the frozen schemas.
// Centralising construction keeps `link/server.ts` free of protocol literals and guarantees the
// agent can never send an extra field (which the strict schemas would reject). DEC-003: no
// builder here has access to the pairing code.

import {
  authErrorMessageSchema,
  helloMessageSchema,
  stateMessageSchema,
  type AgentCapabilities,
  type AgentState,
  type AppEntry,
  type AuthErrorMessage,
  type ErrorCode,
  type HelloMessage,
  type OsName,
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
