/*
 * AgentLinkProvider — the dashboard's single source of Focus Agent truth (T-045, FR-004/FR-014).
 * It owns one `AgentLink`, turns its typed events into a small reducer state and exposes a stable
 * context value to `AgentStatusBadge`, `FocusIndicator` and `/devices`. It connects only while the
 * user is authenticated (so the landing/login pages never trigger a local-network prompt) and
 * disposes the socket on logout/unmount.
 *
 * Status vocabulary is the frozen `AgentConnectionStatus`
 * (`DISCONNECTED | IDLE | PAIRED | FOCUSING`); `DISCONNECTED` is dashboard-only and always means
 * "no attested link", never "the agent says it is off". Attestation goes through the existing API
 * layer (`POST /devices/:id/attest`) — the dashboard never mints anything locally (REC-003).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import toast from 'react-hot-toast';
import type {
  AgentCapabilities,
  AgentConnectionStatus,
  AgentState,
  AuthErrorMessage,
  FocusRejectedMessage,
  FocusStartedMessage,
  HelloMessage,
  ScheduleHeadsUpMessage,
  StateMessage,
} from '@focus-mode/shared';

import { devicesApi } from '../api/endpoints/devices';
import type { Device } from '../api/types';
import { useAuth } from '../auth/auth-context';
import { FOCUS_REJECTED_MESSAGES } from '../copy/errors';
import { AgentLink, type AgentLinkClient, type AgentLinkOptions } from './agent-link';

/** One active session as reported by the agent (`state.session` / `focusStarted`). */
export interface AgentSessionSummary {
  sessionId: string;
  startedAt: string;
  endsAt: string;
  plannedMinutes: number;
  source: 'MANUAL' | 'SCHEDULE';
}

/** Everything the shell and `/devices` need from the local channel. */
export interface AgentLinkContextValue {
  status: AgentConnectionStatus;
  capabilities: AgentCapabilities | null;
  session: AgentSessionSummary | null;
  agentVersion: string | null;
  /** Human explanation for the badge tooltip; already user-safe copy. */
  detail: string;
  /** First seconds of an attempt: badge shows "Connecting…" instead of "Disconnected". */
  connecting: boolean;
  /** UX_SPEC §6.3 card visibility (dismissible, never a fake "Connected"). */
  helpCardVisible: boolean;
  headsUp: { scheduleId: string; startsAt: string } | null;
  /** Re-attempt the current scan/connection without changing anything else. */
  connect: () => void;
  /** Full reconnect: drop the socket, re-scan 4545–4549 and re-run the handshake. */
  refresh: () => void;
  showHelpCard: () => void;
  dismissHelpCard: () => void;
  /** Tell the Focus Agent that `/devices/pair` succeeded (a nudge only, REC-002). */
  notifyPaired: () => void;
  /** Ask the agent to end the running session (End Focus in `FocusIndicator`). */
  endFocus: () => void;
}

export const AgentLinkContext = createContext<AgentLinkContextValue | null>(null);

/** Injecting the link keeps provider tests socket-free (the real class is covered separately). */
export type AgentLinkFactory = (options: AgentLinkOptions) => AgentLinkClient;

export interface AgentLinkProviderProps {
  children: ReactNode;
  linkFactory?: AgentLinkFactory;
}

interface AgentLinkState {
  status: AgentConnectionStatus;
  capabilities: AgentCapabilities | null;
  session: AgentSessionSummary | null;
  agentVersion: string | null;
  detail: string;
  connecting: boolean;
  helpCardVisible: boolean;
  helpDismissed: boolean;
  headsUp: { scheduleId: string; startsAt: string } | null;
}

type AgentLinkAction =
  | { type: 'connecting' }
  | { type: 'status'; status: AgentConnectionStatus; detail: string }
  | { type: 'hello'; hello: HelloMessage }
  | { type: 'authOk' }
  | { type: 'authError'; message: AuthErrorMessage }
  | { type: 'state'; message: StateMessage }
  | { type: 'focusStarted'; message: FocusStartedMessage }
  | { type: 'focusEnded' }
  | { type: 'headsUp'; message: ScheduleHeadsUpMessage }
  | { type: 'focusRejected'; message: FocusRejectedMessage }
  | { type: 'error'; message: { message: string } }
  | { type: 'connectFailed' }
  | { type: 'showHelp' }
  | { type: 'dismissHelp' }
  | { type: 'refresh' }
  | { type: 'reset' };

