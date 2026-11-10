// shared/src/protected.ts — the hard-coded protected set per OS (INV-3, FR-008, TD §7.5).
// Browsers, the Focus Agent itself and OS-critical processes can never be removed or moved aside
// by focus. This list is static; the Focus Agent merges runtime additions (the OS default browser,
// DEC-006) and the server seeds these entries into `allowlists.protectedApps` on creation.

import { ERROR_CODES } from './errors.js';
import type { AppEntry } from './schemas/app.js';
import type { OsName } from './schemas/common.js';

/** Which app-entry field carries the identifiers for an OS (`macOS` → `mac`, …). */
const OS_ENTRY_FIELD: Readonly<Record<OsName, 'win' | 'mac' | 'linux'>> = Object.freeze({
  macOS: 'mac',
  windows: 'win',
  linux: 'linux',
});

// ---------------------------------------------------------------------------
// All known browsers (PDF SAFE-1). Safari/Arc are macOS-only, so they resolve only there.
// ---------------------------------------------------------------------------

const BROWSER_ENTRIES: readonly AppEntry[] = [
  {
    key: 'chrome',
    label: 'Google Chrome',
    win: ['chrome.exe'],
    mac: ['com.google.Chrome'],
    linux: ['google-chrome', 'google-chrome-stable'],
  },
  {
    key: 'chromium',
    label: 'Chromium',
    win: ['chromium.exe'],
    mac: ['org.chromium.Chromium'],
    linux: ['chromium', 'chromium-browser'],
  },
  {
    key: 'edge',
    label: 'Microsoft Edge',
    win: ['msedge.exe'],
    mac: ['com.microsoft.edgemac'],
    linux: ['microsoft-edge', 'microsoft-edge-stable'],
  },
  {
    key: 'firefox',
    label: 'Mozilla Firefox',
    win: ['firefox.exe'],
    mac: ['org.mozilla.firefox'],
    linux: ['firefox', 'firefox-esr'],
  },
  {
    key: 'brave',
    label: 'Brave',
    win: ['brave.exe'],
    mac: ['com.brave.Browser'],
    linux: ['brave-browser'],
  },
  {
    key: 'opera',
    label: 'Opera',
    win: ['opera.exe'],
    mac: ['com.operasoftware.Opera'],
    linux: ['opera'],
  },
  {
    key: 'vivaldi',
    label: 'Vivaldi',
    win: ['vivaldi.exe'],
    mac: ['com.vivaldi.Vivaldi'],
    linux: ['vivaldi-stable'],
  },
  {
    key: 'arc',
    label: 'Arc',
    win: ['Arc.exe'],
    mac: ['company.thebrowser.Browser'],
  },
  {
    key: 'safari',
    label: 'Safari',
    mac: ['com.apple.Safari'],
  },
];

/** The Focus Agent must never hide itself — it owns the tray escape hatch (INV-5, FR-022). */
const FOCUS_AGENT_ENTRY: AppEntry = {
  key: 'focus-agent',
  label: 'Focus Agent',
  win: ['Focus Agent.exe', 'focus-agent.exe'],
  mac: ['com.focusmode.agent'],
  linux: ['focus-mode-agent'],
};

// ---------------------------------------------------------------------------
// OS-critical processes (TECHNICAL_DESIGN §7.5). Task Manager / Activity Monitor are protected
// on purpose so the user can always kill a stuck Focus Agent.
// ---------------------------------------------------------------------------

const WINDOWS_CRITICAL_ENTRIES: readonly AppEntry[] = [
  { key: 'explorer', label: 'Windows Explorer', win: ['explorer.exe'] },
  { key: 'dwm', label: 'Desktop Window Manager', win: ['dwm.exe'] },
  { key: 'csrss', label: 'Client Server Runtime', win: ['csrss.exe'] },
  { key: 'winlogon', label: 'Windows Logon', win: ['winlogon.exe'] },
  { key: 'search-host', label: 'Windows Search', win: ['SearchHost.exe'] },
  {
    key: 'start-menu-experience-host',
    label: 'Start Menu',
    win: ['StartMenuExperienceHost.exe'],
  },
  {
    key: 'shell-experience-host',
    label: 'Windows Shell',
    win: ['ShellExperienceHost.exe'],
  },
  { key: 'text-input-host', label: 'Text Input Host', win: ['TextInputHost.exe'] },
  { key: 'lock-app', label: 'Lock Screen', win: ['LockApp.exe'] },
  { key: 'task-manager', label: 'Task Manager', win: ['Taskmgr.exe'] },
  {
    key: 'application-frame-host',
    label: 'Application Frame Host',
    win: ['ApplicationFrameHost.exe'],
  },
];

const MACOS_CRITICAL_ENTRIES: readonly AppEntry[] = [
  { key: 'finder', label: 'Finder', mac: ['com.apple.finder'] },
  { key: 'dock', label: 'Dock', mac: ['com.apple.dock'] },
  { key: 'system-ui-server', label: 'SystemUIServer', mac: ['com.apple.systemuiserver'] },
  { key: 'login-window', label: 'loginwindow', mac: ['com.apple.loginwindow'] },
  { key: 'control-center', label: 'Control Center', mac: ['com.apple.controlcenter'] },
  {
    key: 'notification-center',
    label: 'Notification Center',
    mac: ['com.apple.notificationcenterui'],
  },
  { key: 'spotlight', label: 'Spotlight', mac: ['com.apple.Spotlight'] },
  { key: 'activity-monitor', label: 'Activity Monitor', mac: ['com.apple.ActivityMonitor'] },
];

