// Shared test helpers: a retry-free QueryClient, a typed AuthContext value and a disconnected
// AgentLink context value. Guards and components are rendered against the contexts directly, so
// tests never fake auth through the network layer and never mutate module state.

import { QueryClient } from '@tanstack/react-query';
import type { Role } from '@focus-mode/shared';

import type { AgentLinkContextValue } from '../agent/agent-link-provider';
import type { PublicUser } from '../api/types';
import type { AuthContextValue } from '../auth/auth-context';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function makeUser(overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: '507f1f77bcf86cd799439012',
    name: 'Kabir',
    email: 'kabir@demo.com',
    role: 'USER',
    timezone: 'Asia/Kolkata',
    defaultDurationMin: 60,
    isActive: true,
    createdAt: '2026-11-02T10:00:00.000Z',
    lastLoginAt: '2026-11-10T10:00:00.000Z',
    ...overrides,
  };
}

export function makeUserWithRole(role: Role): PublicUser {
  return makeUser({ role });
}

export function makeAuthValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const user = overrides.user ?? null;

  return {
    status: user === null ? 'anonymous' : 'authenticated',
    user,
    login: async () => user ?? makeUser(),
    register: async () => user ?? makeUser(),
    logout: async () => undefined,
    retry: () => undefined,
    ...overrides,
  };
}

/** Honest disconnected AgentLink value for components rendered outside the provider. */
export function makeAgentLinkValue(
  overrides: Partial<AgentLinkContextValue> = {},
): AgentLinkContextValue {
  const base: AgentLinkContextValue = {
    status: 'DISCONNECTED',
    capabilities: null,
    session: null,
    agentVersion: null,
    detail: 'Not connected to a Focus Agent yet.',
    connecting: false,
    helpCardVisible: false,
    headsUp: null,
    runningApps: null,
    linkLost: false,
    startedSessionId: null,
    lastEnded: null,
    lastStartReaside: null,
    connect: () => undefined,
    refresh: () => undefined,
    showHelpCard: () => undefined,
    dismissHelpCard: () => undefined,
    notifyPaired: () => undefined,
    endFocus: () => true,
    startFocus: () => true,
    requestRunningApps: () => undefined,
    dismissEndedSession: () => undefined,
  };

  return Object.assign(base, overrides);
}
