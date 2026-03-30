/**
 * Batch State Manager
 *
 * Handles persistence and computation of batch processing state.
 * State files are stored as batch-state-{id}.json in the workspace root.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { BATCH_STATE_FILE_PREFIX, BATCH_TEST_RESULT_FILE_PREFIX } from './constants.ts'
import type { BatchState, BatchItemState, BatchItemStatus, BatchProgress, BatchItemsPage, TestBatchResult, PersistedTestResult } from './types.ts'

/**
 * Get the file path for a batch state file.
 */
export function getBatchStatePath(workspaceRootPath: string, batchId: string): string {
  return join(workspaceRootPath, `${BATCH_STATE_FILE_PREFIX}${batchId}.json`)
}

/**
 * Load batch state from disk. Returns null if no state file exists.
 */
export function loadBatchState(workspaceRootPath: string, batchId: string): BatchState | null {
  const path = getBatchStatePath(workspaceRootPath, batchId)
  if (!existsSync(path)) return null

  try {
    const content = readFileSync(path, 'utf-8')
    return JSON.parse(content) as BatchState
  } catch {
    return null
  }
}

/**
 * Save batch state to disk.
 */
export function saveBatchState(workspaceRootPath: string, state: BatchState): void {
  const path = getBatchStatePath(workspaceRootPath, state.batchId)
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8')
}

/**
 * Create initial batch state for a set of item IDs.
 */
export function createInitialBatchState(batchId: string, itemIds: string[]): BatchState {
  const items: Record<string, BatchItemState> = {}
  for (const id of itemIds) {
    items[id] = { status: 'pending', retryCount: 0 }
  }

  return {
    batchId,
    status: 'pending',
    totalItems: itemIds.length,
    items,
  }
}

/**
 * Update an item's state within a batch state (mutates in place).
 */
export function updateItemState(
  state: BatchState,
  itemId: string,
  update: Partial<BatchItemState>,
): void {
  const item = state.items[itemId]
  if (!item) return

  Object.assign(item, update)
}

/**
 * Compute progress summary from batch state.
 */
export function computeProgress(state: BatchState): BatchProgress {
  let completedItems = 0
  let failedItems = 0
  let runningItems = 0
  let pendingItems = 0

  for (const item of Object.values(state.items)) {
    switch (item.status) {
      case 'completed':
        completedItems++
        break
      case 'failed':
      case 'skipped':
        failedItems++
        break
      case 'running':
        runningItems++
        break
      case 'pending':
        pendingItems++
        break
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
  }
}

/**
 * Check if a batch is done (all items completed or failed, none pending/running).
 */
export function isBatchDone(state: BatchState): boolean {
  for (const item of Object.values(state.items)) {
    if (item.status === 'pending' || item.status === 'running') {
      return false
    }
  }
  return true
}

// ============================================================================
// Paginated Item Query
// ============================================================================

/**
 * Return a page of items from a batch state.
 * Used by the GET_ITEMS RPC to avoid sending all items over IPC.
 */
export function getBatchItemsPage(
  state: BatchState,
  offset: number,
  limit: number,
): BatchItemsPage {
  const allEntries = Object.entries(state.items)
  const total = allEntries.length
  const clampedOffset = total === 0 ? 0 : Math.max(0, Math.min(offset, total - 1))
  const sliced = allEntries.slice(clampedOffset, clampedOffset + limit)
  const runningOffset = allEntries.findIndex(([, item]) => item.status === 'running')
  return {
    items: sliced.map(([id, state]) => ({ id, state })),
    total,
    offset: clampedOffset,
    limit,
    runningOffset,
  }
}

// ============================================================================
// Test Result Persistence
// ============================================================================

/**
 * Get the file path for a persisted test result.
 */
export function getTestResultPath(workspaceRootPath: string, batchId: string): string {
  return join(workspaceRootPath, `${BATCH_TEST_RESULT_FILE_PREFIX}${batchId}.json`)
}

/**
 * Save a test result to disk with a config hash for invalidation.
 */
export function saveTestResult(
  workspaceRootPath: string,
  result: TestBatchResult,
  configHash: string,
): void {
  const persisted: PersistedTestResult = { result, configHash, persistedAt: Date.now() }
  const path = getTestResultPath(workspaceRootPath, result.batchId)
  writeFileSync(path, JSON.stringify(persisted, null, 2), 'utf-8')
}

/**
 * Load a persisted test result from disk.
 * Returns null if no file exists or it cannot be parsed.
 */
export function loadTestResult(workspaceRootPath: string, batchId: string): PersistedTestResult | null {
  const path = getTestResultPath(workspaceRootPath, batchId)
  if (!existsSync(path)) return null

  try {
    const content = readFileSync(path, 'utf-8')
    return JSON.parse(content) as PersistedTestResult
  } catch {
    return null
  }
}

/**
 * Delete a persisted test result from disk.
 */
export function deleteTestResult(workspaceRootPath: string, batchId: string): void {
  const path = getTestResultPath(workspaceRootPath, batchId)
  try { unlinkSync(path) } catch { /* file may not exist */ }
}
