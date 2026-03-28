/**
 * Database Module
 *
 * Public API for the SQLite storage layer.
 */

// Driver registration (call once at app startup)
export { autoRegisterDriver, registerDriver } from './driver.ts';

// Connection management
export {
  getWorkspaceDb,
  closeWorkspaceDb,
  closeAllConnections,
  isConnectionOpen,
} from './connection.ts';

// Driver types
export type { DrizzleDatabase } from './driver.ts';

// Change events
export { dbEvents, type DbEventMap } from './events.ts';

// Schema (re-export all tables)
export * from './schema/index.ts';