const LINUX_CRITICAL_ENTRIES: readonly AppEntry[] = [
  { key: 'gnome-shell', label: 'GNOME Shell', linux: ['gnome-shell'] },
  { key: 'plasma-shell', label: 'KDE Plasma Shell', linux: ['plasmashell'] },
  { key: 'xfce-panel', label: 'Xfce Panel', linux: ['xfce4-panel'] },
  { key: 'mate-panel', label: 'MATE Panel', linux: ['mate-panel'] },
  { key: 'cinnamon', label: 'Cinnamon', linux: ['cinnamon'] },
  { key: 'lxpanel', label: 'LXPanel', linux: ['lxpanel'] },
];

/** Settings/System Settings is the same key on Windows and macOS; one entry covers both. */
const SYSTEM_SETTINGS_ENTRY: AppEntry = {
  key: 'system-settings',
  label: 'System Settings',
  win: ['SystemSettings.exe'],
  mac: ['com.apple.systempreferences'],
};

const PROTECTED_ENTRIES: readonly AppEntry[] = Object.freeze([
  ...BROWSER_ENTRIES,
  FOCUS_AGENT_ENTRY,
  ...WINDOWS_CRITICAL_ENTRIES,
  ...MACOS_CRITICAL_ENTRIES,
  ...LINUX_CRITICAL_ENTRIES,
  SYSTEM_SETTINGS_ENTRY,
]);

function entriesForOs(os: OsName): readonly AppEntry[] {
  const field = OS_ENTRY_FIELD[os];
  return Object.freeze(PROTECTED_ENTRIES.filter((entry) => (entry[field]?.length ?? 0) > 0));
}

/** Protected entries that apply on each supported OS. Consumers must treat these as read-only. */
export const PROTECTED_BY_OS: Readonly<Record<OsName, readonly AppEntry[]>> = Object.freeze({
  macOS: entriesForOs('macOS'),
  windows: entriesForOs('windows'),
  linux: entriesForOs('linux'),
});

/** Every protected key across all OSes (server-side allow-list guard, docs, tests). */
export const ALL_PROTECTED_KEYS: readonly string[] = Object.freeze(
  [...new Set(PROTECTED_ENTRIES.map((entry) => entry.key))].sort(),
);

/** Key of the Focus Agent entry; exported so the agent can recognise itself without duplication. */
export const FOCUS_AGENT_APP_KEY = 'focus-agent';

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

export function protectedKeysForOs(os: OsName): readonly string[] {
  return Object.freeze(PROTECTED_BY_OS[os].map((entry) => entry.key));
}

/** True when the key belongs to the static protected set (all OSes unless `os` is given). */
export function isProtectedKey(key: string, os?: OsName): boolean {
  if (!os) return ALL_PROTECTED_KEYS.includes(key);
  return PROTECTED_BY_OS[os].some((entry) => entry.key === key);
}

/**
 * True when an allow-list entry resolves to a protected app on `os` — by key, or by one of its
 * per-OS executable/bundle identifiers (case-insensitive). Identifier matching is what stops a
 * hostile client from re-adding the browser under a new key (INV-3).
 */
export function isProtectedEntry(entry: AppEntry, os: OsName): boolean {
  const field = OS_ENTRY_FIELD[os];
  const protectedEntries = PROTECTED_BY_OS[os];
  const protectedKeys = new Set(protectedEntries.map((protectedEntry) => protectedEntry.key));
  if (protectedKeys.has(entry.key)) return true;
  const protectedIdentifiers = new Set(
    protectedEntries.flatMap((protectedEntry) =>
      (protectedEntry[field] ?? []).map(normalizeIdentifier),
    ),
  );
  return (entry[field] ?? []).some((identifier) =>
    protectedIdentifiers.has(normalizeIdentifier(identifier)),
  );
}

/** Thrown by `assertNoProtectedRemoval`; the `code` matches the API error vocabulary. */
export class ProtectedEntryError extends Error {
  readonly code = ERROR_CODES.PROTECTED_ENTRY;
  readonly removedKeys: readonly string[];

  constructor(removedKeys: readonly string[]) {
    super(`Protected entries cannot be removed: ${removedKeys.join(', ')}`);
    this.name = 'ProtectedEntryError';
    this.removedKeys = [...removedKeys];
  }
}

/**
 * INV-3 guard for a protected-list update: every protected key present in `currentKeys` must
 * still be present in `nextKeys`. Removing or replacing protected entries throws
 * `ProtectedEntryError` (API code PROTECTED_ENTRY); user apps are unaffected.
 */
export function assertNoProtectedRemoval(
  currentKeys: readonly string[],
  nextKeys: readonly string[],
): void {
  const next = new Set(nextKeys);
  const removedKeys = currentKeys.filter((key) => !next.has(key) && isProtectedKey(key));
  if (removedKeys.length > 0) throw new ProtectedEntryError(removedKeys);
}
