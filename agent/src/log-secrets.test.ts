// log-secrets.test.ts — proof that secrets never reach the agent log (SEC-6/SEC-7/DEC-003, T-080).
// Two layers: a source scan that fails when a `logger.*` call could receive a pairing code, device
// token, enroll secret or attestation value; and real runtime flows (link handshake, attestation
// gate) whose recording logger is asserted to contain none of those secrets. Titles/URLs are
// covered by the INV-6 scans in `hardening.test.ts`.
//
// A grep-level tripwire is deliberately cheap and blunt: it runs on every `npm test -w
// @focus-mode/agent` and fails the build before a secret can be shipped to a log file.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { AttestationGate } from './link/attestation.js';
import { LINK_PATH, LinkServer, type LinkServerOptions } from './link/server.js';
import type { Logger } from './log.js';
import { pairCodeLogLabel } from './pairing.js';

const SRC_DIR = fileURLToPath(new URL('.', import.meta.url));

function read(relativePath: string): string {
  return readFileSync(path.join(SRC_DIR, relativePath), 'utf8');
}

function sourceFiles(): readonly string[] {
  return readdirSync(SRC_DIR, { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.cts'))
    .filter((entry) => !entry.endsWith('.test.ts'))
    .sort();
}

interface RecordingLogger extends Logger {
  readonly records: string[];
}

function recordingLogger(): RecordingLogger {
  const records: string[] = [];
  const push =
    (level: string) =>
    (message: string, ...meta: readonly unknown[]): void => {
      const serialized = meta
        .map((value) => {
          if (value instanceof Error) return value.message;
          if (typeof value === 'string') return value;
          try {
            return JSON.stringify(value);
          } catch {
            return '[unserialisable]';
          }
        })
        .join(' ');
      records.push(`${level} ${message} ${serialized}`);
    };
  return {
    records,
    error: push('error'),
    warn: push('warn'),
    info: push('info'),
    debug: push('debug'),
  };
}

const ORIGIN = 'http://localhost:5173';
const DEVICE_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439012';
const SECRET_TOKEN = 'attestation-token-that-must-never-be-logged';
const SECRET_NONCE = 'nonce-that-must-never-be-logged';

const servers: LinkServer[] = [];
const sockets: WebSocket[] = [];

async function startLink(
  logger: Logger,
  overrides: Partial<LinkServerOptions> = {},
): Promise<{
  server: LinkServer;
  port: number;
}> {
  const server = new LinkServer({
    port: 0,
    allowedOrigins: [ORIGIN],
    identity: {
      agentId: 'agent-log-test',
      agentVersion: '1.0.0',
      os: 'macOS',
      capabilities: { focus: 'full' },
    },
    getSnapshot: () => ({ state: 'PAIRED', paired: true, protected: [], allowList: [] }),
    getPairing: () => ({ deviceId: DEVICE_ID, userId: USER_ID }),
    verifyAttestation: async () => ({
      ok: true,
      deviceId: DEVICE_ID,
      userId: USER_ID,
      expiresAt: new Date(),
    }),
    logger,
    ...overrides,
  });
  const address = await server.start();
  servers.push(server);
  return { server, port: address.port };
}

function connect(port: number): Promise<{ socket: WebSocket; next: () => Promise<unknown> }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${LINK_PATH}`, ['focus.v1'], {
    origin: ORIGIN,
  });
  sockets.push(socket);
  const queue: unknown[] = [];
  const waiters: Array<(message: unknown) => void> = [];
  socket.on('message', (data) => {
    const message: unknown = JSON.parse(data.toString());
    const waiter = waiters.shift();
    if (waiter !== undefined) waiter(message);
    else queue.push(message);
  });
  return new Promise((resolve, reject) => {
    socket.once('open', () => {
      resolve({
        socket,
        next: () =>
          new Promise((nextResolve) => {
            const buffered = queue.shift();
            if (buffered !== undefined) nextResolve(buffered);
            else waiters.push(nextResolve);
          }),
      });
    });
    socket.once('error', reject);
  });
}

afterEach(async () => {
  while (sockets.length > 0) sockets.pop()?.terminate();
  while (servers.length > 0) await servers.pop()?.stop();
});

describe('secrets never reach the log (SEC-6/SEC-7/DEC-003)', () => {
  it('has no logger call that can receive a pairing code, device token or attestation', () => {
    // Grep-level tripwire over every logger invocation (multi-line calls included by scanning a
    // bounded window after the call). A future `logger.info('...', deviceToken)` fails here.
    // String literals are stripped first so an honest message ("... attestation ...") does not
    // trip the guard; template interpolations are checked separately.
    const forbidden = /\b(pairingCode|deviceToken|enrollSecret|codeHmac|attestation)\b/;
    const interpolation =
      /\$\{[^}]*\b(pairingCode|deviceToken|enrollSecret|codeHmac|attestation)\b/;
    const stringLiteral = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;
    const call = /logger\.(?:error|warn|info|debug)\(([\s\S]{0,400}?)\);/g;
    for (const file of sourceFiles()) {
      const source = read(file);
      for (const match of source.matchAll(call)) {
        const args = match[1] ?? '';
        const codeOnly = args.replace(stringLiteral, "''");
        expect(codeOnly, `${file}: ${match[0]?.slice(0, 120)}`).not.toMatch(forbidden);
        expect(args, `${file}: ${match[0]?.slice(0, 120)}`).not.toMatch(interpolation);
      }
    }
  });

  it('redacts the pairing code in its log label (only the issue time is shown)', () => {
    const label = pairCodeLogLabel({
      value: '123456',
      issuedAt: new Date('2026-11-10T10:00:00.000Z'),
      expiresAt: new Date('2026-11-10T10:10:00.000Z'),
    });
    expect(label).toContain('redacted');
    expect(label).not.toMatch(/\b\d{6}\b/);
    expect(label).not.toContain('123456');
  });

  it('does not log the attestation token or nonce during a successful link handshake', async () => {
    const logger = recordingLogger();
    const { port } = await startLink(logger);
    const client = await connect(port);
    await client.next(); // hello
    await client.next(); // challenge

    client.socket.send(
      JSON.stringify({ v: 1, id: 'd-1', type: 'auth', attestation: SECRET_TOKEN }),
    );
    // authOk arrives; the token is verified by the injected verifier and never logged.
    const reply = (await client.next()) as { type?: string };
    expect(reply.type).toBe('authOk');

    const logged = logger.records.join('\n');
    expect(logged).not.toContain(SECRET_TOKEN);
    expect(logged).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}/);
  });

  it('does not log a rejected attestation value', async () => {
    const logger = recordingLogger();
    const { port } = await startLink(logger, {
      verifyAttestation: async () => ({
        ok: false,
        code: 'UNAUTHENTICATED',
        reason: 'BAD_SIGNATURE',
        message: 'The attestation signature is invalid.',
      }),
    });
    const client = await connect(port);
    await client.next();
    await client.next();
    client.socket.send(
      JSON.stringify({ v: 1, id: 'd-2', type: 'auth', attestation: SECRET_TOKEN }),
    );
    await client.next(); // authError

    const logged = logger.records.join('\n');
    expect(logged).not.toContain(SECRET_TOKEN);
    expect(logged).toContain('BAD_SIGNATURE');
  });

  it('does not log the attestation or nonce when the key fetch fails', async () => {
    const logger = recordingLogger();
    const gate = new AttestationGate({
      baseUrl: 'http://127.0.0.1:9/api/v1',
      getBinding: () => ({ deviceId: DEVICE_ID, userId: USER_ID }),
      fetchPublicKey: async () => {
        throw new Error('network down');
      },
      logger,
    });

    const result = await gate.verify({ token: SECRET_TOKEN, nonce: SECRET_NONCE });
    expect(result).toMatchObject({ ok: false, reason: 'KEY_UNAVAILABLE' });
    const logged = logger.records.join('\n');
    expect(logged).not.toContain(SECRET_TOKEN);
    expect(logged).not.toContain(SECRET_NONCE);
  });
});
