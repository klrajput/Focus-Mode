/*
 * Session and device status badges (UX_SPEC §3/§4, NFR-008 rule 1).
 * Every state is icon + text; colour only reinforces the label. Labels are the exact words A3 uses
 * so `/dashboard`, `/devices` and any later table agree.
 */

import type { DeviceStatus, SessionStatus } from '@focus-mode/shared';
import { CheckCircle2, Clock, CircleSlash2, Target, type LucideIcon } from 'lucide-react';

import { StatusBadge, type BadgeTone } from '../ui/status-badge';

interface StatusView {
  tone: BadgeTone;
  icon: LucideIcon;
  label: string;
}

const SESSION_VIEWS: Readonly<Record<SessionStatus, StatusView>> = {
  ACTIVE: { tone: 'info', icon: Clock, label: 'Active' },
  COMPLETED: { tone: 'success', icon: CheckCircle2, label: 'Completed' },
  CANCELLED: { tone: 'neutral', icon: CircleSlash2, label: 'Cancelled' },
};

const DEVICE_VIEWS: Readonly<Record<DeviceStatus, StatusView>> = {
  CONNECTED: { tone: 'success', icon: CheckCircle2, label: 'Connected' },
  DISCONNECTED: { tone: 'neutral', icon: CircleSlash2, label: 'Disconnected' },
  FOCUSING: { tone: 'focus', icon: Target, label: 'Focusing' },
};

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const view = SESSION_VIEWS[status];
  return (
    <StatusBadge tone={view.tone} icon={view.icon}>
      {view.label}
    </StatusBadge>
  );
}

export function DeviceStatusBadge({ status }: { status: DeviceStatus }) {
  const view = DEVICE_VIEWS[status];
  return (
    <StatusBadge tone={view.tone} icon={view.icon}>
      {view.label}
    </StatusBadge>
  );
}
