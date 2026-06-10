/**
 * Batch State Manager — SQLite Backend
 *
 * Drop-in replacement for batch-state-manager.ts.
 * Reads/writes batch state from workspace.db instead of batch-state-{id}.json files.
 *
 * Persistence layout (since migration 0006_batch_items):
 *   - `batch_state` holds the BatchState meta (status, totals, timestamps) as
 *     JSON with an EMPTY `items` record.
 *   - `batch_items` holds one row per item, ordered by `position`.
 *
 * Legacy rows (pre-split) carry the full items record inline in the meta blob;
 * they are migrated to `batch_items` the first time they are loaded. Keeping
 * items out of the blob means a single item's status change is one row write
 * instead of re-serializing a multi-MB JSON document — on 30k-item batches the
 * old shape saturated the server event loop (every dispatch/completion paid
 * O(totalItems)).
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import { BATCH_STATE_FILE_PREFIX } from './constants.ts';
import { join } from 'node:path';
import { getWorkspaceDb } from '../db/connection.ts';
import type { DrizzleDatabase } from '../db/driver.ts';
import { dbEvents } from '../db/events.ts';
import { batchState as batchStateTable, batchItems as batchItemsTable } from '../db/schema/batches.sql.ts';
import type { BatchState, BatchItemState, BatchItemStatus, BatchProgress, BatchItemsPage } from './types.ts';

// SQLite bind-variable budget guard: 10 columns per row, keep batches well
// under the 32766 SQLITE_MAX_VARIABLE_NUMBER default.
const INSERT_CHUNK_SIZE = 500;

// ============================================================================
// Batch State Path (compatibility)
// ============================================================================

/**
 * Get the file path for a batch state file (kept for compatibility).
 */
export function getBatchStatePath(workspaceRootPath: string, batchId: string): string {
  return join(workspaceRootPath, `${BATCH_STATE_FILE_PREFIX}${batchId}.json`);
}

// ============================================================================
// Internal helpers
// ============================================================================

type BatchItemRow = typeof batchItemsTable.$inferSelect;

function rowToItemState(row: BatchItemRow): BatchItemState {
  return {
    status: row.status as BatchItemStatus,
    sessionId: row.sessionId ?? undefined,
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    error: row.error ?? undefined,
    summary: row.summary ?? undefined,
    retryCount: row.retryCount,
  };
}

function itemStateToRow(batchId: string, itemId: string, position: number, item: BatchItemState) {
  return {
    batchId,
    itemId,
    position,
    status: item.status,
    sessionId: item.sessionId ?? null,
    startedAt: item.startedAt ?? null,
    completedAt: item.completedAt ?? null,
    error: item.error ?? null,
    summary: item.summary ?? null,
    retryCount: item.retryCount ?? 0,
  };
}

/** Meta blob written to `batch_state` — same shape as BatchState, items emptied. */
function toMetaBlob(state: BatchState): BatchState {
  return { ...state, items: {} };
}

function readItemRows(db: DrizzleDatabase, batchId: string): BatchItemRow[] {
  return db.select()
    .from(batchItemsTable)
    .where(eq(batchItemsTable.batchId, batchId))
    .orderBy(asc(batchItemsTable.position))
    .all();
}

/** Replace all item rows for a batch with the given items record (object order = position). */
function replaceItemRows(db: DrizzleDatabase, batchId: string, items: Record<string, BatchItemState>): void {
  db.delete(batchItemsTable).where(eq(batchItemsTable.batchId, batchId)).run();
  const rows = Object.entries(items).map(([itemId, item], position) =>
    itemStateToRow(batchId, itemId, position, item));
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    db.insert(batchItemsTable).values(rows.slice(i, i + INSERT_CHUNK_SIZE)).run();
  }
}

/**
 * One-time migration for a legacy meta blob that still carries items inline:
 * write the items to `batch_items` and strip them from the blob.
 */
function migrateLegacyBlob(db: DrizzleDatabase, meta: BatchState): void {
  db.transaction((tx) => {
    replaceItemRows(tx, meta.batchId, meta.items);
    tx.update(batchStateTable)
      .set({ state: toMetaBlob(meta), updatedAt: Date.now() })
      .where(eq(batchStateTable.batchId, meta.batchId))
      .run();
  });
}

/** Load a BatchState from a meta row, migrating a legacy inline-items blob if found. */
function stateFromMetaRow(db: DrizzleDatabase, meta: BatchState): BatchState {
  const itemRows = readItemRows(db, meta.batchId);
  if (itemRows.length === 0 && meta.items && Object.keys(meta.items).length > 0) {
    // Legacy blob written before the items split — migrate, then serve from the blob.
    migrateLegacyBlob(db, meta);
    return meta;
  }

  const items: Record<string, BatchItemState> = {};
  for (const row of itemRows) {
    items[row.itemId] = rowToItemState(row);
  }
  return { ...meta, items };
}

