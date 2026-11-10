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
  AppEntry,
  AuthErrorMessage,
  EndReason,
  FocusEndedMessage,
  FocusRejectedMessage,
  FocusStartedMessage,
  HelloMessage,
  RunningApp,
  ScheduleHeadsUpMessage,
  StateMessage,
  AppsMessage,
} from '@focus-mode/shared';

import { devicesApi } from '../api/endpoints/devices';
import type { Device } from '../api/types';
import { useAuth } from '../auth/auth-context';
import { FOCUS_REJECTED_MESSAGES } from '../copy/errors';
import { AgentLink, type AgentLinkClient, type AgentLinkOptions } from './agent-link';

/**
 * Consent record sent with every `enterFocus` (FR-009; INTEGRATION_CONTRACTS §4.5).
 * The dashboard's consent modal is the gate — the agent still shows its own native first-run dialog.
 */
export const CONSENT_VERSION = 'consent-v1';

/** One active session as reported by the agent (`state.session` / `focusStarted`). */
export interface AgentSessionSummary {
  sessionId: string;
  startedAt: string;
  endsAt: string;
  plannedMinutes: number;
  source: 'MANUAL' | 'SCHEDULE';
}

/** Terminal event from the agent — the dashboard reports it to `PATCH /sessions/:id`. */
export interface AgentSessionEnd {
  sessionId: string;
  at: string;
  reason: EndReason;
  actualMinutes: number;
}

/** Everything `StartFocusCard` needs to ask the agent to start a session. */
export interface StartFocusRequest {
  durationMin: number;
  allowList: readonly AppEntry[];
  /** "Keep new apps aside" toggle (UX_SPEC §5, default on). */
  reaside: boolean;
  /** Idempotency key shared with `POST /sessions` (REC-006). */
  clientSessionId: string;
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
  /** Running apps from `listApps` (labels only, INV-6); `null` until the agent answers. */
  runningApps: readonly RunningApp[] | null;
  /** The link dropped while a session was running — the agent keeps it running (F-02). */
  linkLost: boolean;
  /** Set only by a `focusStarted` frame, so a reconnect/resync never re-triggers a start. */
  startedSessionId: string | null;
  /** Last `focusEnded`, consumed once by the REST session sync. */
  lastEnded: AgentSessionEnd | null;
  /** The "keep new apps aside" choice sent with the running session; `null` after a resync. */
  lastStartReaside: boolean | null;
  /** Re-attempt the current scan/connection without changing anything else. */
  connect: () => void;
  /** Full reconnect: drop the socket, re-scan 4545–4549 and re-run the handshake. */
  refresh: () => void;
  showHelpCard: () => void;
  dismissHelpCard: () => void;
  /** Tell the Focus Agent that `/devices/pair` succeeded (a nudge only, REC-002). */
  notifyPaired: () => void;
  /** Ask the agent to end the running session (End Focus). `false` when the message was not sent. */
  endFocus: () => boolean;
  /** Send `enterFocus` after the consent modal was confirmed. `false` when no socket is open. */
  startFocus: (request: StartFocusRequest) => boolean;
  /** Ask the agent which apps are running, for the consent summary (REC-007). */
  requestRunningApps: () => void;
  /** Clear the ended-session summary on `/focus` after the user dismisses it. */
  dismissEndedSession: () => void;
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
  runningApps: readonly RunningApp[] | null;
  linkLost: boolean;
  startedSessionId: string | null;
  lastEnded: AgentSessionEnd | null;
  lastStartReaside: boolean | null;
}

