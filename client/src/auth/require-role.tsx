/*
 * Role guard for `/admin` (T-020, FR-019, UX_SPEC §4.10).
 * A USER who navigates to an ADMIN route is routed to the `/403` page inside the AppShell; the API
 * still answers 403 FORBIDDEN regardless, because the client guard is UX only, never security.
 */

import type { Role } from '@focus-mode/shared';
import { Navigate, Outlet } from 'react-router-dom';

import { PageLoading } from '../components/ui/loading';
import { useAuth } from './auth-context';

export interface RequireRoleProps {
  role: Role;
}

export function RequireRole({ role }: RequireRoleProps) {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return <PageLoading label="Checking your access…" />;
  }

  if (user === null) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== role) {
    return <Navigate to="/403" replace />;
  }

  return <Outlet />;
}
