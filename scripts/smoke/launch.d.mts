// scripts/smoke/launch.d.mts — type declarations for the plain-ESM smoke launcher.
// The launcher itself must stay dependency-free JavaScript (it runs on a bare CI runner before
// any TypeScript tooling is involved), but the agent test suite imports its pure helpers, so
// they are declared here instead of duplicating the logic in TypeScript.

export declare const REPO_ROOT: string;
export declare const AGENT_DIR: string;
export declare const DEFAULT_ORIGIN: string;
export declare const LAUNCH_TIMEOUT_MS: number;
export declare const SMOKE_READY_PATTERN: RegExp;
export declare function parseSmokeReady(line: string): number | null;
export declare function verifySmokeFrames(hello: unknown, state: unknown): void;
export declare function pickFreePort(): Promise<number>;
export declare function resolveElectronBinary(): string;
