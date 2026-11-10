// Per-route document title (UX_SPEC §10.7: `document.title` reflects the page). Kept in one small
// hook so every page sets the same suffix and an accessible title never drifts from the `<h1>`.

import { useEffect } from 'react';

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} — Focus Mode`;
  }, [title]);
}