// ============================================================================
// Batch State CRUD
// ============================================================================

/**
 * Load batch state from DB. Returns null if no state exists.
 */
export function loadBatchState(workspaceRootPath: string, batchId: string): BatchState | null {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select().from(batchStateTable).where(eq(batchStateTable.batchId, batchId)).get();
  if (!row) return null;
  return stateFromMetaRow(db, row.state as BatchState);
}

/**
 * Load every persisted batch state in the workspace.
 *
 * Used by startup reconcile to find batches the server left `running` when it
 * died without a graceful shutdown. Returns all rows regardless of status; the
 * caller filters.
 */
export function loadAllBatchStates(workspaceRootPath: string): BatchState[] {
  const db = getWorkspaceDb(workspaceRootPath);
  return db.select().from(batchStateTable).all()
    .map((row) => stateFromMetaRow(db, row.state as BatchState));
}

/**
 * Save full batch state to DB: meta blob plus a wholesale replace of all item
 * rows. Use for bulk transitions (start/reset). For incremental changes prefer
 * saveBatchMeta / saveBatchItemStates — they don't pay O(totalItems).
 */
export function saveBatchState(workspaceRootPath: string, state: BatchState): void {
  const db = getWorkspaceDb(workspaceRootPath);
  db.transaction((tx) => {
    upsertMeta(tx, state);
    replaceItemRows(tx, state.batchId, state.items);
  });
  dbEvents.emit('batch:state', state.batchId);
}

function upsertMeta(db: DrizzleDatabase, state: BatchState): void {
  const blob = toMetaBlob(state);
  const existing = db.select({ batchId: batchStateTable.batchId })
    .from(batchStateTable)
    .where(eq(batchStateTable.batchId, state.batchId))
    .get();

  if (existing) {
    db.update(batchStateTable)
      .set({ state: blob, updatedAt: Date.now() })
      .where(eq(batchStateTable.batchId, state.batchId))
      .run();
  } else {
    db.insert(batchStateTable).values({
      batchId: state.batchId,
      state: blob,
      updatedAt: Date.now(),
    }).run();
  }
}

/**
 * Save only the batch meta (status, totals, timestamps). O(1) — does not touch
 * item rows.
 */
export function saveBatchMeta(workspaceRootPath: string, state: BatchState): void {
  const db = getWorkspaceDb(workspaceRootPath);
  upsertMeta(db, state);
  dbEvents.emit('batch:state', state.batchId);
}

/**
 * Persist the current state of specific items (rows must already exist —
 * all incremental mutations target items created by a prior full save).
 * O(changed items), not O(totalItems).
 */
export function saveBatchItemStates(workspaceRootPath: string, state: BatchState, itemIds: string[]): void {
  if (itemIds.length === 0) return;
  const db = getWorkspaceDb(workspaceRootPath);
  db.transaction((tx) => {
    for (const itemId of itemIds) {
      const item = state.items[itemId];
      if (!item) continue;
      tx.update(batchItemsTable)
        .set({
          status: item.status,
          sessionId: item.sessionId ?? null,
          startedAt: item.startedAt ?? null,
          completedAt: item.completedAt ?? null,
          error: item.error ?? null,
          summary: item.summary ?? null,
          retryCount: item.retryCount ?? 0,
        })
        .where(and(eq(batchItemsTable.batchId, state.batchId), eq(batchItemsTable.itemId, itemId)))
        .run();
    }
  });
  dbEvents.emit('batch:state', state.batchId);
}

/**
 * Append new items (discovered in the data source after the batch was first
 * persisted) behind the existing ones, preserving order.
 */
export function appendBatchItems(workspaceRootPath: string, state: BatchState, itemIds: string[]): void {
  if (itemIds.length === 0) return;
  const db = getWorkspaceDb(workspaceRootPath);
  db.transaction((tx) => {
    const maxRow = tx.select({ max: sql<number | null>`MAX(${batchItemsTable.position})` })
      .from(batchItemsTable)
      .where(eq(batchItemsTable.batchId, state.batchId))
      .get();
    let position = (maxRow?.max ?? -1) + 1;
    const rows = [];
    for (const itemId of itemIds) {
      const item = state.items[itemId];
      if (!item) continue;
      rows.push(itemStateToRow(state.batchId, itemId, position++, item));
    }
    for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
      tx.insert(batchItemsTable).values(rows.slice(i, i + INSERT_CHUNK_SIZE)).run();
    }
  });
  dbEvents.emit('batch:state', state.batchId);
}

/**
 * Create initial batch state for a set of item IDs.
 * Pure function — no DB access.
 */
