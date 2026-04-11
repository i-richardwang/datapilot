/**
 * Sessions Module
 *
 * Public exports for workspace-scoped session management.
 *
 * Sessions are stored in SQLite (workspace.db) with session directories
 * on disk for attachments, plans, data, downloads, and long_responses.
 */

// Types
export type {
  SessionStatus,
  SessionTokenUsage,
  StoredMessage,
  SessionConfig,
  StoredSession,
  SessionMetadata,
  SessionHeader,
  SessionPersistentField,
} from './types.ts';

// Field constants
export { SESSION_PERSISTENT_FIELDS } from './types.ts';

// Storage functions (SQLite-backed)
export {
  // Directory utilities
  ensureSessionsDir,
  ensureSessionDir,
  getSessionPath,
  getSessionFilePath,
  getSessionAttachmentsPath,
  getSessionPlansPath,
  ensureAttachmentsDir,
  // ID generation
  generateSessionId,
  // Session CRUD
  createSession,
  getOrCreateSessionById,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  clearSessionMessages,
  getOrCreateLatestSession,
  // Metadata updates
  updateSessionSdkId,
  updateSessionMetadata,
  canUpdateSdkCwd,
  flagSession,
  unflagSession,
  setSessionStatus,
  // Pending plan execution (Accept & Compact flow)
  setPendingPlanExecution,
  markCompactionComplete,
  markPendingPlanExecutionDispatched,
  clearPendingPlanExecution,
  getPendingPlanExecution,
  // Session filtering
  listFlaggedSessions,
  listCompletedSessions,
  listInboxSessions,
  // Archive management
  archiveSession,
  unarchiveSession,
  listArchivedSessions,
  listActiveSessions,
  deleteOldArchivedSessions,
  // Plan storage
  formatPlanAsMarkdown,
  parsePlanFromMarkdown,
  savePlanToFile,
  loadPlanFromFile,
  loadPlanFromPath,
  listPlanFiles,
  deletePlanFile,
  getMostRecentPlanFile,
} from './storage.db.ts';

// DB-mode persistence adapter (replaces file-based persistence queue)
export {
  sessionPersistenceQueue,
  getHeaderMetadataSignature,
} from './persistence-adapter-db.ts';

// JSONL helpers (still needed for bundle export/import)
export {
  readSessionHeader,
  readSessionJsonl,
  writeSessionJsonl,
  createSessionHeader,
} from './jsonl.ts';

// Field utilities
export { pickSessionFields } from './utils.ts';

// Slug generator utilities
export {
  generateDatePrefix,
  generateHumanSlug,
  generateUniqueSessionId,
  parseSessionId,
  isHumanReadableId,
} from './slug-generator.ts';

// Word lists (for customization if needed)
export { ADJECTIVES, NOUNS } from './word-lists.ts';

// Session ID validation (security)
export {
  validateSessionId,
  sanitizeSessionId,
} from './validation.ts';

// Session bundle (export/import/dispatch)
export type {
  SessionBundle,
  BundleFile,
  BundleBranchInfo,
  DispatchMode,
} from './bundle.ts';
export {
  serializeSession,
  validateBundle,
  MAX_BUNDLE_SIZE_BYTES,
} from './bundle.ts';

// Per-turn token usage tracking
export {
  saveTurnUsage,
  getSessionTurnUsage,
  getSessionUsageSummary,
  type TurnUsageRecord,
  type SessionUsageSummary,
} from './turn-usage.db.ts';
