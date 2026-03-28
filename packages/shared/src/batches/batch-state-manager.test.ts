import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  getBatchStatePath,
  loadBatchState,
  saveBatchState,
  createInitialBatchState,
  updateItemState,
  computeProgress,
  isBatchDone,
} from './batch-state-manager.db.ts'
import type { BatchState } from './types.ts'

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

    it('should create a valid JSON file', () => {
      const state = createInitialBatchState('batch1', ['a'])
      saveBatchState(tempDir, state)

      const path = getBatchStatePath(tempDir, 'batch1')
      expect(existsSync(path)).toBe(true)
      const content = readFileSync(path, 'utf-8')
      expect(JSON.parse(content)).toEqual(state)
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
      expect(progress.failedItems).toBe(2) // failed + skipped
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
})
