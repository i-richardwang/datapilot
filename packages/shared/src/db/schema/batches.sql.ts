/**
 * Batch State Schema
 *
 * Tracks batch processing job state.
 * Replaces: {workspace}/batch-state-{batchId}.json
 */

import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * Batch processing job state — meta only.
 *
 * The `state` column stores the BatchState object WITHOUT its `items` record
 * (items live in `batch_items`, one row each). Legacy rows written before the
 * split still carry items inline; they are migrated to `batch_items` lazily on
 * first load. Storing all items as one JSON blob meant every per-item status
 * change re-serialized the whole batch (multi-MB for 30k-item batches) on the
 * server event loop.
 */
export const batchState = sqliteTable('batch_state', {
  batchId: text('batch_id').primaryKey(),
  /** BatchState meta as JSON (items excluded; legacy rows may include them) */
  state: text('state', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
});

/**
 * Per-item batch state. `position` preserves data-source order — item paging
 * and the running-frontier offset depend on stable ordering.
 */
export const batchItems = sqliteTable('batch_items', {
  batchId: text('batch_id').notNull(),
  itemId: text('item_id').notNull(),
  position: integer('position', { mode: 'number' }).notNull(),
  status: text('status').notNull().default('pending'),
  sessionId: text('session_id'),
  startedAt: integer('started_at', { mode: 'number' }),
  completedAt: integer('completed_at', { mode: 'number' }),
  error: text('error'),
  summary: text('summary'),
  retryCount: integer('retry_count', { mode: 'number' }).notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.batchId, table.itemId] }),
  index('idx_batch_items_batch_pos').on(table.batchId, table.position),
  index('idx_batch_items_batch_status').on(table.batchId, table.status),
]);
