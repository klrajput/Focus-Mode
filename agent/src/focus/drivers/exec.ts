// focus/drivers/exec.ts — the only process-spawning primitives the focus drivers may use.
// Every OS command is run with `execFile` and an argument *array*: no shell, no string
// interpolation, so a bundle id / window id / PID can never become shell syntax (SEC rules,
// hardening.test.ts). Executables are resolved on PATH explicitly instead of trusting the
// shell, so `capabilities()` can report a missing runtime dependency honestly (FR-005).

import { execFile } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import path from 'node:path';

/** Result of a successful external command; `stdout` is the only field drivers consume. */
export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

/** Injected in tests so no unit test ever spawns a real process. */
export type CommandRunner = (file: string, args: readonly string[]) => Promise<CommandResult>;

/** Raised when an OS command exits non-zero or cannot be spawned. Carries no stdout. */
export class CommandError extends Error {
  readonly command: string;
  readonly exitCode: number | undefined;

  constructor(command: string, exitCode: number | undefined, detail: string) {
    super(
      `${command} failed${exitCode === undefined ? '' : ` with exit code ${exitCode}`}: ${detail}`,
    );
    this.name = 'CommandError';
    this.command = command;
    this.exitCode = exitCode;
  }
}

export interface RunCommandOptions {
  readonly timeoutMs?: number;
  readonly maxBufferBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BUFFER_BYTES = 512 * 1024;

/**
 * Runs `file` with `args` directly (never through a shell). Rejects with `CommandError` on a
 * non-zero exit; the error text is bounded and comes from stderr only.
 */
export function runCommand(
  file: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  return new Promise<CommandResult>((resolve, reject) => {
    execFile(
      file,
      [...args],
      { timeout, maxBuffer, encoding: 'utf8', windowsHide: true },
      (error, stdout, stderr) => {
        if (error !== null) {
          const exitCode = typeof error.code === 'number' ? error.code : undefined;
          const detail = stderr.trim().slice(0, 300) || error.message.slice(0, 300);
          reject(new CommandError(path.basename(file), exitCode, detail));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

/**
 * Resolves an executable from an explicit PATH value (plus absolute candidates), checking the
 * execute bit. Returns `undefined` instead of throwing so callers can degrade to
 * `capabilities.focus = 'unsupported'` with a reason.
 */
export function findExecutable(
  name: string,
  pathValue: string | undefined,
  extraCandidates: readonly string[] = [],
): string | undefined {
  const candidates: string[] = [];
  if (pathValue !== undefined && pathValue.length > 0) {
    for (const directory of pathValue.split(path.delimiter)) {
      if (directory.length > 0) candidates.push(path.join(directory, name));
    }
  }
  candidates.push(...extraCandidates);
  for (const candidate of candidates) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Not present / not executable: keep looking.
    }
  }
  return undefined;
}
