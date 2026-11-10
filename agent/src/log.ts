// log.ts — logger contract shared by every Electron-free agent module.
// Keeping this interface free of Electron means `journal.ts`, `controller.ts`, `allowlist.ts` and
// `link/server.ts` stay unit-testable; `log-electron.ts` adapts electron-log in the main process.
// INV-6/NFR-016: callers must never pass window titles, URLs, pairing codes or tokens here.

export interface Logger {
  error(message: string, ...meta: readonly unknown[]): void;
  warn(message: string, ...meta: readonly unknown[]): void;
  info(message: string, ...meta: readonly unknown[]): void;
  debug(message: string, ...meta: readonly unknown[]): void;
}

/** Silent logger for tests and as a safe default when a module has no injected logger. */
export const noopLogger: Logger = Object.freeze({
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
});
