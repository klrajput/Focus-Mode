/*
 * `/403` — role-mismatch page, rendered inside the AppShell so the Focus Agent badge and the focus
 * indicator slot stay visible (UX_SPEC §3, §4.11). It is reached from `RequireRole` and is also the
 * destination for API `FORBIDDEN` navigation. Copy is verbatim from the wireframe; the page offers
 * a way forward (dashboard) and a way out (sign out) instead of a dead end.
 */

import { useNavigate } from 'react-router-dom';
import { Octagon } from 'lucide-react';

import { useAuth } from '../auth/auth-context';
import { Button } from '../components/ui/button';
import { Card, CardBody } from '../components/ui/card';
import { PageHeader } from '../components/ui/page-header';

export function ForbiddenPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="403 — You don't have access"
        description="This page is for administrators."
      />

      <Card className="max-w-2xl">
        <CardBody>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-danger-subtle text-danger">
              <Octagon aria-hidden="true" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] text-muted">
                If that&apos;s wrong, ask an admin to update your role.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button onClick={() => navigate('/dashboard')}>Back to dashboard</Button>
                <Button variant="secondary" onClick={() => void logout()}>
                  Sign out
                </Button>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
