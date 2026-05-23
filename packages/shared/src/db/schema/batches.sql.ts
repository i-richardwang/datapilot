/**
 * Batch State Schema
 *
 * Tracks batch processing job state.
 * Replaces: {workspace}/batch-state-{batchId}.json
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/** Batch processing job state */
export const batchState = sqliteTable('batch_state', {
  batchId: text('batch_id').primaryKey(),
  /** Full BatchState object as JSON */
  state: text('state', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
});
