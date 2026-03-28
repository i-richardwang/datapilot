/**
 * Batch State Manager — SQLite Backend
 *
 * Drop-in replacement for batch-state-manager.ts.
 * Reads/writes batch state and test results from workspace.db instead of
 * batch-state-{id}.json and batch-test-result-{id}.json files.
 */

import { eq } from 'drizzle-orm';
import { BATCH_STATE_FILE_PREFIX, BATCH_TEST_RESULT_FILE_PREFIX } from './constants.ts';
import { join } from 'node:path';
import { getWorkspaceDb } from '../db/connection.ts';
import { dbEvents } from '../db/events.ts';
import { batchState as batchStateTable, batchTestResults } from '../db/schema/batches.sql.ts';
import type { BatchState, BatchItemState, BatchProgress, TestBatchResult, PersistedTestResult } from './types.ts';

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
  let runningItems = 0;
  let pendingItems = 0;

  for (const item of Object.values(state.items)) {
    switch (item.status) {
      case 'completed':
        completedItems++;
        break;
      case 'failed':
      case 'skipped':
        failedItems++;
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
// Test Result Persistence
// ============================================================================

/**
 * Get the file path for a persisted test result (kept for compatibility).
 */
export function getTestResultPath(workspaceRootPath: string, batchId: string): string {
  return join(workspaceRootPath, `${BATCH_TEST_RESULT_FILE_PREFIX}${batchId}.json`);
}

/**
 * Save a test result to DB with a config hash for invalidation.
 */
export function saveTestResult(
  workspaceRootPath: string,
  result: TestBatchResult,
  configHash: string,
): void {
  const db = getWorkspaceDb(workspaceRootPath);
  const existing = db.select()
    .from(batchTestResults)
    .where(eq(batchTestResults.batchId, result.batchId))
    .get();

  if (existing) {
    db.update(batchTestResults)
      .set({ result, configHash, persistedAt: Date.now() })
      .where(eq(batchTestResults.batchId, result.batchId))
      .run();
  } else {
    db.insert(batchTestResults).values({
      batchId: result.batchId,
      result,
      configHash,
      persistedAt: Date.now(),
    }).run();
  }
}

/**
 * Load a persisted test result from DB.
 * Returns null if no result exists.
 */
export function loadTestResult(workspaceRootPath: string, batchId: string): PersistedTestResult | null {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select().from(batchTestResults).where(eq(batchTestResults.batchId, batchId)).get();
  if (!row) return null;

  return {
    result: row.result as TestBatchResult,
    configHash: row.configHash,
    persistedAt: row.persistedAt,
  };
}

/**
 * Delete a persisted test result from DB.
 */
export function deleteTestResult(workspaceRootPath: string, batchId: string): void {
  const db = getWorkspaceDb(workspaceRootPath);
  db.delete(batchTestResults).where(eq(batchTestResults.batchId, batchId)).run();
}
