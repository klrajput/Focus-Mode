/*
 * `/admin` (UX_SPEC §4.10, INTEGRATION_CONTRACTS §3.1 #26–#36, FR-019).
 *
 * Four tabs, each with the §6.1 loading / empty / error / success states:
 *   · Users        — search + pagination, role/active badges, deactivate/reactivate.
 *   · Presets      — list, create, edit and delete app bundles.
 *   · Agent links  — list, create, edit and delete installer links (HTTPS enforced).
 *   · Stats        — aggregate counts only, never per-user session detail (PDF §6).
 * The route is wrapped in `RequireRole role="ADMIN"` (USER → /403) and the API returns
 * `FORBIDDEN` regardless — the client guard is UX, not security.
 *
 * Wiring lives in the tab components, which this page mounts: `useAdminUsers`/`useUpdateAdminUser`
 * (Users), `useAdminPresets` (Presets), `useAdminAgentLinks` (Agent links) and `useAdminStats`
 * (Stats). Keeping the page as the tab shell is what lets each tab own its four NFR-007 states.
 */

import { useState, type KeyboardEvent } from 'react';
import { ChartColumn, Download, Layers, Users } from 'lucide-react';

import { AgentLinksTab } from '../components/admin/agent-links-tab';
import { PresetsTab } from '../components/admin/presets-tab';
import { StatsTab } from '../components/admin/stats-tab';
import { UsersTab } from '../components/admin/users-tab';
import { PageHeader } from '../components/ui/page-header';
import { cn } from '../lib/cn';

type AdminTab = 'users' | 'presets' | 'links' | 'stats';

const TABS: readonly { id: AdminTab; label: string; icon: typeof Users }[] = [
  { id: 'users', label: 'Users', icon: Users },
  { id: 'presets', label: 'Presets', icon: Layers },
  { id: 'links', label: 'Agent links', icon: Download },
  { id: 'stats', label: 'Stats', icon: ChartColumn },
];

function tabClass(active: boolean): string {
  return cn(
    'inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm font-medium md:min-h-10',
    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none',
    active
      ? 'border-primary bg-primary-subtle text-primary-active'
      : 'border-border-strong bg-card text-ink hover:bg-primary-subtle',
  );
}

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>('users');

  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = TABS.findIndex((entry) => entry.id === tab);
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = TABS[(index + delta + TABS.length) % TABS.length];
    if (next === undefined) return;
    setTab(next.id);
    document.querySelector<HTMLButtonElement>(`#admin-tab-${next.id}`)?.focus();
  }

  return (
    <>
      <PageHeader
        title="Admin"
        description="Users, presets, download links and aggregate stats. No per-user session detail is shown."
      />

      <div
        role="tablist"
        aria-label="Admin sections"
        className="mb-4 flex flex-wrap gap-2"
        onKeyDown={onTabKeyDown}
      >
        {TABS.map((entry) => {
          const Icon = entry.icon;
          const active = tab === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`admin-tab-${entry.id}`}
              aria-selected={active}
              aria-controls={`admin-panel-${entry.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(entry.id)}
              className={tabClass(active)}
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
              {entry.label}
            </button>
          );
        })}
      </div>

      <div
        id={`admin-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`admin-tab-${tab}`}
        tabIndex={0}
        className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {tab === 'users' ? <UsersTab /> : null}
        {tab === 'presets' ? <PresetsTab /> : null}
        {tab === 'links' ? <AgentLinksTab /> : null}
        {tab === 'stats' ? <StatsTab /> : null}
      </div>
    </>
  );
}
