// shared/src/protocol.test.ts — contract tests for the frozen wire protocol (T-004).
// Covers: every message round-trips through its strict schema, the envelope, discriminated
// unions and type guards, direction/authentication tables, and the DEC-003/INV-3 guarantee that
// the 6-digit pairing code never appears in ANY local-channel message.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CLOUD_MESSAGE_DIRECTIONS,
  CLOUD_MESSAGE_TYPES,
  LOCAL_MESSAGE_DIRECTIONS,
  LOCAL_MESSAGE_TYPES,
  PROTOCOL_VERSION,
  UNAUTHENTICATED_INBOUND_TYPES,
  agentStateSchema,
  cloudMessageSchema,
  envelopeSchema,
  focusRejectedCodeSchema,
  isAgentState,
  isCloudMessage,
  isEnvelope,
  isLocalMessage,
  isProtocolMessage,
  localMessageSchema,
  type LocalMessageType,
} from './protocol.js';
import { ERROR_CODES } from './errors.js';

const DEVICE_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';
const SCHEDULE_ID = '507f1f77bcf86cd799439013';
const RUN_ID = '507f1f77bcf86cd799439014';
const SESSION_ID = '3f1c2b9e-6a4d-4c3a-9f2b-1a2b3c4d5e6f';
const CLIENT_SESSION_ID = SESSION_ID;
const AT = '2026-11-10T10:00:00.000Z';
const ENDS_AT = '2026-11-10T11:00:00.000Z';
const NONCE = 'abcdefghijklmnopqrstuvwxyz012345';
const CONSENT = { acceptedAt: AT, version: 'consent-v1' };
const CHROME = { key: 'chrome', label: 'Google Chrome', mac: ['com.google.Chrome'] };
const VSCODE = { key: 'vscode', label: 'Visual Studio Code', win: ['Code.exe'] };

interface Fixture {
  type: LocalMessageType;
  message: Record<string, unknown>;
}

const LOCAL_FIXTURES: readonly Fixture[] = [
  {
    type: 'hello',
    message: {
      v: PROTOCOL_VERSION,
      id: 'm-01',
      type: 'hello',
      agentId: 'agent-1',
      agentVersion: '1.4.0',
      os: 'macOS',
      state: 'PAIRED',
      paired: true,
      capabilities: { focus: 'full' },
    },
  },
  {
    type: 'challenge',
    message: { v: PROTOCOL_VERSION, id: 'm-02', type: 'challenge', nonce: NONCE },
  },
  {
    type: 'auth',
    message: {
      v: PROTOCOL_VERSION,
      id: 'm-03',
      type: 'auth',
      attestation: 'eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1c2VyIn0.signature',
    },
  },
  {
    type: 'authOk',
    message: {
      v: PROTOCOL_VERSION,
      id: 'm-04',
      type: 'authOk',
      deviceId: DEVICE_ID,
      userId: USER_ID,
    },
  },
  {
    type: 'authError',
    message: {
      v: PROTOCOL_VERSION,
      id: 'm-05',
      type: 'authError',
      code: ERROR_CODES.UNAUTHENTICATED,
      message: 'Attestation rejected',
    },
  },
  { type: 'paired', message: { v: PROTOCOL_VERSION, id: 'm-06', type: 'paired' } },
  { type: 'getState', message: { v: PROTOCOL_VERSION, id: 'm-07', type: 'getState' } },
  {
    type: 'state',
    message: {
      v: PROTOCOL_VERSION,
      id: 'm-08',
      type: 'state',
      state: 'PAIRED',
      protected: [CHROME],
      allowList: [VSCODE],
    },
  },
  { type: 'listApps', message: { v: PROTOCOL_VERSION, id: 'm-09', type: 'listApps' } },
  {
    type: 'apps',
    message: {
      v: PROTOCOL_VERSION,
      id: 'm-10',
      type: 'apps',
      apps: [{ key: 'vscode', label: 'Visual Studio Code', running: true }],
    },
  },
  {
    type: 'enterFocus',
    message: {
      v: PROTOCOL_VERSION,
      id: 'm-11',
      type: 'enterFocus',
      durationMin: 60,
      allowList: [VSCODE],
      reaside: true,
      consent: CONSENT,
      clientSessionId: CLIENT_SESSION_ID,
    },
  },
  {
    type: 'focusStarted',
    message: {
      v: PROTOCOL_VERSION,
      id: 'm-12',
      type: 'focusStarted',
      at: AT,
      endsAt: ENDS_AT,
      protected: [CHROME],
      state: 'FOCUSING',
      sessionId: CLIENT_SESSION_ID,
      source: 'MANUAL',
    },
  },
  {
    type: 'focusRejected',
    message: {
      v: PROTOCOL_VERSION,
      id: 'm-13',
      type: 'focusRejected',
      code: 'ALREADY_FOCUSING',
      message: 'A focus session is already running.',
    },
  },
  {
    type: 'exitFocus',
    message: { v: PROTOCOL_VERSION, id: 'm-14', type: 'exitFocus', sessionId: CLIENT_SESSION_ID },
  },
  {
    type: 'focusEnded',
    message: {
      v: PROTOCOL_VERSION,
      id: 'm-15',
      type: 'focusEnded',
      sessionId: CLIENT_SESSION_ID,
      at: ENDS_AT,
      reason: 'COMPLETED',
      actualMinutes: 60,
    },
  },
  {
    type: 'scheduleHeadsUp',
    message: {
      v: PROTOCOL_VERSION,
      id: 'm-16',
      type: 'scheduleHeadsUp',
      scheduleId: SCHEDULE_ID,
      startsAt: AT,
    },
  },
];

