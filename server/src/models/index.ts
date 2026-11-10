// server/src/models/index.ts — barrel for the nine Mongo models (TECHNICAL_DESIGN §4).
// A5's routes/controllers/services and A6's seed import from here (or from the individual
// `./X.ts` files) so the collection names, typed interfaces and enum arrays come from one place.
// Importing this barrel constructs every schema, which is what test helpers need before
// `Model.init()`; nothing here connects to MongoDB or performs I/O.

export { User, type IUser, type UserDocument } from './User.js';
export { Device, type IDevice, type DeviceDocument, type IDeviceCapabilities } from './Device.js';
export { Session, type ISession, type SessionDocument } from './Session.js';
export {
  Allowlist,
  type IAllowlist,
  type AllowlistDocument,
  MAX_USER_APPS,
  MAX_PROTECTED_APPS,
} from './Allowlist.js';
export { Schedule, type ISchedule, type ScheduleDocument } from './Schedule.js';
export { Preset, type IPreset, type PresetDocument } from './Preset.js';
export { ScheduleRun, type IScheduleRun, type ScheduleRunDocument } from './ScheduleRun.js';
export { Notification, type INotification, type NotificationDocument } from './Notification.js';
export { AgentLink, type IAgentLink, type AgentLinkDocument } from './AgentLink.js';

export {
  appEntrySchema,
  APP_KEY_PATTERN,
  cloneAppEntry,
  hasDuplicateAppKeys,
} from './app-entry.js';
export {
  buildProtectedAppEntries,
  PROTECTED_APP_ENTRIES,
  hasCompleteProtectedSet,
  missingProtectedKeys,
} from './protected-apps.js';
export * from './enums.js';