const INITIAL_STATE: AgentLinkState = {
  status: 'DISCONNECTED',
  capabilities: null,
  session: null,
  agentVersion: null,
  detail: 'Not connected to a Focus Agent yet.',
  connecting: false,
  helpCardVisible: false,
  helpDismissed: false,
  headsUp: null,
};

function statusDetail(status: AgentConnectionStatus): string {
  switch (status) {
    case 'PAIRED':
      return 'Your Focus Agent is connected.';
    case 'FOCUSING':
      return 'Your Focus Agent is running a focus session.';
    case 'IDLE':
      return 'Your Focus Agent is running but not paired to this account.';
    default:
      return 'No Focus Agent is reachable on this computer.';
  }
}

function statusFromAgentState(agentState: AgentState): AgentConnectionStatus {
  return agentState;
}

function sessionFromState(message: StateMessage): AgentSessionSummary | null {
  if (message.session === undefined) return null;
  return {
    sessionId: message.session.sessionId,
    startedAt: message.session.startedAt,
    endsAt: message.session.endsAt,
    plannedMinutes: message.session.plannedMinutes,
    source: message.session.source,
  };
}

function sessionFromStarted(message: FocusStartedMessage): AgentSessionSummary {
  const startedAtMs = new Date(message.at).getTime();
  const endsAtMs = new Date(message.endsAt).getTime();
  const plannedMinutes =
    Number.isFinite(startedAtMs) && Number.isFinite(endsAtMs) && endsAtMs > startedAtMs
      ? Math.max(1, Math.round((endsAtMs - startedAtMs) / 60_000))
      : 1;

  return {
    sessionId: message.sessionId,
    startedAt: message.at,
    endsAt: message.endsAt,
    plannedMinutes,
    source: message.source,
  };
}

function reducer(state: AgentLinkState, action: AgentLinkAction): AgentLinkState {
  switch (action.type) {
    case 'connecting':
      return {
        ...state,
        status: 'DISCONNECTED',
        session: null,
        connecting: true,
        helpCardVisible: false,
        detail: 'Looking for your Focus Agent…',
      };
    case 'refresh':
      return {
        ...state,
        status: 'DISCONNECTED',
        session: null,
        connecting: true,
        helpCardVisible: false,
        helpDismissed: false,
        detail: 'Looking for your Focus Agent…',
      };
    case 'status':
      return {
        ...state,
        status: action.status,
        detail: action.detail,
        connecting: false,
        session: action.status === 'FOCUSING' ? state.session : null,
        helpCardVisible: action.status === 'DISCONNECTED' ? state.helpCardVisible : false,
      };
    case 'hello':
      return {
        ...state,
        agentVersion: action.hello.agentVersion,
        capabilities: action.hello.capabilities,
        status: action.hello.paired ? state.status : 'IDLE',
        detail: action.hello.paired
          ? state.detail
          : 'Your Focus Agent is running but not paired to this account yet.',
        connecting: action.hello.paired ? state.connecting : false,
      };
    case 'authOk':
      return { ...state, connecting: false };
    case 'authError':
      return {
        ...state,
        status: 'IDLE',
        connecting: false,
        session: null,
        detail: 'Your Focus Agent rejected this dashboard. Pair it again on Devices to reconnect.',
      };
    case 'state': {
      const status = statusFromAgentState(action.message.state);
      return {
        ...state,
        status,
        session: sessionFromState(action.message),
        detail: statusDetail(status),
        connecting: false,
      };
    }
    case 'focusStarted':
      return {
        ...state,
        status: 'FOCUSING',
        session: sessionFromStarted(action.message),
        detail: statusDetail('FOCUSING'),
        connecting: false,
      };
    case 'focusEnded':
      return {
        ...state,
        status: 'PAIRED',
        session: null,
        detail: 'The focus session ended and your windows are back.',
      };
    case 'headsUp':
      return {
        ...state,
        headsUp: { scheduleId: action.message.scheduleId, startsAt: action.message.startsAt },
      };
    case 'focusRejected':
      return state;
    case 'error':
      return { ...state, detail: action.message.message };
    case 'connectFailed':
      return {
        ...state,
        status: 'DISCONNECTED',
        connecting: false,
        session: null,
        helpCardVisible: !state.helpDismissed,
        detail: 'We could not reach your Focus Agent. Make sure it is running.',
      };
    case 'showHelp':
      return { ...state, helpCardVisible: true, helpDismissed: false };
    case 'dismissHelp':
      return { ...state, helpCardVisible: false, helpDismissed: true };
    case 'reset':
      return INITIAL_STATE;
    default:
      return state;
  }
}

