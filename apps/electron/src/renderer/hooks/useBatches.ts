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
import type { BatchProgress, BatchState } from '@craft-agent/shared/batches'

export interface UseBatchesResult {
  batches: BatchListItem[]
  handleStartBatch: (batchId: string) => void
  handlePauseBatch: (batchId: string) => void
  handleResumeBatch: (batchId: string) => void
  getBatchState: (batchId: string) => Promise<BatchState | null>
  updateBatchProgress: (progress: BatchProgress) => void
  handleBatchComplete: (batchId: string) => void
  batchPendingDelete: string | null
  pendingDeleteBatch: BatchListItem | undefined
  setBatchPendingDelete: (id: string | null) => void
  handleToggleBatch: (batchId: string) => void
  handleDuplicateBatch: (batchId: string) => void
  handleDeleteBatch: (batchId: string) => void
  confirmDeleteBatch: () => void
}

export function useBatches(
  activeWorkspaceId: string | null | undefined,
): UseBatchesResult {
  const [batches, setBatches] = useState<BatchListItem[]>([])
  const [batchPendingDelete, setBatchPendingDelete] = useState<string | null>(null)

  // Sync batches to Jotai atom for cross-component access (MainContentPanel)
  const setBatchesAtom = useSetAtom(batchesAtom)
  useEffect(() => {
    setBatchesAtom(batches)
  }, [batches, setBatchesAtom])

  // Load batches from IPC
  const loadBatches = useCallback(async () => {
    if (!activeWorkspaceId) return
    try {
      const items = await window.electronAPI.listBatches(activeWorkspaceId)
      setBatches(items)
    } catch {
      setBatches([])
    }
  }, [activeWorkspaceId])

  // Initial load
  useEffect(() => {
    loadBatches()
  }, [loadBatches])

  // Subscribe to live batches updates (when batches.json changes on disk)
  useEffect(() => {
    if (!activeWorkspaceId) return
    const cleanup = window.electronAPI.onBatchesChanged(() => { loadBatches() })
    return () => { cleanup() }
  }, [activeWorkspaceId, loadBatches])

  // Update a single batch's progress in the list
  const updateBatchProgress = useCallback((progress: BatchProgress) => {
    setBatches(prev => prev.map(b =>
      b.id === progress.batchId ? { ...b, progress } : b
    ))
  }, [])

  // Handle batch completion - reload the full list
  const handleBatchComplete = useCallback((_batchId: string) => {
    loadBatches()
  }, [loadBatches])

  // Shared lookup
  const findBatch = useCallback((id: string) => batches.find(b => b.id === id), [batches])

  // Start a batch
  const handleStartBatch = useCallback((batchId: string) => {
    if (!activeWorkspaceId) return
    window.electronAPI.startBatch(activeWorkspaceId, batchId)
      .then((progress) => {
        updateBatchProgress(progress)
        toast.success('Batch started')
      })
      .catch((err: Error) => {
        toast.error(`Failed to start batch: ${err.message}`)
      })
  }, [activeWorkspaceId, updateBatchProgress])

  // Pause a batch
  const handlePauseBatch = useCallback((batchId: string) => {
    if (!activeWorkspaceId) return
    window.electronAPI.pauseBatch(activeWorkspaceId, batchId)
      .then((progress) => {
        updateBatchProgress(progress)
        toast.success('Batch paused')
      })
      .catch((err: Error) => {
        toast.error(`Failed to pause batch: ${err.message}`)
      })
  }, [activeWorkspaceId, updateBatchProgress])

  // Resume a batch
  const handleResumeBatch = useCallback((batchId: string) => {
    if (!activeWorkspaceId) return
    window.electronAPI.resumeBatch(activeWorkspaceId, batchId)
      .then((progress) => {
        updateBatchProgress(progress)
        toast.success('Batch resumed')
      })
      .catch((err: Error) => {
        toast.error(`Failed to resume batch: ${err.message}`)
      })
  }, [activeWorkspaceId, updateBatchProgress])

  // Get full batch state (with items)
  const getBatchState = useCallback(async (batchId: string): Promise<BatchState | null> => {
    if (!activeWorkspaceId) return null
    try {
      return await window.electronAPI.getBatchState(activeWorkspaceId, batchId)
    } catch {
      return null
    }
  }, [activeWorkspaceId])

  // Toggle enabled/disabled
  const handleToggleBatch = useCallback((batchId: string) => {
    const batch = findBatch(batchId)
    if (!batch || !activeWorkspaceId) return
    window.electronAPI.setBatchEnabled(activeWorkspaceId, batchId, batch.enabled === false)
      .catch(() => toast.error('Failed to toggle batch'))
  }, [findBatch, activeWorkspaceId])

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
    getBatchState,
    updateBatchProgress,
    handleBatchComplete,
    batchPendingDelete,
    pendingDeleteBatch,
    setBatchPendingDelete,
    handleToggleBatch,
    handleDuplicateBatch,
    handleDeleteBatch,
    confirmDeleteBatch,
  }
}