type AgentLinkAction =
  | { type: 'connecting' }
  | { type: 'status'; status: AgentConnectionStatus; detail: string }
  | { type: 'hello'; hello: HelloMessage }
  | { type: 'authOk' }
  | { type: 'authError'; message: AuthErrorMessage }
  | { type: 'state'; message: StateMessage }
  | { type: 'apps'; message: AppsMessage }
  | { type: 'focusStarted'; message: FocusStartedMessage }
  | { type: 'focusEnded'; message: FocusEndedMessage }
  | { type: 'headsUp'; message: ScheduleHeadsUpMessage }
  | { type: 'focusRejected'; message: FocusRejectedMessage }
  | { type: 'error'; message: { message: string } }
  | { type: 'connectFailed' }
  | { type: 'showHelp' }
  | { type: 'dismissHelp' }
  | { type: 'startRequested'; reaside: boolean }
  | { type: 'dismissEnded' }
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
  runningApps: null,
  linkLost: false,
  startedSessionId: null,
  lastEnded: null,
  lastStartReaside: null,
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
        // F-02: a session the agent is running survives a re-handshake; the UI keeps showing it
        // with the "lost contact" warning until agent truth arrives.
        linkLost: state.session !== null,
        connecting: true,
        helpCardVisible: false,
        detail: 'Looking for your Focus Agent…',
      };
    case 'refresh':
      return {
        ...state,
        status: 'DISCONNECTED',
        linkLost: state.session !== null,
        connecting: true,
        helpCardVisible: false,
        helpDismissed: false,
        detail: 'Looking for your Focus Agent…',
      };
    case 'status': {
      const keepsSession =
        state.session !== null && (action.status === 'FOCUSING' || action.status === 'DISCONNECTED');
      return {
        ...state,
        status: action.status,
        detail: action.detail,
        connecting: false,
        session: keepsSession ? state.session : null,
        linkLost: action.status === 'DISCONNECTED' ? state.session !== null : false,
        helpCardVisible: action.status === 'DISCONNECTED' ? state.helpCardVisible : false,
      };
    }
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
        linkLost: false,
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
        linkLost: false,
      };
    }
    case 'apps':
      return { ...state, runningApps: action.message.apps };
    case 'focusStarted':
      return {
        ...state,
        status: 'FOCUSING',
        session: sessionFromStarted(action.message),
        detail: statusDetail('FOCUSING'),
        connecting: false,
        linkLost: false,
        startedSessionId: action.message.sessionId,
        lastEnded: null,
      };
    case 'focusEnded':
      return {
        ...state,
        status: 'PAIRED',
        session: null,
        linkLost: false,
        startedSessionId: null,
        detail: 'The focus session ended and your windows are back.',
        lastEnded: {
          sessionId: action.message.sessionId,
          at: action.message.at,
          reason: action.message.reason,
          actualMinutes: action.message.actualMinutes,
        },
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
        linkLost: state.session !== null,
        helpCardVisible: !state.helpDismissed,
        detail: 'We could not reach your Focus Agent. Make sure it is running.',
      };
    case 'showHelp':
      return { ...state, helpCardVisible: true, helpDismissed: false };
    case 'dismissHelp':
      return { ...state, helpCardVisible: false, helpDismissed: true };
    case 'startRequested':
      return { ...state, lastStartReaside: action.reaside };
    case 'dismissEnded':
      return { ...state, lastEnded: null };
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
      link.on('apps', (message) => dispatch({ type: 'apps', message })),
      link.on('focusStarted', (message) => dispatch({ type: 'focusStarted', message })),
      link.on('focusEnded', (message) => dispatch({ type: 'focusEnded', message })),
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

  const endFocus = useCallback((): boolean => {
    return linkRef.current?.endFocus(state.session?.sessionId) ?? false;
  }, [state.session]);

  const startFocus = useCallback((request: StartFocusRequest): boolean => {
    const link = linkRef.current;
    if (link === null) return false;
    const sent = link.send({
      type: 'enterFocus',
      durationMin: request.durationMin,
      allowList: [...request.allowList],
      reaside: request.reaside,
      // FR-009: the consent record is created here, only after the modal was confirmed.
      consent: { acceptedAt: new Date().toISOString(), version: CONSENT_VERSION },
      clientSessionId: request.clientSessionId,
    });
    if (sent) dispatch({ type: 'startRequested', reaside: request.reaside });
    return sent;
  }, []);

  const requestRunningApps = useCallback((): void => {
    linkRef.current?.requestApps();
  }, []);

  const dismissEndedSession = useCallback((): void => {
    dispatch({ type: 'dismissEnded' });
  }, []);

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
      runningApps: state.runningApps,
      linkLost: state.linkLost,
      startedSessionId: state.startedSessionId,
      lastEnded: state.lastEnded,
      lastStartReaside: state.lastStartReaside,
      connect,
      refresh,
      showHelpCard,
      dismissHelpCard,
      notifyPaired,
      endFocus,
      startFocus,
      requestRunningApps,
      dismissEndedSession,
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
      state.runningApps,
      state.linkLost,
      state.startedSessionId,
      state.lastEnded,
      state.lastStartReaside,
      connect,
      refresh,
      showHelpCard,
      dismissHelpCard,
      notifyPaired,
      endFocus,
      startFocus,
      requestRunningApps,
      dismissEndedSession,
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
