/*
 * `/focus` (UX_SPEC §4.4, T-031 owns the calm full-screen view).
 * W1 can only render the honest empty state: no Focus Agent link exists yet, so there is no
 * session, no countdown and no End Focus action to fake. The copy is the approved empty-state
 * sentence; the countdown ring and live session panel arrive with T-031/T-045.
 */

import { useNavigate } from 'react-router-dom';
import { Timer } from 'lucide-react';

import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';
import { PageHeader } from '../components/ui/page-header';

export function FocusPage() {
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        title="Focus"
        description="Focus on one thing. Everything else steps aside — visibly and reversibly."
      />

      <EmptyState
        icon={Timer}
        title="No focus session is running."
        description="Start a session from the dashboard once your Focus Agent is connected. This page will then show the countdown, what is staying open and an always-available End Focus."
        action={
          <>
            <Button onClick={() => navigate('/dashboard')}>Back to dashboard</Button>
            <Button variant="secondary" onClick={() => navigate('/devices')}>
              Open Devices
            </Button>
          </>
        }
        footnote="The live countdown ring and End Focus land with T-031 / T-045 (W2)."
      />
    </>
  );
}
