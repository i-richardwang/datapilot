import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { BATCHES_CONFIG_FILE, deleteBatchState } from '@craft-agent/shared/batches'
import type { BatchItemStatus } from '@craft-agent/shared/batches'
import { loadLabelConfig } from '@craft-agent/shared/labels/storage'
import { resolveSessionLabels } from '@craft-agent/shared/labels'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

/**
 * Validate a label-string array against the workspace label tree.
 * Mirrors the session label flow (`resolveSessionLabels`) so agent-supplied
 * inputs go through the same display-name → id canonicalization and unknown-id
 * rejection path. Throws on any unknown entry; returns canonical IDs on success.
 *
 * `context` is included in the error message so the agent can tell
 * `batch.labels` rejections apart from `action.labels` rejections.
 */
function resolveBatchLabelArray(workspaceRootPath: string, inputs: string[], context: string): string[] {
  const labelConfig = loadLabelConfig(workspaceRootPath)
  const { resolved, unknown, available, reasons } = resolveSessionLabels(inputs, labelConfig.labels)
  if (unknown.length > 0) {
    const lines = unknown.map((entry) => `  - "${entry}" — ${reasons[entry] ?? 'unknown label'}`)
    throw new Error(
      `${context} rejected:\n${lines.join('\n')}\n\n` +
      `Available label IDs: ${available.join(', ') || '(none configured)'}.\n` +
      `Use "id::value" only for labels configured with a valueType.`
    )
  }
  return resolved
}

/**
 * Return a shallow copy of a batch or update-patch with both `labels` (entity
 * tags) and `action.labels` (child-session tags) validated and canonicalized.
 * Both fields share the workspace label tree, so the same resolver applies.
 */
function withValidatedBatchLabels<T extends Record<string, unknown>>(workspaceRootPath: string, obj: T): T {
  const result: Record<string, unknown> = { ...obj }
  if (Array.isArray(result.labels)) {
    result.labels = resolveBatchLabelArray(workspaceRootPath, result.labels as string[], 'Batch labels')
  }
  const action = result.action
  if (action && typeof action === 'object' && !Array.isArray(action)) {
    const actionObj = action as Record<string, unknown>
    if (Array.isArray(actionObj.labels)) {
      result.action = {
        ...actionObj,
        labels: resolveBatchLabelArray(workspaceRootPath, actionObj.labels as string[], 'Batch action.labels'),
      }
    }
  }
  return result as T
}

// Per-workspace config mutex: serializes read-modify-write cycles on batches.json
const configMutexes = new Map<string, Promise<void>>()
function withConfigMutex<T>(workspaceRoot: string, fn: () => Promise<T>): Promise<T> {
  const prev = configMutexes.get(workspaceRoot) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  configMutexes.set(workspaceRoot, next.then(() => {}, () => {}))
  return next
}

// Shared helper: resolve workspace, read batches.json, validate batch, mutate, write back
async function withBatchMutation(
  workspaceId: string,
  batchId: string,
  mutate: (batches: Record<string, unknown>[], index: number, config: Record<string, unknown>, genId: () => string) => void
) {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error('Workspace not found')

  await withConfigMutex(workspace.rootPath, async () => {
    const { randomBytes } = await import('crypto')
    const genId = () => randomBytes(8).toString('hex')
    const configPath = join(workspace.rootPath, BATCHES_CONFIG_FILE)
    const raw = await readFile(configPath, 'utf-8')
    const config = JSON.parse(raw)
    const batches = config.batches
    if (!Array.isArray(batches)) throw new Error('Invalid batches.json: missing batches array')
    const index = batches.findIndex((b: Record<string, unknown>) => b.id === batchId)
    if (index < 0) throw new Error(`Batch not found: ${batchId}`)

    mutate(batches, index, config, genId)

    // Backfill missing IDs on all batches before writing
    for (const b of batches) {
      if (!b.id) b.id = genId()
    }
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  })
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.batches.LIST,
  RPC_CHANNELS.batches.CREATE,
  RPC_CHANNELS.batches.UPDATE,
  RPC_CHANNELS.batches.START,
  RPC_CHANNELS.batches.PAUSE,
  RPC_CHANNELS.batches.RESUME,
  RPC_CHANNELS.batches.GET_STATUS,
  RPC_CHANNELS.batches.GET_STATE,
  RPC_CHANNELS.batches.GET_ITEMS,
  RPC_CHANNELS.batches.DUPLICATE,
  RPC_CHANNELS.batches.DELETE,
  RPC_CHANNELS.batches.VALIDATE,
  RPC_CHANNELS.batches.RETRY_ITEM,
  RPC_CHANNELS.batches.RETRY_FAILED,
] as const

