/**
 * Automations History Schema
 *
 * Append-only event history for automation replay.
 * Replaces: {workspace}/automations-history.jsonl
 */

import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const automationHistory = sqliteTable('automation_history', {
  rowId: integer('rowid').primaryKey({ autoIncrement: true }),
  /** Matcher/automation identifier for per-automation retention */
  automationId: text('automation_id').notNull(),
  /** Full history entry as JSON */
  entry: text('entry', { mode: 'json' }).notNull(),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
}, (table) => [
  index('idx_history_automation').on(table.automationId),
  index('idx_history_created').on(table.createdAt),
]);