export function createInitialBatchState(batchId: string, itemIds: string[]): BatchState {
  const items: Record<string, BatchItemState> = {};
  for (const id of itemIds) {
    items[id] = { status: 'pending', retryCount: 0 };
  }

  return {
    batchId,
    status: 'pending',
    totalItems: itemIds.length,
    items,
  };
}

/**
 * Update an item's state within a batch state (mutates in place).
 * Pure function — no DB access.
 */
export function updateItemState(
  state: BatchState,
  itemId: string,
  update: Partial<BatchItemState>,
): void {
  const item = state.items[itemId];
  if (!item) return;
  Object.assign(item, update);
}

/**
 * Compute progress summary from batch state.
 * Pure function — no DB access.
 */
export function computeProgress(state: BatchState): BatchProgress {
  let completedItems = 0;
  let failedItems = 0;
  let skippedItems = 0;
  let runningItems = 0;
  let pendingItems = 0;

  for (const item of Object.values(state.items)) {
    switch (item.status) {
      case 'completed':
        completedItems++;
        break;
      case 'failed':
        failedItems++;
        break;
      case 'skipped':
        skippedItems++;
        break;
      case 'running':
        runningItems++;
        break;
      case 'pending':
        pendingItems++;
        break;
    }
  }

  return {
    batchId: state.batchId,
    status: state.status,
    totalItems: state.totalItems,
    completedItems,
    failedItems,
    skippedItems,
    runningItems,
    pendingItems,
  };
}

/**
 * Compute progress for a persisted batch without loading its items into
 * memory — one COUNT(*) GROUP BY over `batch_items`. Falls back to the legacy
 * inline-items blob when the batch predates the items split. Returns null if
 * no state exists.
 */
export function loadBatchProgress(workspaceRootPath: string, batchId: string): BatchProgress | null {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select().from(batchStateTable).where(eq(batchStateTable.batchId, batchId)).get();
  if (!row) return null;
  const meta = row.state as BatchState;

  const counts = db.select({
    status: batchItemsTable.status,
    count: sql<number>`COUNT(*)`,
  })
    .from(batchItemsTable)
    .where(eq(batchItemsTable.batchId, batchId))
    .groupBy(batchItemsTable.status)
    .all();

  if (counts.length === 0 && meta.items && Object.keys(meta.items).length > 0) {
    // Legacy blob not yet migrated — compute from the inline items.
    return computeProgress(meta);
  }

  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const { status, count } of counts) {
    byStatus[status] = count;
    total += count;
  }

  return {
    batchId,
    status: meta.status,
    totalItems: total,
    completedItems: byStatus['completed'] ?? 0,
    failedItems: byStatus['failed'] ?? 0,
    skippedItems: byStatus['skipped'] ?? 0,
    runningItems: byStatus['running'] ?? 0,
    pendingItems: byStatus['pending'] ?? 0,
  };
}

/**
 * Check if a batch is done (all items completed or failed, none pending/running).
 * Pure function — no DB access.
 */
export function isBatchDone(state: BatchState): boolean {
  for (const item of Object.values(state.items)) {
    if (item.status === 'pending' || item.status === 'running') {
      return false;
    }
  }
  return true;
}

/**
 * Delete batch state from DB.
 */
export function deleteBatchState(workspaceRootPath: string, batchId: string): void {
  const db = getWorkspaceDb(workspaceRootPath);
  db.transaction((tx) => {
    tx.delete(batchItemsTable).where(eq(batchItemsTable.batchId, batchId)).run();
    tx.delete(batchStateTable).where(eq(batchStateTable.batchId, batchId)).run();
  });
}

// ============================================================================
// Paginated Item Query
// ============================================================================

/**
 * Return a page of items from a batch state.
 * Used by the GET_ITEMS RPC to avoid sending all items over IPC.
 *
 * When `filterStatus` is provided, only items matching that status are
 * considered for paging — `total` reflects the filtered count and
 * `runningOffset` is -1 because frontier navigation is not meaningful
 * under a status filter.
 */
export function getBatchItemsPage(
  state: BatchState,
  offset: number,
  limit: number,
  filterStatus?: BatchItemStatus,
): BatchItemsPage {
  const allEntries = Object.entries(state.items)
  const entries = filterStatus
    ? allEntries.filter(([, item]) => item.status === filterStatus)
    : allEntries
  const total = entries.length
  const clampedOffset = total === 0 ? 0 : Math.max(0, Math.min(offset, total - 1))
  const sliced = entries.slice(clampedOffset, clampedOffset + limit)
  const runningOffset = filterStatus
    ? -1
    : allEntries.findIndex(([, item]) => item.status === 'running')
  return {
    items: sliced.map(([id, state]) => ({ id, state })),
    total,
    offset: clampedOffset,
    limit,
    runningOffset,
  }
}