export function registerBatchesHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  server.handle(RPC_CHANNELS.batches.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const processor = deps.sessionManager.ensureBatchProcessor(workspace.rootPath, workspaceId)
    return processor.listBatches()
  })

  server.handle(RPC_CHANNELS.batches.START, async (_ctx, workspaceId: string, batchId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const processor = deps.sessionManager.ensureBatchProcessor(workspace.rootPath, workspaceId)
    return processor.start(batchId)
  })

  server.handle(RPC_CHANNELS.batches.PAUSE, async (_ctx, workspaceId: string, batchId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const processor = deps.sessionManager.ensureBatchProcessor(workspace.rootPath, workspaceId)
    return processor.pause(batchId)
  })

  server.handle(RPC_CHANNELS.batches.RESUME, async (_ctx, workspaceId: string, batchId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const processor = deps.sessionManager.ensureBatchProcessor(workspace.rootPath, workspaceId)
    return processor.resume(batchId)
  })

  server.handle(RPC_CHANNELS.batches.GET_STATUS, async (_ctx, workspaceId: string, batchId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const processor = deps.sessionManager.ensureBatchProcessor(workspace.rootPath, workspaceId)
    return processor.getProgress(batchId)
  })

  server.handle(RPC_CHANNELS.batches.GET_STATE, async (_ctx, workspaceId: string, batchId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const processor = deps.sessionManager.ensureBatchProcessor(workspace.rootPath, workspaceId)
    return processor.getState(batchId)
  })

  server.handle(RPC_CHANNELS.batches.GET_ITEMS, async (_ctx, workspaceId: string, batchId: string, offset: number, limit: number, filterStatus?: BatchItemStatus) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const processor = deps.sessionManager.ensureBatchProcessor(workspace.rootPath, workspaceId)
    return processor.getItems(batchId, offset, limit, filterStatus)
  })

  // Create a new batch entry in batches.json
  server.handle(RPC_CHANNELS.batches.CREATE, async (_ctx, workspaceId: string, batch: Record<string, unknown>) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { BatchesFileConfigSchema } = await import('@craft-agent/shared/batches')

    let created!: Record<string, unknown>
    await withConfigMutex(workspace.rootPath, async () => {
      const { randomBytes } = await import('crypto')
      const configPath = join(workspace.rootPath, BATCHES_CONFIG_FILE)

      let config: { batches: Array<Record<string, unknown>> }
      try {
        const raw = await readFile(configPath, 'utf-8')
        config = JSON.parse(raw)
        if (!Array.isArray(config.batches)) config.batches = []
      } catch (error) {
        if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          config = { batches: [] }
        } else {
          throw error
        }
      }

      const newBatch = withValidatedBatchLabels(workspace.rootPath, batch)
      if (!newBatch.id) newBatch.id = randomBytes(8).toString('hex')
      if (typeof newBatch.createdAt !== 'number') newBatch.createdAt = Date.now()
      config.batches.push(newBatch)

      const validation = BatchesFileConfigSchema.safeParse(config)
      if (!validation.success) {
        throw new Error(`Invalid batch config: ${validation.error.message}`)
      }

      await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
      created = newBatch
    })
    deps.sessionManager.notifyBatchesChanged(workspaceId)
    return created
  })

  // Update an existing batch (shallow merge of top-level fields, preserves identity)
  server.handle(RPC_CHANNELS.batches.UPDATE, async (_ctx, workspaceId: string, batchId: string, patch: Record<string, unknown>) => {
    const { BatchesFileConfigSchema } = await import('@craft-agent/shared/batches')

    // Validate labels up-front against the workspace label tree before entering
    // the mutex. Covers both `labels` (entity tags) and `action.labels` (child
    // session tags) — without this, agent-supplied unknown IDs would silently
    // persist and surface as missing chips in the UI or as deferred errors when
    // the batch runs.
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    const sanitizedPatch = withValidatedBatchLabels(workspace.rootPath, patch)

    let updated!: Record<string, unknown>
    await withBatchMutation(workspaceId, batchId, (batches, idx, config) => {
      const current = batches[idx]!
      const merged = { ...current, ...sanitizedPatch }
      merged.id = current.id ?? merged.id
      batches[idx] = merged

      const validation = BatchesFileConfigSchema.safeParse(config)
      if (!validation.success) {
        throw new Error(`Invalid batch config: ${validation.error.message}`)
      }
      updated = merged
    })
    deps.sessionManager.notifyBatchesChanged(workspaceId)
    return updated
  })

  // Validate batches.json (returns details, does not throw)
  server.handle(RPC_CHANNELS.batches.VALIDATE, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { validateBatches } = await import('@craft-agent/shared/batches')
    const configPath = join(workspace.rootPath, BATCHES_CONFIG_FILE)

    try {
      await readFile(configPath, 'utf-8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { valid: true, errors: [] as Array<{ path: string; message: string }>, note: 'No batches.json found (empty config is valid)' }
      }
      throw error
    }
    return validateBatches(workspace.rootPath)
  })

  server.handle(RPC_CHANNELS.batches.DUPLICATE, async (_ctx, workspaceId: string, batchId: string) => {
    let cloned!: Record<string, unknown>
    await withBatchMutation(workspaceId, batchId, (batches, idx, _config, genId) => {
      const clone = JSON.parse(JSON.stringify(batches[idx]))
      clone.id = genId()
      clone.name = clone.name ? `${clone.name} Copy` : 'Untitled Copy'
      clone.createdAt = Date.now()
      batches.splice(idx + 1, 0, clone)
      cloned = clone
    })
    deps.sessionManager.notifyBatchesChanged(workspaceId)
    return cloned
  })

  server.handle(RPC_CHANNELS.batches.DELETE, async (_ctx, workspaceId: string, batchId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    await withBatchMutation(workspaceId, batchId, (batches, idx) => {
      batches.splice(idx, 1)
    })

    const processor = deps.sessionManager.getBatchProcessor?.(workspace.rootPath)
    processor?.stop(batchId)

    deleteBatchState(workspace.rootPath, batchId)
    deps.sessionManager.notifyBatchesChanged(workspaceId)
  })

  server.handle(RPC_CHANNELS.batches.RETRY_ITEM, async (_ctx, workspaceId: string, batchId: string, itemId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const processor = deps.sessionManager.ensureBatchProcessor(workspace.rootPath, workspaceId)
    return processor.retryItem(batchId, itemId)
  })

  server.handle(RPC_CHANNELS.batches.RETRY_FAILED, async (_ctx, workspaceId: string, batchId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const processor = deps.sessionManager.ensureBatchProcessor(workspace.rootPath, workspaceId)
    return processor.retryFailedItems(batchId)
  })
}
