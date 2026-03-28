/**
 * Batch State Schema
 *
 * Tracks batch processing job state and test results.
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

/** Batch test results (persisted across restarts, invalidated on config change) */
export const batchTestResults = sqliteTable('batch_test_results', {
  batchId: text('batch_id').primaryKey(),
  /** Full test result object as JSON */
  result: text('result', { mode: 'json' }).notNull(),
  /** Hash of batch config — used to invalidate stale results */
  configHash: text('config_hash').notNull(),
  persistedAt: integer('persisted_at', { mode: 'number' }).notNull(),
});
