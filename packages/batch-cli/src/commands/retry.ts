/**
 * craft-agent batch retry <batch-id> <item-id>
 *
 * Reset a failed item to pending so it will be re-executed on the next resume.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  BatchesFileConfigSchema,
  loadBatchState,
  saveBatchState,
  updateItemState,
} from '@craft-agent/shared/batches'
import { colorStatus, colors as c } from '../format.ts'
import { findBatch } from './get.ts'

export function cmdRetry(workspaceRoot: string, batchIdOrName: string, itemId: string, asJson: boolean): void {
  const configPath = join(workspaceRoot, 'batches.json')
  if (!existsSync(configPath)) {
    console.error('No batches.json found in workspace.')
    process.exit(1)
  }

  const raw = readFileSync(configPath, 'utf-8')
  const parsed = BatchesFileConfigSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    console.error('Invalid batches.json:', parsed.error.message)
    process.exit(1)
  }

  const batch = findBatch(parsed.data.batches, batchIdOrName)
  if (!batch) {
    console.error(`Batch not found: ${batchIdOrName}`)
    process.exit(1)
  }

  const batchId = batch.id
  if (!batchId) {
    console.error('Batch has no id — cannot load state.')
    process.exit(1)
  }

  const state = loadBatchState(workspaceRoot, batchId)
  if (!state) {
    console.error(`Batch "${batchId}" has not been started yet.`)
    process.exit(1)
  }

  const itemState = state.items[itemId]
  if (!itemState) {
    console.error(`Item "${itemId}" not found in batch "${batchId}".`)
    process.exit(1)
  }

  if (itemState.status !== 'failed') {
    console.error(`Item "${itemId}" is not failed (status: ${itemState.status}). Only failed items can be retried.`)
    process.exit(1)
  }

  // Reset item to pending — preserve retryCount for historical tracking
  updateItemState(state, itemId, {
    status: 'pending',
    sessionId: undefined,
    completedAt: undefined,
    error: undefined,
  })

  // If the batch already finished, set it to paused so it can be resumed
  const batchWasDone = state.status === 'completed' || state.status === 'failed'
  if (batchWasDone) {
    state.status = 'paused'
    state.completedAt = undefined
  }

  saveBatchState(workspaceRoot, state)

  if (asJson) {
    console.log(JSON.stringify({
      batchId,
      itemId,
      itemStatus: 'pending',
      batchStatus: state.status,
      needsResume: batchWasDone,
    }))
    return
  }

  console.log(`${c.green}Item "${itemId}" reset to ${colorStatus('pending')} in batch "${batchId}".${c.reset}`)
  if (batchWasDone) {
    console.log(`Batch status changed to ${colorStatus('paused')} — resume the batch to re-execute this item.`)
  } else if (state.status === 'running') {
    console.log('Batch is running — the item will be picked up automatically.')
  } else {
    console.log(`Batch is ${colorStatus(state.status)} — resume the batch to re-execute this item.`)
  }
}
