// focus/drivers/app-key.ts — stable, privacy-safe app keys derived from OS identifiers.
// A `WindowRef.appKey` is only a lower-case slug (`[a-z0-9-]{2,40}`, shared appKeySchema); it is
// derived from a bundle id, executable name or WM_CLASS-like process name — never from a window
// title and never from a URL (INV-6). Identifiers are still carried in `WindowRef.identifier`, so
// protected-app matching never depends on the slug being unique.

import { APP_KEY_PATTERN } from '@focus-mode/shared';

/** Single-character or empty segments are widened to a valid key instead of being dropped. */
function sanitize(candidate: string): string | undefined {
  const slug = candidate
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (APP_KEY_PATTERN.test(slug)) return slug;
  if (slug.length === 1) return `app-${slug}`;
  return undefined;
}

/**
 * macOS: `com.google.Chrome` → `chrome`, `com.microsoft.VSCode` → `vscode`,
 * `com.apple.finder` → `finder`. Falls back to the whole identifier when the last segment is
 * unusable.
 */
export function appKeyFromBundleId(bundleId: string): string | undefined {
  const trimmed = bundleId.trim();
  if (trimmed.length === 0) return undefined;
  const segments = trimmed.split('.').filter((segment) => segment.length > 0);
  const last = segments.at(-1);
  if (last !== undefined) {
    const fromLast = sanitize(last);
    if (fromLast !== undefined) return fromLast;
  }
  return sanitize(trimmed);
}

/**
 * Windows / Linux: `Code.exe` → `code`, `C:\…\Slack.exe` → `slack`, `google-chrome` →
 * `google-chrome`. Only the executable basename is used, never the full command line.
 */
export function appKeyFromExecutableName(executable: string): string | undefined {
  const trimmed = executable.trim();
  if (trimmed.length === 0) return undefined;
  const basename = trimmed.replace(/^.*[\\/]/, '');
  const withoutExtension = basename.replace(/\.exe$/i, '');
  return sanitize(withoutExtension) ?? sanitize(basename) ?? sanitize(trimmed);
}
