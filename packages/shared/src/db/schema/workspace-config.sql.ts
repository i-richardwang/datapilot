/**
 * Workspace Config Schema
 *
 * Workspace metadata and defaults.
 * Replaces: {workspace}/config.json
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/** Workspace config (single-row table storing the full config as JSON) */
export const workspaceConfig = sqliteTable('workspace_config', {
  id: integer('id').primaryKey().default(1),
  /** Full WorkspaceConfig object as JSON */
  config: text('config', { mode: 'json' }).notNull(),
});
