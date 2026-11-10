// T-001 placeholder — shared module entry point, replaced by owner A2 in W1.
// It exists so the workspace graph builds and typechecks before the real protocol lands.

/**
 * Envelope version of the dashboard ↔ Focus Agent local-channel protocol.
 * A2 freezes the real message types in `shared/src/protocol.ts` (T-004).
 */
export const PROTOCOL_VERSION = 1;
