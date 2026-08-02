import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HandlerFn, RequestContext, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import { autoRegisterDriver, closeWorkspaceDb } from '@craft-agent/shared/db'

// CONFIG_DIR is captured at module load from DATAPILOT_CONFIG_DIR, so point it
// at a tmpdir BEFORE any @craft-agent/shared/config import below (via the
// dynamic imports in beforeAll/beforeEach).
const tmpConfig = mkdtempSync(join(tmpdir(), 'batch-import-cfg-'))
process.env.DATAPILOT_CONFIG_DIR = tmpConfig

// Seed the minimal bundled assets the workspace factory needs (config-defaults).
const assetsRoot = join(process.cwd(), '..', '..', 'apps', 'electron', 'resources')
mkdirSync(join(tmpConfig, 'config'), { recursive: true })
for (const f of ['config-defaults.json', 'docs', 'tool-icons', 'themes', 'permissions']) {
  const src = join(assetsRoot, f)
  if (existsSync(src)) cpSync(src, join(tmpConfig, f), { recursive: true })
}

type Handlers = Map<string, HandlerFn>

async function createHarness(deps: HandlerDeps): Promise<Handlers> {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {
      return undefined
    },
    updateClientWorkspace() {},
    hasClientCapability() { return false },
    findClientsWithCapability() { return [] },
  }
  const { registerBatchesHandlers } = await import('./batches')
  registerBatchesHandlers(server, deps)
  return handlers
}

function ctx(workspaceId: string): RequestContext {
  return { clientId: 'c1', workspaceId, webContentsId: 1 }
}

describe('batches:import RPC', () => {
  let tmpRoot: string
  let workspaceId: string
  let deps: HandlerDeps
  let handlers: Handlers
  let channels: typeof import('@craft-agent/shared/protocol')['RPC_CHANNELS']

  beforeAll(async () => {
    await autoRegisterDriver()
    ;({ RPC_CHANNELS: channels } = await import('@craft-agent/shared/protocol'))
    const config = await import('@craft-agent/shared/config')
    config.ensureConfigDir()
    config.saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null })
  })

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'batch-import-rpc-'))
    const { addWorkspace } = await import('@craft-agent/shared/config')
    const ws = addWorkspace({ rootPath: tmpRoot, name: 'Import Test WS' })
    workspaceId = ws.id

    deps = {
      platform: {} as never,
      sessionManager: {
        notifyBatchesChanged: () => {},
      } as never,
      oauthFlowStore: {} as never,
    }
    handlers = await createHarness(deps)
  })

  afterEach(() => {
    closeWorkspaceDb(tmpRoot)
    rmSync(tmpRoot, { recursive: true, force: true })
    // NOTE: tmpConfig (DATAPILOT_CONFIG_DIR) is intentionally NOT removed here —
    // ensureConfigDir/configDefaultsSynced are module-level one-time flags, so
    // the temp config dir must survive for the whole test file. Cleaned at exit.
  })

  it('writes config to batches.json and state to the DB', async () => {
    const state = {
      batchId: 'b42d3f',
      status: 'completed',
      totalItems: 2,
      startedAt: 1000,
      completedAt: 2000,
      items: {
        '1': { status: 'completed', sessionId: 's-1', startedAt: 1000, completedAt: 1500, retryCount: 0, summary: 'ok' },
        '2': { status: 'failed', sessionId: 's-2', startedAt: 1000, completedAt: 1600, retryCount: 1, error: 'err', summary: 'no' },
      },
      itemOrder: ['1', '2'],
    }
    const config = {
      id: 'b42d3f',
      name: 'Imported Batch',
      source: { type: 'csv', path: 'x.csv', idField: 'id' },
      action: { type: 'prompt', prompt: 'do it' },
    }

    const handler = handlers.get(channels.batches.IMPORT)!
    expect(handler).toBeDefined()

    const result = await handler(ctx(workspaceId), workspaceId, { config, state }) as { id: string }
    expect(result.id).toBe('b42d3f')

    // batches.json now contains the config
    const { BATCHES_CONFIG_FILE } = await import('@craft-agent/shared/batches')
    const raw = readFileSync(join(tmpRoot, BATCHES_CONFIG_FILE), 'utf-8')
    const fileConfig = JSON.parse(raw)
    const found = fileConfig.batches.find((b: any) => b.id === 'b42d3f')
    expect(found).toBeTruthy()
    expect(found.name).toBe('Imported Batch')

    // DB has the state + items
    const { loadAllBatchStates, loadBatchProgress } = await import('@craft-agent/shared/batches')
    const states = loadAllBatchStates(tmpRoot)
    expect(states).toHaveLength(1)
    expect(states[0].status).toBe('completed')
    expect(states[0].itemOrder).toEqual(['1', '2'])
    expect(Object.keys(states[0].items)).toHaveLength(2)
    expect(states[0].items['2'].error).toBe('err')

    const progress = loadBatchProgress(tmpRoot, 'b42d3f')
    expect(progress?.completedItems).toBe(1)
    expect(progress?.failedItems).toBe(1)
  })

  it('re-import with the same id is idempotent (replaces config, no duplicate)', async () => {
    const state = { batchId: 'b42d3f', status: 'pending', totalItems: 0, items: {}, itemOrder: [] }
    const config = {
      id: 'b42d3f',
      name: 'First Import',
      source: { type: 'csv', path: 'a.csv', idField: 'id' },
      action: { type: 'prompt', prompt: 'v1' },
    }
    const handler = handlers.get(channels.batches.IMPORT)!

    await handler(ctx(workspaceId), workspaceId, { config, state })
    await handler(ctx(workspaceId), workspaceId, { config: { ...config, name: 'Second Import' }, state })

    const { BATCHES_CONFIG_FILE } = await import('@craft-agent/shared/batches')
    const raw = readFileSync(join(tmpRoot, BATCHES_CONFIG_FILE), 'utf-8')
    const fileConfig = JSON.parse(raw)
    const matches = fileConfig.batches.filter((b: any) => b.id === 'b42d3f')
    expect(matches).toHaveLength(1)
    expect(matches[0].name).toBe('Second Import')
  })

  it('rejects payloads missing config or state', async () => {
    const handler = handlers.get(channels.batches.IMPORT)!
    await expect(handler(ctx(workspaceId), workspaceId, { config: { id: 'x' } })).rejects.toThrow(
      'config and state are required',
    )
    await expect(handler(ctx(workspaceId), workspaceId, { state: { batchId: 'x' } })).rejects.toThrow(
      'config and state are required',
    )
  })

  it('preserves labels in the config even when they are not yet in the workspace', async () => {
    const state = { batchId: 'b42d3f', status: 'pending', totalItems: 0, items: {}, itemOrder: [] }
    const config = {
      id: 'b42d3f',
      name: 'Labeled Batch',
      labels: ['talent-graph', 'define-tag'],
      source: { type: 'csv', path: 'a.csv', idField: 'id' },
      action: { type: 'prompt', prompt: 'v1' },
    }
    const handler = handlers.get(channels.batches.IMPORT)!
    const res = await handler(ctx(workspaceId), workspaceId, { config, state }) as { id: string }
    expect(res.id).toBe('b42d3f')

    const { BATCHES_CONFIG_FILE } = await import('@craft-agent/shared/batches')
    const raw = readFileSync(join(tmpRoot, BATCHES_CONFIG_FILE), 'utf-8')
    const fileConfig = JSON.parse(raw)
    const found = fileConfig.batches.find((b: any) => b.id === 'b42d3f')
    expect(found.labels).toEqual(['talent-graph', 'define-tag'])
  })
})