const CLOUD_FIXTURES: readonly { type: string; message: Record<string, unknown> }[] = [
  {
    type: 'heartbeat',
    message: {
      v: PROTOCOL_VERSION,
      id: 'c-01',
      type: 'heartbeat',
      state: 'PAIRED',
      sessionId: CLIENT_SESSION_ID,
    },
  },
  {
    type: 'session.started',
    message: {
      v: PROTOCOL_VERSION,
      id: 'c-02',
      type: 'session.started',
      clientSessionId: CLIENT_SESSION_ID,
      startedAt: AT,
      plannedMinutes: 60,
      source: 'MANUAL',
    },
  },
  {
    type: 'session.ended',
    message: {
      v: PROTOCOL_VERSION,
      id: 'c-03',
      type: 'session.ended',
      clientSessionId: CLIENT_SESSION_ID,
      endedAt: ENDS_AT,
      actualMinutes: 60,
      status: 'COMPLETED',
      endReason: 'COMPLETED',
    },
  },
  {
    type: 'scheduleDue',
    message: {
      v: PROTOCOL_VERSION,
      id: 'c-04',
      type: 'scheduleDue',
      runId: RUN_ID,
      scheduleId: SCHEDULE_ID,
      durationMin: 25,
      allowListVersion: 3,
    },
  },
  { type: 'revoked', message: { v: PROTOCOL_VERSION, id: 'c-05', type: 'revoked' } },
];

/** Collect every JSON-schema `properties` key and string `enum`/`const` value recursively. */
function scanJsonSchema(schema: unknown): {
  propertyNames: Set<string>;
  stringValues: Set<string>;
} {
  const propertyNames = new Set<string>();
  const stringValues = new Set<string>();
  const stack: unknown[] = [schema];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== 'object' || node === null) continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    const record = node as Record<string, unknown>;
    const properties = record['properties'];
    if (typeof properties === 'object' && properties !== null && !Array.isArray(properties)) {
      for (const [name, child] of Object.entries(properties)) {
        propertyNames.add(name);
        stack.push(child);
      }
    }
    for (const branchKey of ['oneOf', 'anyOf', 'allOf']) {
      const branches = record[branchKey];
      if (Array.isArray(branches)) {
        for (const branch of branches) stack.push(branch);
      }
    }
    const items = record['items'];
    if (items !== undefined) stack.push(items);
    const enumValues = record['enum'];
    if (Array.isArray(enumValues)) {
      for (const value of enumValues) if (typeof value === 'string') stringValues.add(value);
    }
    const constValue = record['const'];
    if (typeof constValue === 'string') stringValues.add(constValue);
    const additional = record['additionalProperties'];
    if (typeof additional === 'object' && additional !== null) stack.push(additional);
  }
  return { propertyNames, stringValues };
}

/** Collect every object key and string value in a JSON fixture recursively. */
function scanJsonValue(
  value: unknown,
  keys: Set<string> = new Set(),
  strings: Set<string> = new Set(),
): { keys: Set<string>; strings: Set<string> } {
  if (typeof value === 'string') {
    strings.add(value);
    return { keys, strings };
  }
  if (Array.isArray(value)) {
    for (const item of value) scanJsonValue(item, keys, strings);
    return { keys, strings };
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      scanJsonValue(child, keys, strings);
    }
  }
  return { keys, strings };
}

