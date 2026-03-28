/**
 * Workspace Config Storage — SQLite Backend
 *
 * Only covers the workspace config (config.json) portion of workspace storage.
 * Path utilities, create/delete, discovery, and other filesystem operations
 * remain in storage.ts since they are inherently filesystem-based.
 *
 * This module provides DB-backed replacements for:
 *   - loadWorkspaceConfig()
 *   - saveWorkspaceConfig()
 */

import { getWorkspaceDb } from '../db/connection.ts';
import { workspaceConfig } from '../db/schema/workspace-config.sql.ts';
import { dbEvents } from '../db/events.ts';
import { expandPath, toPortablePath } from '../utils/paths.ts';
import type { WorkspaceConfig } from './types.ts';

// ─── Config Operations (SQLite) ─────────────────────────────────────────────

/**
 * Load workspace configuration from SQLite.
 * Returns null if no config exists (workspace not initialized).
 * Expands portable path variables on read.
 */
export function loadWorkspaceConfig(rootPath: string): WorkspaceConfig | null {
  const db = getWorkspaceDb(rootPath);
  const row = db.select().from(workspaceConfig).get();

  if (!row) return null;

  const config = row.config as WorkspaceConfig;

  // Expand portable paths
  if (config.defaults?.workingDirectory) {
    config.defaults.workingDirectory = expandPath(config.defaults.workingDirectory);
  }

  return config;
}

/**
 * Save workspace configuration to SQLite.
 * Converts paths to portable format before storing.
 * Sets updatedAt timestamp automatically.
 */
export function saveWorkspaceConfig(rootPath: string, config: WorkspaceConfig): void {
  const db = getWorkspaceDb(rootPath);

  // Make paths portable for storage
  const configToStore = { ...config };
  configToStore.updatedAt = Date.now();

  if (configToStore.defaults?.workingDirectory) {
    configToStore.defaults = {
      ...configToStore.defaults,
      workingDirectory: toPortablePath(configToStore.defaults.workingDirectory),
    };
  }

  db.delete(workspaceConfig).run();
  db.insert(workspaceConfig).values({
    id: 1,
    config: configToStore,
  }).run();

  dbEvents.emit('workspace:config');
}
