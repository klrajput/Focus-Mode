/*
 * FocusSessionSync — the dashboard half of a session's lifecycle record (T-057, FR-006/FR-010/FR-024).
 *
 * The Focus Agent is the only component that starts or ends focus (INV-1), so the REST record is
 * written *after* the agent confirms:
 *   focusStarted → POST /sessions  {deviceId, durationMin, startedAt, clientSessionId, source}
 *   focusEnded   → PATCH /sessions/:id {status, endedAt, actualMinutes, endReason}
 *
 * `clientSessionId` is the agent's `sessionId` (INTEGRATION_CONTRACTS §4.5), which is also the
 * server's idempotency key (REC-006), so a retry or a duplicated frame can never create two rows.
 * The component is mounted once inside the AppShell, so a session started from the tray or a
 * schedule is recorded too, not only one started from this tab.
 */

import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { EndReason, SessionCreateInput, TerminalSessionStatus } from '@focus-mode/shared';

import { sessionsApi } from '../api/endpoints/sessions';
import { devicesApi } from '../api/endpoints/devices';
import type { Device } from '../api/types';
import {
  useAgentLink,
  type AgentSessionEnd,
  type AgentSessionSummary,
} from '../agent/agent-link-provider';
import { copyForError } from '../copy/errors';
import { queryKeys } from '../hooks/query-keys';

/** UX_SPEC §4.3/§4.4 success toasts. */
export const FOCUS_STARTED_TOAST = 'Focus started';
export const FOCUS_ENDED_TOAST = 'Focus ended — your windows are back.';

/** The device the loopback agent belongs to: online first, then any paired device. */
export function pickFocusDeviceId(items: readonly Device[]): string | null {
  const active = items.find(
    (device) => device.status === 'CONNECTED' || device.status === 'FOCUSING',
  );
  if (active !== undefined) return active.id;

  const paired = items.find((device) => device.pairedAt !== null);
  if (paired !== undefined) return paired.id;

  return null;
}

/**
 * Only a timer-completed session is COMPLETED; every other end (user, agent, sleep, crash recovery,
 * unpair, quit) is CANCELLED with the agent's `endReason` kept for the audit trail.
 */
export function finalStatusFor(reason: EndReason): TerminalSessionStatus {
  return reason === 'COMPLETED' ? 'COMPLETED' : 'CANCELLED';
}

async function resolveDeviceId(): Promise<string | null> {
  const page = await devicesApi.list({ limit: 20, sort: '-lastSeenAt' });
  return pickFocusDeviceId(page.items);
}

async function createSession(session: AgentSessionSummary): Promise<string | null> {
  const deviceId = await resolveDeviceId();
  if (deviceId === null) {
    toast.error('No device connected — start your Focus Agent.');
    return null;
  }

  const input: SessionCreateInput = {
    deviceId,
    durationMin: session.plannedMinutes,
    startedAt: session.startedAt,
    clientSessionId: session.sessionId,
    source: session.source,
  };
  const created = await sessionsApi.create(input);
  return created.id;
}

/** Fallback lookup for a session this tab did not create (hard reload during focus). */
async function findSessionId(clientSessionId: string): Promise<string | null> {
  const page = await sessionsApi.list({ limit: 10, sort: '-startedAt' });
  const match = page.items.find((item) => item.clientSessionId === clientSessionId);
  return match?.id ?? null;
}

export function FocusSessionSync() {
  const agent = useAgentLink();
  const { session, startedSessionId, lastEnded } = agent;
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const reportedStart = useRef<string | null>(null);
  const restSessionIds = useRef(new Map<string, string>());
  const finalised = useRef(new Set<string>());

  // focusStarted → POST /sessions, "Focus started" and the calm /focus view.
  useEffect(() => {
    if (startedSessionId === null || session === null) return;
    if (reportedStart.current === startedSessionId) return;
    reportedStart.current = startedSessionId;

    const started = session;
    void (async () => {
      try {
        const id = await createSession(started);
        if (id !== null) {
          restSessionIds.current.set(started.sessionId, id);
          void queryClient.invalidateQueries({ queryKey: queryKeys.sessionsRoot });
        }
      } catch (error) {
        // ALREADY_FOCUSING (409) means the server already has a running session; the copy points
        // the user at /focus instead of implying the start failed silently.
        toast.error(copyForError(error));
      }
    })();

    toast.success(FOCUS_STARTED_TOAST);
    if (location.pathname !== '/focus') navigate('/focus');
  }, [startedSessionId, session, location.pathname, navigate, queryClient]);

  // focusEnded → PATCH /sessions/:id with the agent's actual minutes.
  useEffect(() => {
    if (lastEnded === null) return;
    if (finalised.current.has(lastEnded.sessionId)) return;
    finalised.current.add(lastEnded.sessionId);

    const ended: AgentSessionEnd = lastEnded;
    const onFocusPage = location.pathname === '/focus';

    void (async () => {
      const known = restSessionIds.current.get(ended.sessionId);
      let sessionId = known ?? null;

      try {
        if (sessionId === null) sessionId = await findSessionId(ended.sessionId);
        if (sessionId === null) return;

        await sessionsApi.patch(sessionId, {
          status: finalStatusFor(ended.reason),
          endedAt: ended.at,
          actualMinutes: ended.actualMinutes,
          endReason: ended.reason,
        });
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessionsRoot });
        void queryClient.invalidateQueries({ queryKey: queryKeys.insightsRoot });
      } catch (error) {
        toast.error(copyForError(error));
      }

      if (!onFocusPage) toast.success(FOCUS_ENDED_TOAST);
    })();
  }, [lastEnded, location.pathname, queryClient]);

  return null;
}
