/**
 * Labels Schema
 *
 * Workspace-level hierarchical tag system.
 * Stored as a JSON document since the tree structure is always loaded/saved as a whole.
 * Replaces: {workspace}/labels/config.json
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/** Label config (single-row table storing the full label tree as JSON) */
export const labelConfig = sqliteTable('label_config', {
  id: integer('id').primaryKey().default(1),
  version: integer('version').notNull().default(1),
  /** Full LabelConfig[] tree — nested children included */
  labels: text('labels', { mode: 'json' }).notNull(),
});
