/**
 * Batch State Manager — SQLite Backend
 *
 * Drop-in replacement for batch-state-manager.ts.
 * Reads/writes batch state from workspace.db instead of batch-state-{id}.json files.
 */

import { eq } from 'drizzle-orm';
import { BATCH_STATE_FILE_PREFIX } from './constants.ts';
import { join } from 'node:path';
import { getWorkspaceDb } from '../db/connection.ts';
import { dbEvents } from '../db/events.ts';
import { batchState as batchStateTable } from '../db/schema/batches.sql.ts';
import type { BatchState, BatchItemState, BatchItemStatus, BatchProgress, BatchItemsPage } from './types.ts';

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
// Batch State CRUD
// ============================================================================

/**
 * Load batch state from DB. Returns null if no state exists.
 */
export function loadBatchState(workspaceRootPath: string, batchId: string): BatchState | null {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select().from(batchStateTable).where(eq(batchStateTable.batchId, batchId)).get();
  if (!row) return null;
  return row.state as BatchState;
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
  return db.select().from(batchStateTable).all().map((row) => row.state as BatchState);
}

/**
 * Save batch state to DB.
 */
export function saveBatchState(workspaceRootPath: string, state: BatchState): void {
  const db = getWorkspaceDb(workspaceRootPath);
  const existing = db.select()
    .from(batchStateTable)
    .where(eq(batchStateTable.batchId, state.batchId))
    .get();

  if (existing) {
    db.update(batchStateTable)
      .set({ state, updatedAt: Date.now() })
      .where(eq(batchStateTable.batchId, state.batchId))
      .run();
  } else {
    db.insert(batchStateTable).values({
      batchId: state.batchId,
      state,
      updatedAt: Date.now(),
    }).run();
  }

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
  db.delete(batchStateTable).where(eq(batchStateTable.batchId, batchId)).run();
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