/** Every strict object schema in localMessageSchema must reject unknown fields. */
function findUnstrictObjects(schema: unknown): number {
  let unstrict = 0;
  const stack: unknown[] = [schema];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== 'object' || node === null) continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    const record = node as Record<string, unknown>;
    const properties = record['properties'];
    if (typeof properties === 'object' && properties !== null) {
      if (record['additionalProperties'] !== false) unstrict += 1;
      for (const child of Object.values(properties)) stack.push(child);
    }
    for (const branchKey of ['oneOf', 'anyOf']) {
      const branches = record[branchKey];
      if (Array.isArray(branches)) for (const branch of branches) stack.push(branch);
    }
    if (record['items'] !== undefined) stack.push(record['items']);
  }
  return unstrict;
}

describe('envelope', () => {
  it('accepts the v:1 + id envelope', () => {
    expect(isEnvelope({ v: PROTOCOL_VERSION, id: 'm-1' })).toBe(true);
  });

  it('rejects a wrong or missing version', () => {
    expect(envelopeSchema.safeParse({ v: 2, id: 'm-1' }).success).toBe(false);
    expect(envelopeSchema.safeParse({ id: 'm-1' }).success).toBe(false);
  });

  it('rejects an empty, oversized or missing id and unknown envelope fields', () => {
    expect(envelopeSchema.safeParse({ v: 1, id: '' }).success).toBe(false);
    expect(envelopeSchema.safeParse({ v: 1, id: 'x'.repeat(65) }).success).toBe(false);
    expect(envelopeSchema.safeParse({ v: 1 }).success).toBe(false);
    expect(envelopeSchema.safeParse({ v: 1, id: 'm-1', extra: true }).success).toBe(false);
  });
});

