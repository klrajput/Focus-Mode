/*
 * AppShell — sidebar + header + main for every authenticated route (UX_SPEC §3, FR-021).
 * Owns three persistent slots: the role-aware navigation, the `AgentStatusBadge` (always visible,
 * icon+text) and the `FocusIndicator` (renders nothing without a session). Below `lg` the sidebar
 * becomes a slide-over drawer behind a 44 px menu button so a 360 px viewport never scrolls
 * horizontally; the desktop shell caps content at `--fm-content-max`.
 * The notifications bell (W5) shows a real unread count from `GET /notifications` and is absent
 * from the mobile drawer — the header bell is visible at every width.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Diamond, LogOut, Menu, X } from 'lucide-react';

import { useAuth } from '../../auth/auth-context';
import { cn } from '../../lib/cn';
import { useAgentLink } from '../../agent/agent-link-provider';
import { FocusSessionSync } from '../../focus/focus-session-sync';
import { AgentHelpCard } from '../agent/agent-help-card';
import { AgentStatusBadge } from '../agent/agent-status-badge';
import { FocusIndicator } from '../agent/focus-indicator';
import { Button } from '../ui/button';
import { ADMIN_NAV, PRIMARY_NAV, type NavItem } from './nav-items';
import { NotificationBell } from './notification-bell';

function navLinkClass(isActive: boolean): string {
  return cn(
    'relative flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm font-medium',
    'transition-colors duration-[var(--fm-duration-fast)] ease-[var(--fm-ease-calm)]',
    'focus-visible:ring-2 focus-visible:ring-ring-on-base focus-visible:ring-offset-2 focus-visible:ring-offset-base focus-visible:outline-none',
    isActive
      ? 'bg-nav-active-bg text-white'
      : 'text-text-on-base-muted hover:bg-nav-active-bg hover:text-white',
  );
}

function SidebarLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const Icon = item.icon;

  return (
    <li>
      <NavLink
        to={item.to}
        className={({ isActive }) => navLinkClass(isActive)}
        onClick={onNavigate}
      >
        {({ isActive }) => (
          <>
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-1/2 left-0 h-6 w-[3px] -translate-y-1/2 rounded-r-[var(--radius-pill)]',
                isActive ? 'bg-focus-on-base' : 'bg-transparent',
              )}
            />
            <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
            <span className="truncate">{item.label}</span>
          </>
        )}
      </NavLink>
    </li>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();

  return (
    <>
      <div className="flex h-16 items-center gap-2 px-5">
        <Diamond aria-hidden="true" className="h-5 w-5 shrink-0 text-focus-on-base" />
        <span className="truncate text-[15px] font-semibold tracking-tight text-white">
          Focus Mode
        </span>
      </div>

      <nav aria-label="Main navigation" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <ul className="space-y-1">
          {PRIMARY_NAV.map((item) => (
            <SidebarLink key={item.to} item={item} onNavigate={onNavigate} />
          ))}
        </ul>

        {user?.role === 'ADMIN' ? (
          <>
            <div role="separator" className="my-3 border-t border-white/20" />
            <ul className="space-y-1">
              {ADMIN_NAV.map((item) => (
                <SidebarLink key={item.to} item={item} onNavigate={onNavigate} />
              ))}
            </ul>
          </>
        ) : null}
      </nav>

      {user === null ? null : (
        <div className="border-t border-white/20 px-3 py-3">
          <p className="truncate px-2 text-[13px] font-medium text-white">{user.name}</p>
          <p className="truncate px-2 pb-2 text-[13px] text-text-on-base-muted">{user.email}</p>
          <Button
            variant="on-base-quiet"
            size="sm"
            className="w-full justify-start"
            onClick={() => {
              onNavigate?.();
              void logout();
            }}
            leadingIcon={<LogOut aria-hidden="true" className="h-4 w-4" />}
          >
            Sign out
          </Button>
        </div>
      )}
    </>
  );
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent): void {
      if (containerRef.current?.contains(event.target as Node) === true) return;
      setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  if (user === null) return null;

  const initial = user.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.name} ${initial}`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
        className={cn(
          'flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-2',
          'hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none',
        )}
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-primary-subtle text-[13px] font-semibold text-primary-active"
        >
          {initial}
        </span>
        <span className="hidden max-w-[10rem] truncate text-[13px] font-medium text-ink sm:inline">
          {user.name}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-[var(--fm-z-nav)] mt-2 w-60 max-w-[calc(100vw-2rem)] overflow-hidden rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-modal)]"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-[13px] font-medium text-ink">{user.name}</p>
            <p className="truncate text-[13px] text-muted">{user.email}</p>
          </div>
          <Link
            role="menuitem"
            to="/settings"
            onClick={() => setOpen(false)}
            className="block min-h-11 px-3 py-3 text-sm text-ink hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Profile
          </Link>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className="block min-h-11 w-full px-3 py-3 text-left text-sm text-danger-text hover:bg-danger-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const agent = useAgentLink();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Close the mobile drawer on Escape or after a navigation.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  // Drawer keyboard behaviour: Escape closes, Tab cycles inside the dialog, and focus returns to
  // the menu button when it closes (UX_SPEC §10.3; the general a11y pass is T-084).
  useEffect(() => {
    if (!navOpen) return;

    const drawer = drawerRef.current;
    const focusables = (): HTMLElement[] =>
      Array.from(
        drawer?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    focusables()[0]?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        setNavOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      menuButtonRef.current?.focus();
    };
  }, [navOpen]);

  return (
    <div className="min-h-screen bg-surface lg:flex">
      {/* Session record + navigation: one mount for every authenticated route (T-057). */}
      <FocusSessionSync />

      <a
        href="#main-content"
        className="sr-only rounded-[var(--radius-control)] bg-card px-4 py-2 text-sm font-medium text-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[var(--fm-z-toast)] focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar — persistent at ≥1024 px, base fill (UX_SPEC §8). */}
      <aside className="sticky top-0 hidden h-screen w-[var(--fm-sidebar-w)] shrink-0 flex-col bg-base lg:flex">
        <SidebarContent />
      </aside>

      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-[var(--fm-z-sticky)]">
          {/* Global focus slot: renders nothing unless the Focus Agent reports FOCUSING. */}
          <FocusIndicator />

          <header className="border-b border-border bg-card">
            <div className="flex min-w-0 items-center gap-2 px-4 py-2.5 sm:gap-3 md:px-6">
              <button
                ref={menuButtonRef}
                type="button"
                aria-label="Open navigation"
                aria-expanded={navOpen}
                aria-controls="mobile-navigation"
                onClick={() => setNavOpen(true)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-ink hover:bg-primary-subtle focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none lg:hidden"
              >
                <Menu aria-hidden="true" className="h-5 w-5" />
              </button>

              <div className="flex min-w-0 items-center gap-2 lg:hidden">
                <Diamond aria-hidden="true" className="h-4 w-4 shrink-0 text-focus-strong" />
                <span className="hidden truncate text-sm font-semibold tracking-tight text-ink sm:inline">
                  Focus Mode
                </span>
              </div>

              <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
                <NotificationBell />
                <AgentStatusBadge />
                <AccountMenu />
              </div>
            </div>
          </header>
        </div>

        <main
          id="main-content"
          className="mx-auto w-full max-w-[var(--fm-content-max)] px-[var(--fm-page-pad-x)] py-6 pb-16"
        >
          {agent.helpCardVisible ? <AgentHelpCard onDismiss={agent.dismissHelpCard} /> : null}
          <Outlet />
        </main>
      </div>

      {/* Mobile drawer — slide-over below lg, closed by Escape, overlay click or navigation. */}
      {navOpen ? (
        <div className="fixed inset-0 z-[var(--fm-z-drawer)] lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 h-full w-full bg-ink/50"
            onClick={() => setNavOpen(false)}
          />
          <div
            ref={drawerRef}
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            className="absolute top-0 left-0 flex h-full w-[min(20rem,calc(100vw-3rem))] flex-col bg-base shadow-[var(--shadow-modal)]"
          >
            <div className="flex items-center justify-between gap-2 px-4 py-2">
              <span className="text-sm font-semibold text-white">Focus Mode</span>
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => setNavOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] text-text-on-base-muted hover:bg-nav-active-bg hover:text-white focus-visible:ring-2 focus-visible:ring-ring-on-base focus-visible:ring-offset-2 focus-visible:ring-offset-base focus-visible:outline-none"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            <SidebarContent onNavigate={() => setNavOpen(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
