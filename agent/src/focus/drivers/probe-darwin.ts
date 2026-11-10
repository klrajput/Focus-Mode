// focus/drivers/probe-darwin.ts — manual, READ-ONLY macOS probe for T-053 evidence.
// Run from the repository root:
//   npx tsx agent/src/focus/drivers/probe-darwin.ts
// It performs exactly two one-shot osascript calls (enumeration + default browser) and prints
// what the driver would hand to the controller. It NEVER calls asideWindows()/restore(), so no
// application is hidden: the destructive hide/unhide test belongs to the A0/T-101 checklist.

import { pathToFileURL } from 'node:url';
import { noopLogger } from '../../log.js';
import { DarwinDriver } from './darwin.js';

export interface DarwinProbeResult {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly capabilities: ReturnType<DarwinDriver['capabilities']>;
  readonly visibleAppCount: number;
  readonly windows: Awaited<ReturnType<DarwinDriver['listWindows']>>;
  readonly defaultBrowser: Awaited<ReturnType<DarwinDriver['resolveDefaultBrowser']>>;
}

/** Enumerates regular apps and the default browser; no window is moved (INV-6-safe output). */
export async function runDarwinProbe(): Promise<DarwinProbeResult> {
  const driver = new DarwinDriver({ logger: noopLogger });
  const capabilities = driver.capabilities();
  const windows = await driver.listWindows();
  const defaultBrowser = await driver.resolveDefaultBrowser();
  return {
    platform: process.platform,
    arch: process.arch,
    capabilities,
    visibleAppCount: windows.length,
    windows,
    defaultBrowser,
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runDarwinProbe()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