describe('local channel messages', () => {
  it('covers all 16 documented message types exactly once', () => {
    expect(LOCAL_MESSAGE_TYPES).toHaveLength(16);
    expect(new Set(LOCAL_MESSAGE_TYPES).size).toBe(16);
    expect(new Set(LOCAL_FIXTURES.map((fixture) => fixture.type))).toEqual(
      new Set(LOCAL_MESSAGE_TYPES),
    );
  });

  it.each(LOCAL_FIXTURES.map((fixture) => [fixture.type, fixture.message] as const))(
    'round-trips the %s message',
    (type, message) => {
      const result = localMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.type).toBe(type);
      expect(result.data.v).toBe(PROTOCOL_VERSION);
      expect(typeof result.data.id).toBe('string');
      expect(result.data).toEqual(message);
      expect(isLocalMessage(message)).toBe(true);
      expect(isProtocolMessage(message)).toBe(true);
      expect(isCloudMessage(message)).toBe(false);
    },
  );

  it.each(LOCAL_FIXTURES.map((fixture) => [fixture.type, fixture.message] as const))(
    'rejects unknown fields on the %s message (NFR-013)',
    (fixtureType, message) => {
      expect(message['type']).toBe(fixtureType);
      expect(localMessageSchema.safeParse({ ...message, unexpected: 1 }).success).toBe(false);
      expect(localMessageSchema.safeParse({ ...message, v: 2 }).success).toBe(false);
    },
  );

  it('rejects an unknown message type and non-objects', () => {
    expect(localMessageSchema.safeParse({ v: 1, id: 'x', type: 'not-a-message' }).success).toBe(
      false,
    );
    for (const value of [null, undefined, 42, 'hello', []]) {
      expect(isLocalMessage(value)).toBe(false);
      expect(isProtocolMessage(value)).toBe(false);
    }
  });

  it('each type has exactly one direction and every type is covered', () => {
    expect(Object.keys(LOCAL_MESSAGE_DIRECTIONS)).toHaveLength(LOCAL_MESSAGE_TYPES.length);
    const agentToDashboard = LOCAL_MESSAGE_TYPES.filter(
      (type) => LOCAL_MESSAGE_DIRECTIONS[type] === 'AGENT_TO_DASHBOARD',
    );
    const dashboardToAgent = LOCAL_MESSAGE_TYPES.filter(
      (type) => LOCAL_MESSAGE_DIRECTIONS[type] === 'DASHBOARD_TO_AGENT',
    );
    expect(agentToDashboard).toHaveLength(10);
    expect(dashboardToAgent).toHaveLength(6);
    expect([...agentToDashboard, ...dashboardToAgent]).toHaveLength(LOCAL_MESSAGE_TYPES.length);
  });

  it('pre-auth inbound allow-list is exactly auth/getState/paired (NFR-010)', () => {
    expect([...UNAUTHENTICATED_INBOUND_TYPES].sort()).toEqual(['auth', 'getState', 'paired']);
    for (const type of UNAUTHENTICATED_INBOUND_TYPES) {
      expect(LOCAL_MESSAGE_DIRECTIONS[type]).toBe('DASHBOARD_TO_AGENT');
    }
    expect(UNAUTHENTICATED_INBOUND_TYPES).not.toContain('enterFocus');
  });

  it('focusRejected accepts only the documented codes', () => {
    const allowed = [
      'ALREADY_FOCUSING',
      'UNAUTHENTICATED',
      'NOT_PAIRED',
      'CONSENT_REQUIRED',
      'UNSUPPORTED',
      'INVALID',
    ];
    for (const code of allowed) {
      expect(focusRejectedCodeSchema.safeParse(code).success).toBe(true);
    }
    expect(focusRejectedCodeSchema.safeParse('INTERNAL').success).toBe(false);
    expect(focusRejectedCodeSchema.safeParse('').success).toBe(false);
  });

  it('focusEnded accepts every documented reason', () => {
    const reasons = ['COMPLETED', 'USER', 'AGENT', 'SLEEP', 'CRASH_RECOVERY', 'UNPAIRED', 'QUIT'];
    for (const reason of reasons) {
      const message = {
        ...(LOCAL_FIXTURES.find((fixture) => fixture.type === 'focusEnded')?.message ?? {}),
        reason,
      };
      expect(localMessageSchema.safeParse(message).success).toBe(true);
    }
  });

  it('caps focus duration and allow-list size', () => {
    const base = LOCAL_FIXTURES.find((fixture) => fixture.type === 'enterFocus')?.message ?? {};
    expect(localMessageSchema.safeParse({ ...base, durationMin: 0 }).success).toBe(false);
    expect(localMessageSchema.safeParse({ ...base, durationMin: 481 }).success).toBe(false);
    expect(
      localMessageSchema.safeParse({ ...base, allowList: Array.from({ length: 51 }, () => VSCODE) })
        .success,
    ).toBe(false);
  });

  it('rejects a malformed app entry inside state/allowList (strict nested objects)', () => {
    const base = LOCAL_FIXTURES.find((fixture) => fixture.type === 'state')?.message ?? {};
    expect(
      localMessageSchema.safeParse({
        ...base,
        allowList: [{ key: 'Not A Key', label: 'Bad', win: ['x.exe'] }],
      }).success,
    ).toBe(false);
    expect(
      localMessageSchema.safeParse({
        ...base,
        allowList: [{ key: 'vscode', label: 'VS Code', win: ['Code.exe'], extra: true }],
      }).success,
    ).toBe(false);
  });

  it('rejects a malformed capabilities object', () => {
    const hello = LOCAL_FIXTURES.find((fixture) => fixture.type === 'hello')?.message ?? {};
    expect(
      localMessageSchema.safeParse({ ...hello, capabilities: { focus: 'none' } }).success,
    ).toBe(false);
    expect(
      localMessageSchema.safeParse({
        ...hello,
        capabilities: { focus: 'unsupported', reasons: ['Wayland session'] },
      }).success,
    ).toBe(true);
  });

  it('agent state accepts IDLE/PAIRED/FOCUSING only', () => {
    for (const state of ['IDLE', 'PAIRED', 'FOCUSING']) {
      expect(isAgentState(state)).toBe(true);
      expect(agentStateSchema.safeParse(state).success).toBe(true);
    }
    expect(isAgentState('DISCONNECTED')).toBe(false);
  });
});

