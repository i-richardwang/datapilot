import { readFile, writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { BATCHES_CONFIG_FILE, BATCH_STATE_FILE_PREFIX, BATCH_TEST_RESULT_FILE_PREFIX, TEST_BATCH_SUFFIX } from '@craft-agent/shared/batches'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

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
    const genId = () => randomBytes(3).toString('hex')
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
  RPC_CHANNELS.batches.START,
  RPC_CHANNELS.batches.PAUSE,
  RPC_CHANNELS.batches.RESUME,
  RPC_CHANNELS.batches.GET_STATUS,
  RPC_CHANNELS.batches.GET_STATE,
  RPC_CHANNELS.batches.GET_ITEMS,
  RPC_CHANNELS.batches.SET_ENABLED,
  RPC_CHANNELS.batches.DUPLICATE,
  RPC_CHANNELS.batches.DELETE,
  RPC_CHANNELS.batches.TEST,
  RPC_CHANNELS.batches.GET_TEST_RESULT,
  RPC_CHANNELS.batches.RETRY_ITEM,
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

  server.handle(RPC_CHANNELS.batches.GET_ITEMS, async (_ctx, workspaceId: string, batchId: string, offset: number, limit: number) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const processor = deps.sessionManager.ensureBatchProcessor(workspace.rootPath, workspaceId)
    return processor.getItems(batchId, offset, limit)
  })

  server.handle(RPC_CHANNELS.batches.SET_ENABLED, async (_ctx, workspaceId: string, batchId: string, enabled: boolean) => {
    await withBatchMutation(workspaceId, batchId, (batches, idx) => {
      if (enabled) {
        delete batches[idx].enabled
      } else {
        batches[idx].enabled = false
      }
    })
    deps.sessionManager.notifyBatchesChanged(workspaceId)
  })

  server.handle(RPC_CHANNELS.batches.DUPLICATE, async (_ctx, workspaceId: string, batchId: string) => {
    await withBatchMutation(workspaceId, batchId, (batches, idx, _config, genId) => {
      const clone = JSON.parse(JSON.stringify(batches[idx]))
      clone.id = genId()
      clone.name = clone.name ? `${clone.name} Copy` : 'Untitled Copy'
      batches.splice(idx + 1, 0, clone)
    })
    deps.sessionManager.notifyBatchesChanged(workspaceId)
  })

  server.handle(RPC_CHANNELS.batches.DELETE, async (_ctx, workspaceId: string, batchId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    await withBatchMutation(workspaceId, batchId, (batches, idx) => {
      batches.splice(idx, 1)
    })

    // Stop after config mutation succeeds
    const processor = deps.sessionManager.getBatchProcessor?.(workspace.rootPath)
    processor?.stop(batchId) // optional — only stop if processor was already running

    // Clean up state file, test result file, and test state file
    const cleanupFiles = [
      join(workspace.rootPath, `${BATCH_STATE_FILE_PREFIX}${batchId}.json`),
      join(workspace.rootPath, `${BATCH_TEST_RESULT_FILE_PREFIX}${batchId}.json`),
      join(workspace.rootPath, `${BATCH_STATE_FILE_PREFIX}${batchId}${TEST_BATCH_SUFFIX}.json`),
    ]
    for (const f of cleanupFiles) {
      try { await unlink(f) } catch { /* file may not exist */ }
    }
    deps.sessionManager.notifyBatchesChanged(workspaceId)
  })

  server.handle(RPC_CHANNELS.batches.TEST, async (_ctx, workspaceId: string, batchId: string, sampleSize?: number) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const processor = deps.sessionManager.ensureBatchProcessor(workspace.rootPath, workspaceId)
    return processor.test(batchId, sampleSize ?? undefined)
  })

  server.handle(RPC_CHANNELS.batches.GET_TEST_RESULT, async (_ctx, workspaceId: string, batchId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const processor = deps.sessionManager.ensureBatchProcessor(workspace.rootPath, workspaceId)
    return processor.getTestResult(batchId)
  })

  server.handle(RPC_CHANNELS.batches.RETRY_ITEM, async (_ctx, workspaceId: string, batchId: string, itemId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const processor = deps.sessionManager.ensureBatchProcessor(workspace.rootPath, workspaceId)
    return processor.retryItem(batchId, itemId)
  })
}
