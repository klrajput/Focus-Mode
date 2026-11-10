/*
 * Route table for the dashboard (T-020, TECHNICAL_DESIGN §3).
 * Public: `/`, `/login`, `/signup`. Everything else is inside `RequireAuth` + the AppShell.
 * `/admin` adds `RequireRole role="ADMIN"` (USER → /403); `/403` lives inside the shell so the
 * Focus Agent badge and focus-indicator slot stay visible; `*` is the standalone 404 page.
 * Route order matters only for the catch-all, which is last.
 */

import { Route, Routes } from 'react-router-dom';

import { RequireAuth, PublicOnly } from '../auth/require-auth';
import { RequireRole } from '../auth/require-role';
import { AppShell } from '../components/layout/app-shell';
import { AdminPage } from '../pages/admin';
import { AllowlistPage } from '../pages/allowlist';
import { DashboardPage } from '../pages/dashboard';
import { DevicesPage } from '../pages/devices';
import { FocusPage } from '../pages/focus';
import { ForbiddenPage } from '../pages/forbidden';
import { InsightsPage } from '../pages/insights';
import { LandingPage } from '../pages/landing';
import { LoginPage } from '../pages/login';
import { NotFoundPage } from '../pages/not-found';
import { SchedulesPage } from '../pages/schedules';
import { SettingsPage } from '../pages/settings';
import { SignupPage } from '../pages/signup';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />

      <Route element={<PublicOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/focus" element={<FocusPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/allowlist" element={<AllowlistPage />} />
          <Route path="/schedules" element={<SchedulesPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/settings" element={<SettingsPage />} />

          <Route element={<RequireRole role="ADMIN" />}>
            <Route path="/admin" element={<AdminPage />} />
          </Route>

          <Route path="/403" element={<ForbiddenPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
