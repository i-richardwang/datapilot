/**
 * SQLite Connection Manager
 *
 * Manages a cache of Drizzle database instances — one per .db file path.
 * Each workspace gets its own `workspace.db`, initialized with optimal
 * SQLite pragmas on first access.
 *
 * All operations are synchronous after driver registration (see driver.ts).
 *
 * Connection lifecycle:
 *   getWorkspaceDb(rootPath)   → creates or returns cached connection
 *   closeWorkspaceDb(rootPath) → closes and removes from cache (call before workspace deletion)
 *   closeAllConnections()      → closes all connections (call on app exit)
 */

import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { sql } from 'drizzle-orm';
import { createDrizzleDatabase, closeDrizzleDatabase, type DrizzleDatabase } from './driver.ts';
import { runMigrations } from './migrate.ts';

const WORKSPACE_DB_FILENAME = 'workspace.db';

/** Cache of open database connections, keyed by absolute .db file path */
const connections = new Map<string, DrizzleDatabase>();

/**
 * Apply SQLite performance and safety pragmas.
 *
 * - WAL: Write-Ahead Logging enables concurrent reads during writes
 * - synchronous=NORMAL: balanced durability/performance (WAL provides crash safety)
 * - busy_timeout=5000: wait up to 5s for locks instead of failing immediately
 * - cache_size=-64000: 64MB page cache for large session histories
 * - foreign_keys=ON: enforce referential integrity (e.g., cascade deletes)
 */
function applyPragmas(db: DrizzleDatabase): void {
  db.run(sql`PRAGMA journal_mode = WAL`);
  db.run(sql`PRAGMA synchronous = NORMAL`);
  db.run(sql`PRAGMA busy_timeout = 5000`);
  db.run(sql`PRAGMA cache_size = -64000`);
  db.run(sql`PRAGMA foreign_keys = ON`);
}

/**
 * Get (or create) a Drizzle database instance for a workspace.
 *
 * Synchronous — requires prior driver registration via autoRegisterDriver().
 *
 * On first access for a given workspace:
 * 1. Ensures the workspace directory exists
 * 2. Creates the SQLite database file
 * 3. Applies performance pragmas
 * 4. Runs pending schema migrations
 */
export function getWorkspaceDb(workspaceRootPath: string): DrizzleDatabase {
  const dbPath = join(workspaceRootPath, WORKSPACE_DB_FILENAME);

  const existing = connections.get(dbPath);
  if (existing) return existing;

  // Ensure directory exists
  if (!existsSync(workspaceRootPath)) {
    mkdirSync(workspaceRootPath, { recursive: true });
  }

  const db = createDrizzleDatabase(dbPath);
  applyPragmas(db);
  runMigrations(db);
  connections.set(dbPath, db);
  return db;
}

/**
 * Close a workspace's database connection and remove it from cache.
 * Call this before deleting a workspace directory to release the file lock.
 */
export function closeWorkspaceDb(workspaceRootPath: string): void {
  const dbPath = join(workspaceRootPath, WORKSPACE_DB_FILENAME);
  const db = connections.get(dbPath);
  if (db) {
    closeDrizzleDatabase(db);
    connections.delete(dbPath);
  }
}

/**
 * Close all open database connections.
 * Call this on application exit to ensure clean shutdown.
 */
export function closeAllConnections(): void {
  for (const [, db] of connections) {
    closeDrizzleDatabase(db);
  }
  connections.clear();
}

/**
 * Check if a workspace database connection is currently open.
 */
export function isConnectionOpen(workspaceRootPath: string): boolean {
  const dbPath = join(workspaceRootPath, WORKSPACE_DB_FILENAME);
  return connections.has(dbPath);
}
