// config/env.test.ts — validated agent configuration (DEC-013, NFR-004/010).
// A bad port, wildcard Origin or unknown driver must fail fast at startup instead of weakening
// the loopback link; the packaged default driver must never be `fake`.

import { describe, expect, it } from 'vitest';
import {
  AgentEnvError,
  agentLogLevelSchema,
  loadAgentEnv,
  parseAgentEnv,
  type AgentConfig,
} from './env.js';

function expectEnvError(source: NodeJS.ProcessEnv): AgentEnvError {
  try {
    parseAgentEnv(source);
    expect.unreachable('parseAgentEnv should have thrown');
  } catch (error) {
    expect(error).toBeInstanceOf(AgentEnvError);
    return error as AgentEnvError;
  }
}

describe('parseAgentEnv', () => {
  it('applies safe defaults: port 4545, real driver, one dev Origin, headless off', () => {
    const config: AgentConfig = parseAgentEnv({});
    expect(config.port).toBe(4545);
    expect(config.driver).toBe('real');
    expect(config.allowedOrigins).toEqual(['http://localhost:5173']);
    expect(config.headless).toBe(false);
    expect(config.logLevel).toBe('info');
    expect(config.apiBaseUrl).toBeUndefined();
    expect(config.userDataDir).toBeUndefined();
  });

  it('parses strings from process.env style values', () => {
    const config = parseAgentEnv({
      AGENT_PORT: '4601',
      AGENT_ALLOWED_ORIGINS: 'https://focus.example.com, http://localhost:5173',
      AGENT_FOCUS_DRIVER: 'fake',
      AGENT_LOG_LEVEL: 'debug',
      AGENT_HEADLESS: '1',
      AGENT_API_BASE_URL: 'https://api.focus.example.com/api/v1/',
      AGENT_USER_DATA_DIR: '/tmp/focus-agent-test',
    });
    expect(config.port).toBe(4601);
    expect(config.driver).toBe('fake');
    expect(config.logLevel).toBe('debug');
    expect(config.headless).toBe(true);
    expect(config.allowedOrigins).toEqual(['https://focus.example.com', 'http://localhost:5173']);
    expect(config.apiBaseUrl).toBe('https://api.focus.example.com/api/v1');
    expect(config.userDataDir).toBe('/tmp/focus-agent-test');
  });

  it('deduplicates Origins and normalises a trailing slash', () => {
    const config = parseAgentEnv({
      AGENT_ALLOWED_ORIGINS: 'http://localhost:5173/,http://localhost:5173,https://a.example',
    });
    expect(config.allowedOrigins).toEqual(['http://localhost:5173', 'https://a.example']);
  });

  it('rejects wildcards, paths, credentials and non-http Origins', () => {
    for (const origins of [
      '*',
      'http://localhost:5173/*',
      'http://localhost:5173/app',
      'http://user:pass@localhost:5173',
      'file:///tmp/dashboard.html',
      'not a url',
      ' , ',
    ]) {
      const error = expectEnvError({ AGENT_ALLOWED_ORIGINS: origins });
      expect(error.issues.join(' ')).toMatch(/AGENT_ALLOWED_ORIGINS|origins|origin/);
    }
  });

  it('rejects out-of-range and non-numeric ports', () => {
    for (const port of ['0', '80', '70000', 'abc']) {
      expect(() => parseAgentEnv({ AGENT_PORT: port })).toThrow(AgentEnvError);
    }
  });

  it('rejects an unknown driver or log level', () => {
    expect(() => parseAgentEnv({ AGENT_FOCUS_DRIVER: 'auto' })).toThrow(AgentEnvError);
    expect(() => parseAgentEnv({ AGENT_LOG_LEVEL: 'trace' })).toThrow(AgentEnvError);
    expect(agentLogLevelSchema.options).toContain('silly');
  });

  it('requires AGENT_API_BASE_URL to include the /api/v1 prefix (DEC-013)', () => {
    expect(() => parseAgentEnv({ AGENT_API_BASE_URL: 'https://api.example.com' })).toThrow(
      AgentEnvError,
    );
    expect(() => parseAgentEnv({ AGENT_API_BASE_URL: 'ftp://api.example.com/api/v1' })).toThrow(
      AgentEnvError,
    );
  });

  it('requires an absolute AGENT_USER_DATA_DIR', () => {
    const error = expectEnvError({ AGENT_USER_DATA_DIR: './relative-data' });
    expect(error.issues[0]).toMatch(/absolute/);
  });

  it('freezes the returned configuration', () => {
    const config = parseAgentEnv({});
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.allowedOrigins)).toBe(true);
  });
});

describe('loadAgentEnv', () => {
  it('validates an injected environment without touching the real process env', () => {
    const config = loadAgentEnv({ source: { AGENT_FOCUS_DRIVER: 'fake', AGENT_PORT: '4546' } });
    expect(config.driver).toBe('fake');
    expect(config.port).toBe(4546);
  });

  it('throws AgentEnvError with readable issues', () => {
    expect(() => loadAgentEnv({ source: { AGENT_PORT: 'nope' } })).toThrow(AgentEnvError);
  });
});
