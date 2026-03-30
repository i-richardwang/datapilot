/**
 * useBatches
 *
 * Encapsulates all batch state management:
 * - Loading batches from IPC
 * - Start, pause, resume handlers
 * - CRUD: toggle enabled, duplicate, delete
 * - Real-time progress updates (called from App.tsx event handler)
 * - Live config reload via onBatchesChanged
 * - Syncing batches to Jotai atom for cross-component access
 */

import { useState, useCallback, useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { batchesAtom } from '@/atoms/batches'
import type { BatchListItem } from '@/components/batches/types'
import { TEST_BATCH_SUFFIX } from '@craft-agent/shared/batches/constants'
import type { BatchProgress, BatchState, BatchItemsPage, TestBatchResult } from '@craft-agent/shared/batches'

export interface UseBatchesResult {
  batches: BatchListItem[]
  handleStartBatch: (batchId: string) => void
  handlePauseBatch: (batchId: string) => void
  handleResumeBatch: (batchId: string) => void
  handleTestBatch: (batchId: string) => void
  getBatchState: (batchId: string) => Promise<BatchState | null>
  getBatchItems: (batchId: string, offset: number, limit: number) => Promise<BatchItemsPage | null>
  updateBatchProgress: (progress: BatchProgress) => void
  handleBatchComplete: (batchId: string) => void
  testProgress: Record<string, BatchProgress>
  testResults: Record<string, TestBatchResult>
  batchPendingDelete: string | null
  pendingDeleteBatch: BatchListItem | undefined
  setBatchPendingDelete: (id: string | null) => void
  handleDuplicateBatch: (batchId: string) => void
  handleDeleteBatch: (batchId: string) => void
  confirmDeleteBatch: () => void
}

export function useBatches(
  activeWorkspaceId: string | null | undefined,
): UseBatchesResult {
  const [batches, setBatches] = useState<BatchListItem[]>([])
  const [batchPendingDelete, setBatchPendingDelete] = useState<string | null>(null)
  const [testProgress, setTestProgress] = useState<Record<string, BatchProgress>>({})
  const [testResults, setTestResults] = useState<Record<string, TestBatchResult>>({})

  // Sync batches to Jotai atom for cross-component access (MainContentPanel)
  const setBatchesAtom = useSetAtom(batchesAtom)
  useEffect(() => {
    setBatchesAtom(batches)
  }, [batches, setBatchesAtom])

  // Load batches and their persisted test results in one pass
  const loadBatchesAndTestResults = useCallback(async () => {
    if (!activeWorkspaceId) return
    try {
      const items = await window.electronAPI.listBatches(activeWorkspaceId)
      setBatches(items)

      // Load persisted test results (merge, don't replace — avoids clobbering in-flight test results)
      const persisted: Record<string, TestBatchResult> = {}
      for (const batch of items) {
        if (!batch.id) continue
        try {
          const result = await window.electronAPI.getBatchTestResult(activeWorkspaceId, batch.id)
          if (result) persisted[batch.id] = result
        } catch { /* ignore */ }
      }
      setTestResults(prev => {
        // Keep results for batches that currently have an active test (in testProgress),
        // otherwise use the persisted value (or remove if not on disk).
        const next: Record<string, TestBatchResult> = {}
        for (const batch of items) {
          if (!batch.id) continue
          if (prev[batch.id]) next[batch.id] = prev[batch.id]  // keep in-flight
          if (persisted[batch.id]) next[batch.id] = persisted[batch.id]  // persisted wins when present
        }
        return next
      })
    } catch {
      setBatches([])
    }
  }, [activeWorkspaceId])

  // Initial load
  useEffect(() => {
    loadBatchesAndTestResults()
  }, [loadBatchesAndTestResults])

  // Subscribe to live batches updates (when batches.json changes on disk)
  // Re-load test results too since config change may invalidate them
  useEffect(() => {
    if (!activeWorkspaceId) return
    const cleanup = window.electronAPI.onBatchesChanged(() => {
      loadBatchesAndTestResults()
    })
    return () => { cleanup() }
  }, [activeWorkspaceId, loadBatchesAndTestResults])

  // Update a single batch's progress in the list (or route test progress separately)
  const updateBatchProgress = useCallback((progress: BatchProgress) => {
    if (progress.batchId.endsWith(TEST_BATCH_SUFFIX)) {
      const parentId = progress.batchId.slice(0, -TEST_BATCH_SUFFIX.length)
      setTestProgress(prev => ({ ...prev, [parentId]: progress }))
      return
    }
    setBatches(prev => prev.map(b =>
      b.id === progress.batchId ? { ...b, progress } : b
    ))
  }, [])

  // Handle batch completion - reload the full list
  const handleBatchComplete = useCallback((_batchId: string) => {
    loadBatchesAndTestResults()
  }, [loadBatchesAndTestResults])

  // Shared lookup
  const findBatch = useCallback((id: string) => batches.find(b => b.id === id), [batches])

  // Start a batch — progress updates arrive via onProgress events
  const handleStartBatch = useCallback((batchId: string) => {
    if (!activeWorkspaceId) return
    // Clear test result — the batch is now running for real
    setTestResults(prev => { const next = { ...prev }; delete next[batchId]; return next })
    window.electronAPI.startBatch(activeWorkspaceId, batchId)
      .then(() => { toast.success('Batch started') })
      .catch((err: Error) => { toast.error(`Failed to start batch: ${err.message}`) })
  }, [activeWorkspaceId])

  // Pause a batch
  const handlePauseBatch = useCallback((batchId: string) => {
    if (!activeWorkspaceId) return
    window.electronAPI.pauseBatch(activeWorkspaceId, batchId)
      .then(() => { toast.success('Batch paused') })
      .catch((err: Error) => { toast.error(`Failed to pause batch: ${err.message}`) })
  }, [activeWorkspaceId])

  // Resume a batch
  const handleResumeBatch = useCallback((batchId: string) => {
    if (!activeWorkspaceId) return
    window.electronAPI.resumeBatch(activeWorkspaceId, batchId)
      .then(() => { toast.success('Batch resumed') })
      .catch((err: Error) => { toast.error(`Failed to resume batch: ${err.message}`) })
  }, [activeWorkspaceId])

  // Test a batch with a random sample
  const handleTestBatch = useCallback((batchId: string) => {
    if (!activeWorkspaceId) return
    // Clear previous result and set initial test progress immediately
    setTestResults(prev => { const next = { ...prev }; delete next[batchId]; return next })
    setTestProgress(prev => ({ ...prev, [batchId]: {
      batchId: `${batchId}${TEST_BATCH_SUFFIX}`,
      status: 'running',
      totalItems: 0,
      completedItems: 0,
      failedItems: 0,
      runningItems: 0,
      pendingItems: 0,
    } }))
    window.electronAPI.testBatch(activeWorkspaceId, batchId)
      .then((result) => {
        setTestResults(prev => ({ ...prev, [batchId]: result }))
        setTestProgress(prev => { const next = { ...prev }; delete next[batchId]; return next })
      })
      .catch((err: Error) => {
        setTestProgress(prev => { const next = { ...prev }; delete next[batchId]; return next })
        toast.error(`Failed to test batch: ${err.message}`)
      })
  }, [activeWorkspaceId])

  // Get full batch state (with items)
  const getBatchState = useCallback(async (batchId: string): Promise<BatchState | null> => {
    if (!activeWorkspaceId) return null
    try {
      return await window.electronAPI.getBatchState(activeWorkspaceId, batchId)
    } catch {
      return null
    }
  }, [activeWorkspaceId])

  // Get a paginated slice of items
  const getBatchItems = useCallback(async (
    batchId: string, offset: number, limit: number,
  ): Promise<BatchItemsPage | null> => {
    if (!activeWorkspaceId) return null
    try {
      return await window.electronAPI.getBatchItems(activeWorkspaceId, batchId, offset, limit)
    } catch {
      return null
    }
  }, [activeWorkspaceId])

  // Duplicate
  const handleDuplicateBatch = useCallback((batchId: string) => {
    if (!activeWorkspaceId) return
    window.electronAPI.duplicateBatch(activeWorkspaceId, batchId)
      .catch(() => toast.error('Failed to duplicate batch'))
  }, [activeWorkspaceId])

  // Delete: show confirmation dialog
  const handleDeleteBatch = useCallback((batchId: string) => {
    setBatchPendingDelete(batchId)
  }, [])

  const pendingDeleteBatch = batchPendingDelete ? findBatch(batchPendingDelete) : undefined

  const confirmDeleteBatch = useCallback(() => {
    if (!batchPendingDelete || !activeWorkspaceId) return
    window.electronAPI.deleteBatch(activeWorkspaceId, batchPendingDelete)
      .catch(() => toast.error('Failed to delete batch'))
    setBatchPendingDelete(null)
  }, [batchPendingDelete, activeWorkspaceId])

  return {
    batches,
    handleStartBatch,
    handlePauseBatch,
    handleResumeBatch,
    handleTestBatch,
    getBatchState,
    getBatchItems,
    updateBatchProgress,
    handleBatchComplete,
    testProgress,
    testResults,
    batchPendingDelete,
    pendingDeleteBatch,
    setBatchPendingDelete,
    handleDuplicateBatch,
    handleDeleteBatch,
    confirmDeleteBatch,
  }
}
