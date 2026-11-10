// focus/drivers/source-guard.test.ts — static tripwires for the W3 OS drivers (INV-6, SEC).
// Behavioural tests live next to each driver; this file fails the build if a future edit
// reintroduces a window-title API, a shell string, top-level koffi loading, Electron coupling or
// a destructive shortcut. The scans are scoped to `agent/src/focus/drivers/**` so they stay
// green even while sibling W3 workers edit the rest of the agent.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DRIVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DRIVER_FILES = readdirSync(DRIVER_DIR)
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
  .sort();

function read(file: string): string {
  return readFileSync(path.join(DRIVER_DIR, file), 'utf8');
}

/** Removes block and full-line comments so prose cannot mask (or trip) a code scan. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

const SOURCES = new Map(DRIVER_FILES.map((file) => [file, read(file)]));
const CODE = new Map(DRIVER_FILES.map((file) => [file, codeOnly(read(file))]));

describe('driver source inventory', () => {
  it('contains every real driver, the fake and the selection module', () => {
    expect(DRIVER_FILES).toEqual(
      expect.arrayContaining([
        'app-key.ts',
        'darwin.ts',
        'exec.ts',
        'fake.ts',
        'index.ts',
        'linux-x11.ts',
        'probe-darwin.ts',
        'unavailable.ts',
        'win32.ts',
      ]),
    );
  });

  it('gives every module a header comment', () => {
    for (const file of DRIVER_FILES) {
      expect(read(file).startsWith('// focus/drivers/'), file).toBe(true);
    }
  });
});

describe('no window titles or URLs (INV-6)', () => {
  it('never references a title-reading OS API', () => {
    for (const [file, source] of SOURCES) {
      for (const banned of [
        'GetWindowText',
        'kCGWindowName',
        'CGWindowListCopyWindowInfo',
        'AXTitle',
        'AXUIElementCopyAttributeValue',
        'System Events',
        'windowTitle',
        '.title',
      ]) {
        expect(source.includes(banned), `${file} contains ${banned}`).toBe(false);
      }
    }
  });

  it('never parses a title column', () => {
    const linux = CODE.get('linux-x11.ts') ?? '';
    // Only columns[0] (id), columns[1] (desktop, ignored) and columns[2] (pid) may be read.
    expect(linux).toMatch(/columns\[0\]/);
    expect(linux).toMatch(/columns\[2\]/);
    expect(linux).not.toMatch(/columns\[(?:3|4|5|6)\]/);
    expect(linux).not.toMatch(/\btitle\b/i);
  });

  it('keeps the macOS probe strictly read-only', () => {
    const probe = CODE.get('probe-darwin.ts') ?? '';
    expect(probe).not.toMatch(/asideWindows\s*\(/);
    expect(probe).not.toMatch(/\.restore\s*\(/);
    expect(probe).not.toMatch(/\.hide\s*\(/);
  });
});

describe('no shell strings (SEC)', () => {
  it('uses execFile argument arrays only', () => {
    for (const [file, source] of SOURCES) {
      expect(source, file).not.toMatch(/\bexec\(/);
      expect(source, file).not.toMatch(/\bexecSync\(/);
      expect(source, file).not.toMatch(/shell:\s*true/);
    }
    const exec = read('exec.ts');
    expect(exec).toMatch(/execFile\(/);
    expect(exec).not.toMatch(/\bspawn\(/);
  });

  it('never uses the destructive shell "show everything" shortcut', () => {
    for (const [file, source] of SOURCES) {
      expect(source, file).not.toMatch(/\bWin\+D\b/);
      expect(source, file).not.toMatch(/show desktop/i);
    }
  });
});

describe('no Electron coupling and no eager native loading', () => {
  it('keeps every driver importable without Electron', () => {
    for (const [file, source] of SOURCES) {
      expect(source, file).not.toMatch(/from\s+['"]electron['"]/);
      expect(source, file).not.toMatch(/require\(\s*['"]electron['"]\s*\)/);
    }
  });

  it('loads koffi lazily and only for win32', () => {
    const win32Source = read('win32.ts');
    expect(win32Source).not.toMatch(/^\s*import[^\n]*koffi/m);
    expect(win32Source).toMatch(/createRequire\(import\.meta\.url\)/);
    for (const [file, source] of CODE) {
      if (file === 'win32.ts') continue;
      expect(source, file).not.toMatch(/koffi/i);
    }
  });
});

describe('driver-specific invariants', () => {
  it('macOS uses one-shot JXA files and regular-activation apps only', () => {
    const darwin = read('darwin.ts');
    expect(darwin).toMatch(/'JavaScript'/);
    expect(darwin).toMatch(/'--'/);
    expect(darwin).toContain('activationPolicy');
    expect(darwin).toContain('Number(app.hidden)');
    expect(darwin).toContain('runningApplications');
    // Bundle ids are the journal handle: the ref mapping pushes the bundle id as `handle`.
    expect(darwin).toMatch(/handle:\s*bundleId/);
  });

  it('Windows implements the §7.5 pipeline and both ShowWindow commands', () => {
    const win32 = read('win32.ts');
    for (const token of [
      'EnumWindows',
      'IsWindowVisible',
      'IsIconic',
      'GW_OWNER',
      'GWL_EXSTYLE',
      'WS_EX_TOOLWINDOW',
      'DWMWA_CLOAKED',
      'GetWindowThreadProcessId',
      'OpenProcess',
      'QueryFullProcessImageNameW',
      'SW_SHOWMINNOACTIVE',
      'SW_RESTORE',
    ]) {
      expect(win32, token).toContain(token);
    }
  });

  it('Linux uses wmctrl/xdotool with validated ids and both restore commands', () => {
    const linux = read('linux-x11.ts');
    for (const token of [
      'wmctrl',
      'xdotool',
      "'-l', '-p'",
      "'windowminimize'",
      "'-b', 'remove,hidden'",
      "'windowmap'",
    ]) {
      expect(linux, token).toContain(token);
    }
  });

  it('index.ts wires every real driver behind the platform switch', () => {
    const index = read('index.ts');
    for (const token of ['DarwinDriver', 'Win32Driver', 'LinuxX11Driver', 'UnavailableDriver']) {
      expect(index, token).toContain(token);
    }
    expect(index).toMatch(/isPackaged/);
    expect(index).toMatch(/FakeDriverNotAllowedError/);
  });
});