describe('cloud channel messages', () => {
  it('covers all 5 documented message types exactly once', () => {
    expect(CLOUD_MESSAGE_TYPES).toHaveLength(5);
    expect(new Set(CLOUD_MESSAGE_TYPES).size).toBe(5);
    expect(new Set(CLOUD_FIXTURES.map((fixture) => fixture.type))).toEqual(
      new Set(CLOUD_MESSAGE_TYPES),
    );
  });

  it.each(CLOUD_FIXTURES.map((fixture) => [fixture.type, fixture.message] as const))(
    'round-trips the %s message',
    (type, message) => {
      const result = cloudMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.type).toBe(type);
      expect(result.data).toEqual(message);
      expect(isCloudMessage(message)).toBe(true);
      expect(isProtocolMessage(message)).toBe(true);
      expect(isLocalMessage(message)).toBe(false);
    },
  );

  it.each(CLOUD_FIXTURES.map((fixture) => [fixture.type, fixture.message] as const))(
    'rejects unknown fields on the %s message',
    (fixtureType, message) => {
      expect(message['type']).toBe(fixtureType);
      expect(cloudMessageSchema.safeParse({ ...message, unexpected: 1 }).success).toBe(false);
    },
  );

  it('keeps INV-2: the cloud may only send scheduleDue and revoked', () => {
    const cloudToAgent = CLOUD_MESSAGE_TYPES.filter(
      (type) => CLOUD_MESSAGE_DIRECTIONS[type] === 'CLOUD_TO_AGENT',
    );
    expect([...cloudToAgent].sort()).toEqual(['revoked', 'scheduleDue']);
    expect(Object.keys(CLOUD_MESSAGE_DIRECTIONS)).toHaveLength(CLOUD_MESSAGE_TYPES.length);
    expect(CLOUD_MESSAGE_DIRECTIONS.heartbeat).toBe('AGENT_TO_CLOUD');
    expect(CLOUD_MESSAGE_DIRECTIONS['session.started']).toBe('AGENT_TO_CLOUD');
    expect(CLOUD_MESSAGE_DIRECTIONS['session.ended']).toBe('AGENT_TO_CLOUD');
  });

  it('does not accept local messages or bad payloads on the cloud channel', () => {
    const local = LOCAL_FIXTURES.find((fixture) => fixture.type === 'enterFocus')?.message ?? {};
    expect(cloudMessageSchema.safeParse(local).success).toBe(false);
    const due = CLOUD_FIXTURES.find((fixture) => fixture.type === 'scheduleDue')?.message ?? {};
    expect(cloudMessageSchema.safeParse({ ...due, runId: 'not-an-object-id' }).success).toBe(false);
    const ended = CLOUD_FIXTURES.find((fixture) => fixture.type === 'session.ended')?.message ?? {};
    expect(cloudMessageSchema.safeParse({ ...ended, status: 'ACTIVE' }).success).toBe(false);
    expect(cloudMessageSchema.safeParse({ ...ended, clientSessionId: 'not-a-uuid' }).success).toBe(
      false,
    );
  });
});

describe('DEC-003 / INV-3 — the pairing code never crosses the local channel', () => {
  const jsonSchema = z.toJSONSchema(localMessageSchema, { io: 'input' });
  const scan = scanJsonSchema(jsonSchema);

  it('has no local-channel property that could carry a pairing code', () => {
    for (const name of scan.propertyNames) {
      expect(name).not.toMatch(/pairing/i);
      expect(name).not.toMatch(/pairToken/i);
      expect(name).not.toMatch(/codeHmac|enrollSecret|pairCode/i);
    }
  });

  it('has no 6-digit string enum/const anywhere in the local schema', () => {
    for (const value of scan.stringValues) {
      expect(value).not.toMatch(/^\d{6}$/);
    }
  });

  it('every local message object is strict, so a `pairingCode` field is rejected', () => {
    expect(findUnstrictObjects(jsonSchema)).toBe(0);
    for (const fixture of LOCAL_FIXTURES) {
      const injected = { ...fixture.message, pairingCode: '123456' };
      expect(localMessageSchema.safeParse(injected).success).toBe(false);
    }
  });

  it('no valid local fixture contains a 6-digit string or a pairing-shaped key', () => {
    for (const fixture of LOCAL_FIXTURES) {
      const { keys, strings } = scanJsonValue(fixture.message);
      for (const key of keys) {
        expect(key).not.toMatch(/pairing|pairToken|codeHmac|enrollSecret/i);
      }
      for (const value of strings) {
        expect(value).not.toMatch(/^\d{6}$/);
      }
    }
  });

  it('documents where the code may live: cloud schemas only (device pair/register)', () => {
    // The capability list above is local-channel-only; the no-code rule must not hide the fact
    // that the cloud contract DOES carry the code (typed by the user) and its HMAC (agent).
    expect(scan.propertyNames.has('pairingCode')).toBe(false);
    expect(ERROR_CODES.INVALID_PAIRING_CODE).toBe('INVALID_PAIRING_CODE');
  });
});
