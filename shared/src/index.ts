// shared/src/index.ts — public barrel for `@focus-mode/shared`, the single import point for the
// dashboard, API and Focus Agent. Re-exports the frozen protocol, error codes, protected set,
// REST schemas and transport types. Nothing here performs I/O, so every package can import it.

export * from './errors.js';
export * from './types.js';
export * from './schemas/index.js';
export * from './protected.js';
export * from './protocol.js';
