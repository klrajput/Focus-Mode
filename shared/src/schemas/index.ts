// shared/src/schemas/index.ts — barrel for the REST payload schemas.
// Client forms, server `validate()` middleware and the contract tests all import from here, so
// there is exactly one definition per payload (NFR-001). The local/cloud channel lives in
// `../protocol.ts` to keep this barrel free of transport concerns.

export * from './common.js';
export * from './app.js';
export * from './auth.js';
export * from './user.js';
export * from './device.js';
export * from './allowlist.js';
export * from './schedule.js';
export * from './session.js';
export * from './insights.js';
export * from './admin.js';
