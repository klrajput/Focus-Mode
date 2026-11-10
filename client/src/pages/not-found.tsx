/*
 * `*` — 404 page (UX_SPEC §4.11). Rendered synchronously by the catch-all route, outside the
 * AppShell by design; it works for signed-out visitors too (a bad link must not bounce to login).
 * Both actions are buttons using the router, so no fake navigation or dead links.
 */

import { useNavigate } from 'react-router-dom';
import { Compass, Diamond } from 'lucide-react';

import { Button } from '../components/ui/button';
import { useDocumentTitle } from '../hooks/use-document-title';

export function NotFoundPage() {
  useDocumentTitle('404 — Page not found');
  const navigate = useNavigate();

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-[var(--fm-page-pad-x)] py-10">
      <div className="w-full max-w-[520px]">
        <p className="mb-6 flex items-center justify-center gap-2 text-ink">
          <Diamond aria-hidden="true" className="h-5 w-5 text-focus-strong" />
          <span className="text-[15px] font-semibold tracking-tight">Focus Mode</span>
        </p>

        <div className="rounded-[var(--radius-card)] border border-border bg-card p-6 text-center shadow-[var(--shadow-card)] sm:p-8">
          <span className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-[var(--radius-pill)] bg-primary-subtle text-primary-active">
            <Compass aria-hidden="true" className="h-6 w-6" />
          </span>
          <h1 className="text-[28px] leading-[1.2] font-semibold text-ink">
            404 — We couldn&apos;t find that page
          </h1>
          <p className="mx-auto mt-2 max-w-prose text-[15px] text-muted">
            The link may be wrong or the page may have moved.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button onClick={() => navigate('/dashboard')}>Back to dashboard</Button>
            <Button variant="secondary" onClick={() => navigate('/')}>
              Go home
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