/** The local agent belongs to exactly one device; prefer the device that is currently online. */
function pickDeviceId(items: readonly Device[]): string | null {
  const active = items.find(
    (device) => device.status === 'CONNECTED' || device.status === 'FOCUSING',
  );
  if (active !== undefined) return active.id;

  const paired = items.find((device) => device.pairedAt !== null);
  if (paired !== undefined) return paired.id;

  const [first] = items;
  return first === undefined ? null : first.id;
}

const createDefaultLink: AgentLinkFactory = (options) => new AgentLink(options);

export function AgentLinkProvider({
  children,
  linkFactory = createDefaultLink,
}: AgentLinkProviderProps) {
  const { status: authStatus } = useAuth();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const linkRef = useRef<AgentLinkClient | null>(null);
  const linkFactoryRef = useRef(linkFactory);
  linkFactoryRef.current = linkFactory;

  useEffect(() => {
    if (authStatus !== 'authenticated') return;

    const link = linkFactoryRef.current({
      resolveDeviceId: async () => {
        const page = await devicesApi.list({ limit: 20, sort: '-lastSeenAt' });
        return pickDeviceId(page.items);
      },
      attest: async (deviceId, nonce) => {
        const result = await devicesApi.attest(deviceId, { nonce });
        return result.attestation;
      },
    });
    linkRef.current = link;

    const unsubscribers = [
      link.on('status', (event) => dispatch({ type: 'status', ...event })),
      link.on('hello', (hello) => dispatch({ type: 'hello', hello })),
      link.on('authOk', () => dispatch({ type: 'authOk' })),
      link.on('authError', (message) => dispatch({ type: 'authError', message })),
      link.on('state', (message) => dispatch({ type: 'state', message })),
      link.on('focusStarted', (message) => dispatch({ type: 'focusStarted', message })),
      link.on('focusEnded', () => dispatch({ type: 'focusEnded' })),
      link.on('scheduleHeadsUp', (message) => dispatch({ type: 'headsUp', message })),
      link.on('focusRejected', (message) => {
        toast.error(FOCUS_REJECTED_MESSAGES[message.code]);
        dispatch({ type: 'focusRejected', message });
      }),
      link.on('connectFailed', () => dispatch({ type: 'connectFailed' })),
      link.on('error', (event) => dispatch({ type: 'error', message: event })),
    ];

    dispatch({ type: 'connecting' });
    link.connect();

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
      link.dispose();
      if (linkRef.current === link) linkRef.current = null;
      dispatch({ type: 'reset' });
    };
  }, [authStatus]);

  const connect = useCallback((): void => {
    dispatch({ type: 'connecting' });
    linkRef.current?.connect();
  }, []);

  const refresh = useCallback((): void => {
    dispatch({ type: 'refresh' });
    linkRef.current?.reconnect();
  }, []);

  const showHelpCard = useCallback((): void => {
    dispatch({ type: 'showHelp' });
  }, []);

  const dismissHelpCard = useCallback((): void => {
    dispatch({ type: 'dismissHelp' });
  }, []);

  const notifyPaired = useCallback((): void => {
    linkRef.current?.notifyPaired();
  }, []);

  const endFocus = useCallback((): void => {
    linkRef.current?.endFocus(state.session?.sessionId);
  }, [state.session]);

  const value = useMemo<AgentLinkContextValue>(
    () => ({
      status: state.status,
      capabilities: state.capabilities,
      session: state.session,
      agentVersion: state.agentVersion,
      detail: state.detail,
      connecting: state.connecting,
      helpCardVisible: state.helpCardVisible,
      headsUp: state.headsUp,
      connect,
      refresh,
      showHelpCard,
      dismissHelpCard,
      notifyPaired,
      endFocus,
    }),
    [
      state.status,
      state.capabilities,
      state.session,
      state.agentVersion,
      state.detail,
      state.connecting,
      state.helpCardVisible,
      state.headsUp,
      connect,
      refresh,
      showHelpCard,
      dismissHelpCard,
      notifyPaired,
      endFocus,
    ],
  );

  return <AgentLinkContext.Provider value={value}>{children}</AgentLinkContext.Provider>;
}

/** Throws outside the provider so a missing wiring is caught in tests, not hidden by a default. */
export function useAgentLink(): AgentLinkContextValue {
  const value = useContext(AgentLinkContext);
  if (value === null) {
    throw new Error('useAgentLink must be used inside <AgentLinkProvider>');
  }
  return value;
}
