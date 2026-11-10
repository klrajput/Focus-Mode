// Role-aware sidebar navigation (UX_SPEC §3/§4, FR-021).
// USER sees the seven product pages; ADMIN additionally sees `Admin` after a divider — rendered
// only for the right role AND protected by the `/admin` route guard (never security by itself).
// `min-h-11` keeps every target ≥44 px at 360 px.

import {
  CalendarClock,
  ChartColumn,
  LayoutDashboard,
  MonitorSmartphone,
  Settings,
  Shield,
  ShieldCheck,
  Timer,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export const PRIMARY_NAV: readonly NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/focus', label: 'Focus', icon: Timer },
  { to: '/devices', label: 'Devices', icon: MonitorSmartphone },
  { to: '/allowlist', label: 'Allow-list', icon: ShieldCheck },
  { to: '/schedules', label: 'Schedules', icon: CalendarClock },
  { to: '/insights', label: 'Insights', icon: ChartColumn },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export const ADMIN_NAV: readonly NavItem[] = [
  { to: '/admin', label: 'Admin', icon: Shield, adminOnly: true },
];
