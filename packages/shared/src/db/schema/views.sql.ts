/**
 * Views Schema
 *
 * Workspace-level session view filters (expression-based dynamic filters).
 * Replaces: {workspace}/views.json
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/** Views config (single-row table storing the full views array as JSON) */
export const viewsConfig = sqliteTable('views_config', {
  id: integer('id').primaryKey().default(1),
  version: integer('version').notNull().default(1),
  /** Full ViewConfig[] array */
  views: text('views', { mode: 'json' }).notNull(),
});
