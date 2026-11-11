/*
 * Route-level suspense fallback (W7 / task-48).
 *
 * Lazy route pages suspend while their chunk downloads, so every `React.lazy` element in
 * `app-routes.tsx` is wrapped in `<Suspense fallback={<RouteFallback />}>`. The fallback:
 *   · reuses the approved static `Spinner`, which already carries `role="status"` + `aria-live`
 *     and the UX_SPEC §9 "Loading…" text plus a non-animated icon (no looping animation);
 *   · reserves the same `min-h-[60vh]` block the auth gate uses, so resolving a chunk does not
 *     collapse then expand the page (no layout shift beyond the page's own content height);
 *   · adds no route copy — the lazy pages keep every E2E-guarded string verbatim.
 */

import { Spinner } from '../components/ui/loading';

export function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-[var(--fm-page-pad-x)]">
      <Spinner label="Loading page…" />
    </div>
  );
}
