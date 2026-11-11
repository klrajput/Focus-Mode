/*
 * Route table for the dashboard (T-020, TECHNICAL_DESIGN §3).
 * Public: `/`, `/login`, `/signup`. Everything else is inside `RequireAuth` + the AppShell.
 * `/admin` adds `RequireRole role="ADMIN"` (USER → /403); `/403` lives inside the shell so the
 * Focus Agent badge and focus-indicator slot stay visible; `*` is the standalone 404 page.
 * Route order matters only for the catch-all, which is last.
 *
 * W7 / task-48 — route-level code splitting:
 *   · The shell (`AppShell`), the auth guards, `/dashboard` (the post-login landing page),
 *     `/login`, `/signup`, `/403` and the 404 page stay eager so the first authenticated paint,
 *     navigation and auth flows never wait on a second network round-trip.
 *   · The heavier product pages (`/focus`, `/devices`, `/allowlist`, `/schedules`, `/insights`,
 *     `/settings`, `/admin`) and the public landing page are `React.lazy` chunks. `/insights`
 *     pulls Recharts and `/admin` pulls the four tab surfaces, which is where the entry-bundle win
 *     comes from. Each lazy element is wrapped in its own `Suspense`, so resolving a page keeps
 *     the already-painted shell (sidebar/header) and only the `<Outlet />` region shows the
 *     accessible `RouteFallback`.
 * Copy is untouched: the lazy boundary only changes *when* a page's module loads, never what it
 * renders after loading, so the E2E-guarded strings remain the contract.
 */

import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';

import { RequireAuth, PublicOnly } from '../auth/require-auth';
import { RequireRole } from '../auth/require-role';
import { AppShell } from '../components/layout/app-shell';
import { DashboardPage } from '../pages/dashboard';
import { ForbiddenPage } from '../pages/forbidden';
import { LoginPage } from '../pages/login';
import { NotFoundPage } from '../pages/not-found';
import { SignupPage } from '../pages/signup';
import { RouteFallback } from './route-fallback';

// Named-export adapters: `React.lazy` requires a default export while the pages intentionally use
// named exports. The dynamic `import()` is what Vite/Rolldown turns into a separate chunk.
const LandingPage = lazy(async () => {
  const module = await import('../pages/landing');
  return { default: module.LandingPage };
});

const FocusPage = lazy(async () => {
  const module = await import('../pages/focus');
  return { default: module.FocusPage };
});

const DevicesPage = lazy(async () => {
  const module = await import('../pages/devices');
  return { default: module.DevicesPage };
});

const AllowlistPage = lazy(async () => {
  const module = await import('../pages/allowlist');
  return { default: module.AllowlistPage };
});

const SchedulesPage = lazy(async () => {
  const module = await import('../pages/schedules');
  return { default: module.SchedulesPage };
});

const InsightsPage = lazy(async () => {
  const module = await import('../pages/insights');
  return { default: module.InsightsPage };
});

const SettingsPage = lazy(async () => {
  const module = await import('../pages/settings');
  return { default: module.SettingsPage };
});

const AdminPage = lazy(async () => {
  const module = await import('../pages/admin');
  return { default: module.AdminPage };
});

/** One suspense boundary per lazy route so the shell stays mounted while a page chunk loads. */
function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <LazyRoute>
            <LandingPage />
          </LazyRoute>
        }
      />

      <Route element={<PublicOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route
            path="/focus"
            element={
              <LazyRoute>
                <FocusPage />
              </LazyRoute>
            }
          />
          <Route
            path="/devices"
            element={
              <LazyRoute>
                <DevicesPage />
              </LazyRoute>
            }
          />
          <Route
            path="/allowlist"
            element={
              <LazyRoute>
                <AllowlistPage />
              </LazyRoute>
            }
          />
          <Route
            path="/schedules"
            element={
              <LazyRoute>
                <SchedulesPage />
              </LazyRoute>
            }
          />
          <Route
            path="/insights"
            element={
              <LazyRoute>
                <InsightsPage />
              </LazyRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <LazyRoute>
                <SettingsPage />
              </LazyRoute>
            }
          />

          <Route element={<RequireRole role="ADMIN" />}>
            <Route
              path="/admin"
              element={
                <LazyRoute>
                  <AdminPage />
                </LazyRoute>
              }
            />
          </Route>

          <Route path="/403" element={<ForbiddenPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
