// cloud/message-id.ts — short correlation ids for agent → cloud frames (envelope `id`, §5.1).
// One counter per process, shared by the socket (heartbeat) and the session reporter so every
// outbound frame has a distinct id without either module owning a second, drifting generator.
// The id is opaque to the cloud (it is not a session or device identifier) and carries no PII.

let cloudMessageCounter = 0;

/** Distinct `c-<base36 time>-<counter>` id for one agent → cloud message. */
export function nextCloudMessageId(): string {
  cloudMessageCounter += 1;
  return `c-${Date.now().toString(36)}-${cloudMessageCounter.toString(36)}`;
}
