import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { and, eq } from 'drizzle-orm'
import { autoRegisterDriver } from '../db/driver.ts'
import { getWorkspaceDb } from '../db/connection.ts'
import { batchState as batchStateTable, batchItems as batchItemsTable } from '../db/schema/batches.sql.ts'
import {
  getBatchStatePath,
  loadBatchState,
  loadBatchProgress,
  saveBatchState,
  saveBatchMeta,
  saveBatchItemStates,
  appendBatchItems,
  createInitialBatchState,
  updateItemState,
  computeProgress,
  isBatchDone,
  getBatchItemsPage,
} from './batch-state-manager.db.ts'
import type { BatchState } from './types.ts'

beforeAll(async () => {
  await autoRegisterDriver();
});

describe('batch-state-manager', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'batch-state-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('getBatchStatePath', () => {
    it('should return correct path', () => {
      const path = getBatchStatePath('/workspace', 'abc123')
      expect(path).toBe('/workspace/batch-state-abc123.json')
    })
  })

  describe('createInitialBatchState', () => {
    it('should create state with all items pending', () => {
      const state = createInitialBatchState('batch1', ['a', 'b', 'c'])
      expect(state.batchId).toBe('batch1')
      expect(state.status).toBe('pending')
      expect(state.totalItems).toBe(3)
      expect(Object.keys(state.items)).toHaveLength(3)
      expect(state.items['a']).toEqual({ status: 'pending', retryCount: 0 })
      expect(state.items['b']).toEqual({ status: 'pending', retryCount: 0 })
    })
  })

  describe('itemOrder', () => {
    it('should preserve source order for integer-like ids across save/load', () => {
      const state = createInitialBatchState('order1', ['3', '1', '4', '2'])
      expect(state.itemOrder).toEqual(['3', '1', '4', '2'])
      // The items record itself cannot carry this order — JS objects iterate
      // integer-like keys in ascending numeric order. This is exactly why
      // itemOrder exists.
      expect(Object.keys(state.items)).toEqual(['1', '2', '3', '4'])

      saveBatchState(tempDir, state)
      const loaded = loadBatchState(tempDir, 'order1')!
      expect(loaded.itemOrder).toEqual(['3', '1', '4', '2'])
    })

    it('should follow externally reordered positions and survive a full save', () => {
      const state = createInitialBatchState('order2', ['1', '2', '3'])
      saveBatchState(tempDir, state)

      // Simulate an external position reorder (e.g. shuffling pending items
      // directly in the DB): swap items '1' and '3'.
      const db = getWorkspaceDb(tempDir)
      db.update(batchItemsTable).set({ position: 100 })
        .where(and(eq(batchItemsTable.batchId, 'order2'), eq(batchItemsTable.itemId, '1'))).run()
      db.update(batchItemsTable).set({ position: 0 })
        .where(and(eq(batchItemsTable.batchId, 'order2'), eq(batchItemsTable.itemId, '3'))).run()

      const loaded = loadBatchState(tempDir, 'order2')!
      expect(loaded.itemOrder).toEqual(['3', '2', '1'])

      // A subsequent full save must persist that order, not reset it to
      // Object.keys (numeric) order.
      saveBatchState(tempDir, loaded)
      expect(loadBatchState(tempDir, 'order2')!.itemOrder).toEqual(['3', '2', '1'])
    })

    it('appendBatchItems should keep itemOrder in sync', () => {
      const state = createInitialBatchState('order3', ['2', '10'])
      saveBatchState(tempDir, state)

      state.items['1'] = { status: 'pending', retryCount: 0 }
      state.totalItems++
      appendBatchItems(tempDir, state, ['1'])

      expect(state.itemOrder).toEqual(['2', '10', '1'])
      expect(loadBatchState(tempDir, 'order3')!.itemOrder).toEqual(['2', '10', '1'])
    })
  })

  describe('saveBatchState / loadBatchState', () => {
    it('should persist and load state', () => {
      const state = createInitialBatchState('batch1', ['a', 'b'])
      saveBatchState(tempDir, state)

      const loaded = loadBatchState(tempDir, 'batch1')
      expect(loaded).toEqual(state)
    })

    it('should return null for non-existent state', () => {
      expect(loadBatchState(tempDir, 'missing')).toBeNull()
    })

    it('should persist state to SQLite and load it back', () => {
      const state = createInitialBatchState('batch1', ['a'])
      saveBatchState(tempDir, state)

      const loaded = loadBatchState(tempDir, 'batch1')
      expect(loaded).toEqual(state)
    })
  })

  describe('updateItemState', () => {
    it('should update item status', () => {
      const state = createInitialBatchState('batch1', ['a', 'b'])
      updateItemState(state, 'a', { status: 'running', sessionId: 'sess1', startedAt: 1000 })

      expect(state.items['a']!.status).toBe('running')
      expect(state.items['a']!.sessionId).toBe('sess1')
      expect(state.items['a']!.startedAt).toBe(1000)
      expect(state.items['b']!.status).toBe('pending') // Unmodified
    })

    it('should be a no-op for non-existent item', () => {
      const state = createInitialBatchState('batch1', ['a'])
      updateItemState(state, 'missing', { status: 'running' })
      expect(state.items['a']!.status).toBe('pending')
    })
  })

  describe('computeProgress', () => {
    it('should compute all zeros for initial state', () => {
      const state = createInitialBatchState('batch1', ['a', 'b', 'c'])
      const progress = computeProgress(state)
      expect(progress).toEqual({
        batchId: 'batch1',
        status: 'pending',
        totalItems: 3,
        completedItems: 0,
        failedItems: 0,
        skippedItems: 0,
        runningItems: 0,
        pendingItems: 3,
      })
    })

    it('should count items by status correctly', () => {
      const state = createInitialBatchState('batch1', ['a', 'b', 'c', 'd', 'e'])
      state.status = 'running'
      updateItemState(state, 'a', { status: 'completed' })
      updateItemState(state, 'b', { status: 'failed' })
      updateItemState(state, 'c', { status: 'running' })
      updateItemState(state, 'd', { status: 'skipped' })
      // 'e' stays pending

      const progress = computeProgress(state)
      expect(progress.completedItems).toBe(1)
      expect(progress.failedItems).toBe(1)
      expect(progress.skippedItems).toBe(1)
      expect(progress.runningItems).toBe(1)
      expect(progress.pendingItems).toBe(1)
    })
  })

  describe('isBatchDone', () => {
    it('should return false when items are pending', () => {
      const state = createInitialBatchState('batch1', ['a', 'b'])
      expect(isBatchDone(state)).toBe(false)
    })

    it('should return false when items are running', () => {
      const state = createInitialBatchState('batch1', ['a'])
      updateItemState(state, 'a', { status: 'running' })
      expect(isBatchDone(state)).toBe(false)
    })

    it('should return true when all items are completed', () => {
      const state = createInitialBatchState('batch1', ['a', 'b'])
      updateItemState(state, 'a', { status: 'completed' })
      updateItemState(state, 'b', { status: 'completed' })
      expect(isBatchDone(state)).toBe(true)
    })

    it('should return true when all items are completed or failed', () => {
      const state = createInitialBatchState('batch1', ['a', 'b'])
      updateItemState(state, 'a', { status: 'completed' })
      updateItemState(state, 'b', { status: 'failed' })
      expect(isBatchDone(state)).toBe(true)
    })
  })

  describe('per-item persistence (batch_items split)', () => {
    /** Insert a pre-split row: full items record inline in the meta blob. */
    function insertLegacyBlob(state: BatchState): void {
      const db = getWorkspaceDb(tempDir)
      db.insert(batchStateTable).values({
        batchId: state.batchId,
        state,
        updatedAt: Date.now(),
      }).run()
    }

    function rawMetaBlob(batchId: string): BatchState {
      const db = getWorkspaceDb(tempDir)
      const row = db.select().from(batchStateTable).where(eq(batchStateTable.batchId, batchId)).get()
      return row!.state as BatchState
    }

    it('migrates a legacy inline-items blob to batch_items on first load', () => {
      const legacy = createInitialBatchState('legacy1', ['a', 'b', 'c'])
      updateItemState(legacy, 'b', { status: 'completed', sessionId: 's1', completedAt: 123 })
      legacy.status = 'paused'
      insertLegacyBlob(legacy)

      // First load serves the legacy blob and migrates it
      const first = loadBatchState(tempDir, 'legacy1')
      expect(first).toEqual(legacy)

      // Blob is stripped after migration; items now live in batch_items
      expect(Object.keys(rawMetaBlob('legacy1').items)).toHaveLength(0)

      // Second load reconstructs identically from rows
      const second = loadBatchState(tempDir, 'legacy1')
      expect(second).toEqual(legacy)
    })

    it('saveBatchItemStates persists only the targeted items', () => {
      const state = createInitialBatchState('batch1', ['a', 'b'])
      saveBatchState(tempDir, state)

      updateItemState(state, 'a', { status: 'running', sessionId: 's1', startedAt: 1000 })
      // Mutate 'b' in memory but do NOT persist it — proves writes are targeted
      updateItemState(state, 'b', { status: 'skipped' })
      saveBatchItemStates(tempDir, state, ['a'])

      const loaded = loadBatchState(tempDir, 'batch1')!
      expect(loaded.items['a']).toEqual({ status: 'running', sessionId: 's1', startedAt: 1000, retryCount: 0 })
      expect(loaded.items['b']!.status).toBe('pending')
    })

    it('saveBatchMeta persists status without touching items', () => {
      const state = createInitialBatchState('batch1', ['a'])
      state.status = 'running'
      saveBatchState(tempDir, state)

      state.status = 'paused'
      updateItemState(state, 'a', { status: 'completed' })
      saveBatchMeta(tempDir, state)

      const loaded = loadBatchState(tempDir, 'batch1')!
      expect(loaded.status).toBe('paused')
      expect(loaded.items['a']!.status).toBe('pending')
    })

    it('loadBatchProgress aggregates from rows and falls back to legacy blobs', () => {
      const state = createInitialBatchState('batch1', ['a', 'b', 'c'])
      updateItemState(state, 'a', { status: 'completed' })
      updateItemState(state, 'b', { status: 'failed' })
      saveBatchState(tempDir, state)

      expect(loadBatchProgress(tempDir, 'batch1')).toEqual({
        batchId: 'batch1',
        status: 'pending',
        totalItems: 3,
        completedItems: 1,
        failedItems: 1,
        skippedItems: 0,
        runningItems: 0,
        pendingItems: 1,
      })

      // Legacy blob not yet migrated — progress comes from inline items
      const legacy = createInitialBatchState('legacy2', ['x', 'y'])
      updateItemState(legacy, 'x', { status: 'completed' })
      insertLegacyBlob(legacy)
      const legacyProgress = loadBatchProgress(tempDir, 'legacy2')!
      expect(legacyProgress.completedItems).toBe(1)
      expect(legacyProgress.pendingItems).toBe(1)

      expect(loadBatchProgress(tempDir, 'missing')).toBeNull()
    })

    it('preserves item order across save/load (paging depends on it)', () => {
      const ids = Array.from({ length: 25 }, (_, i) => `item-${i}`)
      const state = createInitialBatchState('batch1', ids)
      saveBatchState(tempDir, state)

      const loaded = loadBatchState(tempDir, 'batch1')!
      expect(Object.keys(loaded.items)).toEqual(ids)
    })

    it('appendBatchItems appends new items behind existing ones', () => {
      const state = createInitialBatchState('batch1', ['a', 'b'])
      saveBatchState(tempDir, state)

      state.items['c'] = { status: 'pending', retryCount: 0 }
      state.totalItems++
      appendBatchItems(tempDir, state, ['c'])
      saveBatchMeta(tempDir, state)

      const loaded = loadBatchState(tempDir, 'batch1')!
      expect(Object.keys(loaded.items)).toEqual(['a', 'b', 'c'])
      expect(loaded.totalItems).toBe(3)
    })

    // Regression: getBatchItemsPage must page in itemOrder, not Object.entries.
    // Zero-padded ids mix "integer-like" keys ("10".."28", reordered numerically
    // by JS objects) with string keys ("01".."09", kept in insertion order), so
    // Object.entries would render "10".."28" ahead of "01".."09".
    it('getBatchItemsPage pages in itemOrder for zero-padded ids', () => {
      const ids = ['01', '02', '10', '11']
      const state = createInitialBatchState('batchPad', ids)
      const page = getBatchItemsPage(state, 0, 50)
      expect(page.items.map((i) => i.id)).toEqual(['01', '02', '10', '11'])
    })
  })
})
