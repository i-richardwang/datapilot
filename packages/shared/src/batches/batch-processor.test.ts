import { describe, it, expect, beforeAll, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { autoRegisterDriver } from '../db/driver.ts'
import { BatchProcessor } from './batch-processor.ts'
import { loadBatchState } from './batch-state-manager.db.ts'
import {
  BATCH_STATE_FILE_PREFIX,
  DEFAULT_GLOBAL_MAX_CONCURRENT_SESSIONS,
  GLOBAL_MAX_CONCURRENT_SESSIONS_ENV,
  resolveGlobalMaxConcurrentSessions,
} from './constants.ts'
import type { BatchSystemOptions, BatchExecutePromptParams, BatchProgress } from './types.ts'

beforeAll(async () => {
  await autoRegisterDriver();
});

/** Wait for background dispatch (fire-and-forget) to settle */
const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms))

function createTestSetup() {
  const tempDir = mkdtempSync(join(tmpdir(), 'batch-processor-'))

  // Create test data
  writeFileSync(join(tempDir, 'companies.json'), JSON.stringify([
    { id: 'acme', name: 'Acme Corp', url: 'https://acme.com' },
    { id: 'beta', name: 'Beta Inc', url: 'https://beta.com' },
    { id: 'gamma', name: 'Gamma LLC', url: 'https://gamma.com' },
  ]))

  // Create batch config
  writeFileSync(join(tempDir, 'batches.json'), JSON.stringify({
    version: 1,
    batches: [
      {
        id: 'test-batch',
        name: 'Test Batch',
        source: { type: 'json', path: 'companies.json', idField: 'id' },
        execution: { maxConcurrency: 2 },
        action: { type: 'prompt', prompt: 'Analyze $BATCH_ITEM_NAME at $BATCH_ITEM_URL', labels: ['batch'] },
      },
      {
        id: 'retry-batch',
        name: 'Retry Batch',
        source: { type: 'json', path: 'companies.json', idField: 'id' },
        execution: { maxConcurrency: 1, retryOnFailure: true, maxRetries: 2 },
        action: { type: 'prompt', prompt: 'Analyze $BATCH_ITEM_NAME' },
      },
    ],
  }))

  let sessionCounter = 0
  const createdSessions: { sessionId: string; params: BatchExecutePromptParams }[] = []
  const progressUpdates: BatchProgress[] = []
  const completedBatches: { batchId: string; status: string }[] = []

  const executePrompt = mock(async (params: BatchExecutePromptParams) => {
    const sessionId = `session-${++sessionCounter}`
    createdSessions.push({ sessionId, params })
    // Real handler invokes this so BatchProcessor can register the
    // session→item mapping; tests asserting onSessionComplete behavior
    // depend on this side effect.
    params.onSessionCreated?.(sessionId)
    return { sessionId }
  })

  const options: BatchSystemOptions = {
    workspaceRootPath: tempDir,
    workspaceId: 'test-workspace',
    onExecutePrompt: executePrompt,
    onProgress: (progress) => progressUpdates.push(progress),
    onBatchComplete: (batchId, status) => completedBatches.push({ batchId, status }),
  }

  const processor = new BatchProcessor(options)

  return {
    tempDir,
    processor,
    createdSessions,
    progressUpdates,
    completedBatches,
    executePrompt,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  }
}

describe('BatchProcessor', () => {
  let setup: ReturnType<typeof createTestSetup>

  beforeEach(() => {
    setup = createTestSetup()
  })

  afterEach(() => {
    setup.processor.dispose()
    setup.cleanup()
  })

  // =========================================================================
  // Configuration
  // =========================================================================

  describe('loadConfig', () => {
    it('should load and parse batches.json', () => {
      const config = setup.processor.loadConfig()
      expect(config).not.toBeNull()
      expect(config!.batches).toHaveLength(2)
      expect(config!.batches[0]!.id).toBe('test-batch')
    })

    it('should return null when no config exists', () => {
      writeFileSync(join(setup.tempDir, 'batches.json'), 'nope')
      rmSync(join(setup.tempDir, 'batches.json'))
      const config = setup.processor.loadConfig()
      expect(config).toBeNull()
    })
  })

  describe('getBatchConfig', () => {
    it('should find batch by ID', () => {
      const config = setup.processor.getBatchConfig('test-batch')
      expect(config).toBeDefined()
      expect(config!.name).toBe('Test Batch')
    })

    it('should return undefined for unknown ID', () => {
      expect(setup.processor.getBatchConfig('nonexistent')).toBeUndefined()
    })
  })

  describe('listBatches', () => {
    it('should list all batches', () => {
      const batches = setup.processor.listBatches()
      expect(batches).toHaveLength(2)
    })
  })

  // =========================================================================
  // Start & Dispatch
  // =========================================================================

  describe('start', () => {
    it('should return progress immediately with all items pending', () => {
      const progress = setup.processor.start('test-batch')

      expect(progress.status).toBe('running')
      expect(progress.totalItems).toBe(3)
      expect(progress.pendingItems).toBe(3)
    })

    it('should dispatch items up to maxConcurrency in background', async () => {
      setup.processor.start('test-batch')
      await tick()

      expect(setup.createdSessions).toHaveLength(2) // maxConcurrency = 2
      const state = setup.processor.getState('test-batch')
      const running = Object.values(state!.items).filter(i => i.status === 'running')
      expect(running).toHaveLength(2)
    })

    it('should emit onProgress immediately on start', () => {
      setup.progressUpdates.length = 0
      setup.processor.start('test-batch')

      // Should have at least the initial progress event
      expect(setup.progressUpdates.length).toBeGreaterThanOrEqual(1)
      expect(setup.progressUpdates[0]!.status).toBe('running')
    })

    it('should expand environment variables in prompt', async () => {
      setup.processor.start('test-batch')
      await tick()

      const firstSession = setup.createdSessions[0]!
      expect(firstSession.params.prompt).toContain('Acme Corp')
      expect(firstSession.params.prompt).toContain('https://acme.com')
    })

    it('should pass labels from action config', async () => {
      setup.processor.start('test-batch')
      await tick()
      expect(setup.createdSessions[0]!.params.labels).toEqual(['batch'])
    })

    it('should throw for non-existent batch', () => {
      expect(() => setup.processor.start('nonexistent')).toThrow('not found')
    })

    it('should persist state to disk', () => {
      setup.processor.start('test-batch')

      const state = loadBatchState(setup.tempDir, 'test-batch')
      expect(state).not.toBeNull()
      expect(state!.status).toBe('running')
      expect(state!.totalItems).toBe(3)
    })
  })

  // =========================================================================
  // Restart completed/failed batches
  // =========================================================================

  describe('restart completed batch', () => {
    it('should re-execute all items when starting a completed batch', async () => {
      // Run batch to completion
      setup.processor.start('test-batch')
      await tick()
      for (const session of [...setup.createdSessions]) {
        setup.processor.onSessionComplete(session.sessionId, 'complete')
        await tick()
      }
      // Complete the 3rd dispatched session
      const thirdSession = setup.createdSessions[2]
      if (thirdSession) {
        setup.processor.onSessionComplete(thirdSession.sessionId, 'complete')
        await tick()
      }

      const stateAfterFirst = setup.processor.getState('test-batch')
      expect(stateAfterFirst!.status).toBe('completed')

      // Now start again — should reset all items and re-dispatch
      const sessionCountBefore = setup.createdSessions.length
      const progress = setup.processor.start('test-batch')

      expect(progress.status).toBe('running')
      expect(progress.pendingItems).toBe(3)
      expect(progress.completedItems).toBe(0)

      await tick()

      // New sessions should have been created
      expect(setup.createdSessions.length).toBeGreaterThan(sessionCountBefore)
    })

    it('should re-execute all items when starting a failed batch', async () => {
      setup.processor.start('test-batch')
      await tick()

      // Fail all sessions
      for (const session of [...setup.createdSessions]) {
        setup.processor.onSessionComplete(session.sessionId, 'error')
        await tick()
      }
      const thirdSession = setup.createdSessions[2]
      if (thirdSession) {
        setup.processor.onSessionComplete(thirdSession.sessionId, 'error')
        await tick()
      }

      const stateAfterFail = setup.processor.getState('test-batch')
      expect(stateAfterFail!.status).toBe('failed')

      // Start again — should reset all items
      const progress = setup.processor.start('test-batch')
      expect(progress.status).toBe('running')
      expect(progress.pendingItems).toBe(3)
      expect(progress.failedItems).toBe(0)
    })
  })

  // =========================================================================
  // Session Completion & Dispatch Chain
  // =========================================================================

  describe('onSessionComplete', () => {
    it('should mark item as completed on success', async () => {
      setup.processor.start('test-batch')
      await tick()

      const sessionId = setup.createdSessions[0]!.sessionId
      const handled = setup.processor.onSessionComplete(sessionId, 'complete')

      expect(handled).toBe(true)
      const state = setup.processor.getState('test-batch')
      const completedItems = Object.values(state!.items).filter((i) => i.status === 'completed')
      expect(completedItems).toHaveLength(1)
    })

    it('should dispatch next item after completion', async () => {
      setup.processor.start('test-batch')
      await tick()
      expect(setup.createdSessions).toHaveLength(2) // maxConcurrency = 2

      // Complete one session → should dispatch the 3rd item
      const sessionId = setup.createdSessions[0]!.sessionId
      setup.processor.onSessionComplete(sessionId, 'complete')

      await tick()

      expect(setup.createdSessions).toHaveLength(3) // All 3 dispatched
    })

    it('should complete batch when all items are done', async () => {
      setup.processor.start('test-batch')
      await tick()

      // Complete all sessions
      for (const session of [...setup.createdSessions]) {
        setup.processor.onSessionComplete(session.sessionId, 'complete')
        await tick()
      }

      // Complete the 3rd session that was dispatched
      const thirdSession = setup.createdSessions[2]
      if (thirdSession) {
        setup.processor.onSessionComplete(thirdSession.sessionId, 'complete')
        await tick()
      }

      const state = setup.processor.getState('test-batch')
      expect(state!.status).toBe('completed')
      expect(setup.completedBatches.length).toBeGreaterThan(0)
    })

    it('should mark item as failed on error', async () => {
      setup.processor.start('test-batch')
      await tick()

      const sessionId = setup.createdSessions[0]!.sessionId
      setup.processor.onSessionComplete(sessionId, 'error')

      const state = setup.processor.getState('test-batch')
      const failedItems = Object.values(state!.items).filter((i) => i.status === 'failed')
      expect(failedItems).toHaveLength(1)
      expect(failedItems[0]!.error).toBe('error')
    })

    it('should return false for unknown session', () => {
      expect(setup.processor.onSessionComplete('unknown-session', 'complete')).toBe(false)
    })

    it('should send progress updates', async () => {
      setup.processor.start('test-batch')
      await tick()
      setup.progressUpdates.length = 0

      const sessionId = setup.createdSessions[0]!.sessionId
      setup.processor.onSessionComplete(sessionId, 'complete')

      expect(setup.progressUpdates.length).toBeGreaterThanOrEqual(1)
      const completionUpdate = setup.progressUpdates.find(p => p.completedItems === 1)
      expect(completionUpdate).toBeDefined()
    })
  })

  // =========================================================================
  // Retry Logic
  // =========================================================================

  describe('retry', () => {
    it('should retry failed items when retryOnFailure is enabled', async () => {
      setup.processor.start('retry-batch')
      await tick()
      expect(setup.createdSessions).toHaveLength(1) // maxConcurrency = 1

      const sessionId = setup.createdSessions[0]!.sessionId
      setup.processor.onSessionComplete(sessionId, 'error')

      await tick()

      const state = setup.processor.getState('retry-batch')
      const runningItems = Object.values(state!.items).filter((i) => i.status === 'running')
      expect(runningItems.length).toBeGreaterThanOrEqual(1)
    })
  })

  // =========================================================================
  // Pause & Resume
  // =========================================================================

  describe('pause / resume', () => {
    it('should pause a running batch', () => {
      setup.processor.start('test-batch')
      const progress = setup.processor.pause('test-batch')

      expect(progress.status).toBe('paused')
    })

    it('should emit onProgress on pause', () => {
      setup.processor.start('test-batch')
      setup.progressUpdates.length = 0

      setup.processor.pause('test-batch')

      expect(setup.progressUpdates.length).toBeGreaterThanOrEqual(1)
      expect(setup.progressUpdates[0]!.status).toBe('paused')
    })

    it('should resume a paused batch', () => {
      setup.processor.start('test-batch')
      setup.processor.pause('test-batch')
      const progress = setup.processor.resume('test-batch')

      expect(progress.status).toBe('running')
    })

    it('should preserve active running sessions when resuming without restart', async () => {
      setup.processor.start('test-batch')
      await tick()
      const initialSessions = setup.createdSessions.map(s => s.sessionId)

      setup.processor.pause('test-batch')
      const progress = setup.processor.resume('test-batch')
      await tick()

      expect(progress.runningItems).toBe(2)
      expect(progress.pendingItems).toBe(1)
      expect(setup.createdSessions.map(s => s.sessionId)).toEqual(initialSessions)
      const state = setup.processor.getState('test-batch')!
      const runningSessionIds = Object.values(state.items)
        .filter(i => i.status === 'running')
        .map(i => i.sessionId)
      expect(runningSessionIds).toEqual(initialSessions)
    })

    it('should not dispatch new items while paused', async () => {
      setup.processor.start('test-batch')
      await tick()
      const initialCount = setup.createdSessions.length

      setup.processor.pause('test-batch')

      // Complete a session — should not dispatch new items
      const sessionId = setup.createdSessions[0]!.sessionId
      setup.processor.onSessionComplete(sessionId, 'complete')
      await tick()

      expect(setup.createdSessions.length).toBe(initialCount)
    })

    it('should throw when pausing inactive batch', () => {
      expect(() => setup.processor.pause('test-batch')).toThrow('not active')
    })

    it('should throw when resuming non-paused batch', async () => {
      setup.processor.start('test-batch')
      await tick()
      expect(() => setup.processor.resume('test-batch')).toThrow('not paused')
    })
  })

  // =========================================================================
  // State Recovery
  // =========================================================================

  describe('resume from persisted state', () => {
    it('should preserve partial progress when resuming after restart', async () => {
      setup.processor.start('test-batch')
      await tick()
      const sessionId = setup.createdSessions[0]!.sessionId
      setup.processor.onSessionComplete(sessionId, 'complete')
      await tick()

      // Simulate restart — dispose() saves running batches as paused
      setup.processor.dispose()
      const newProcessor = new BatchProcessor({
        ...setup.processor['options'],
        onExecutePrompt: setup.executePrompt,
      })

      // resume() preserves completed items; start() would reset them
      const progress = newProcessor.resume('test-batch')
      expect(progress.completedItems).toBe(1)
      expect(progress.status).toBe('running')
      newProcessor.dispose()
    })
  })

  // =========================================================================
  // Dispose
  // =========================================================================

  describe('dispose', () => {
    it('should save active batches as paused', () => {
      setup.processor.start('test-batch')
      setup.processor.dispose()

      const state = loadBatchState(setup.tempDir, 'test-batch')
      expect(state!.status).toBe('paused')
    })
  })

  // =========================================================================
  // Stop & Race Condition
  // =========================================================================

  describe('stop', () => {
    it('should not resurrect state file after stop during in-flight dispatch', async () => {
      let resolveDispatch: (() => void) | undefined
      const slowExecutePrompt = mock(async (_params: BatchExecutePromptParams) => {
        await new Promise<void>((resolve) => { resolveDispatch = resolve })
        return { sessionId: `session-slow` }
      })

      const tempDir = mkdtempSync(join(tmpdir(), 'batch-stop-race-'))
      writeFileSync(join(tempDir, 'companies.json'), JSON.stringify([
        { id: 'acme', name: 'Acme Corp', url: 'https://acme.com' },
      ]))
      writeFileSync(join(tempDir, 'batches.json'), JSON.stringify({
        version: 1,
        batches: [{
          id: 'race-batch',
          name: 'Race Test',
          source: { type: 'json', path: 'companies.json', idField: 'id' },
          execution: { maxConcurrency: 1 },
          action: { type: 'prompt', prompt: 'test $BATCH_ITEM_NAME' },
        }],
      }))

      const processor = new BatchProcessor({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        onExecutePrompt: slowExecutePrompt,
      })

      // Start — dispatch runs in background, blocked in slowExecutePrompt
      processor.start('race-batch')

      // Stop while dispatch is in-flight
      processor.stop('race-batch')

      // Delete the state file (like the IPC handler does)
      const stateFilePath = join(tempDir, `${BATCH_STATE_FILE_PREFIX}race-batch.json`)
      try { rmSync(stateFilePath) } catch { /* may not exist */ }

      // Resolve the in-flight dispatch
      resolveDispatch?.()
      await tick()

      // State file should NOT be resurrected
      expect(existsSync(stateFilePath)).toBe(false)

      rmSync(tempDir, { recursive: true, force: true })
    })
  })

  // =========================================================================
  // Cold Restart + Resume
  // =========================================================================

  describe('resume after restart', () => {
    it('should resume a paused batch after cold restart via resume()', () => {
      setup.processor.start('test-batch')
      setup.processor.pause('test-batch')
      const stateBeforeRestart = loadBatchState(setup.tempDir, 'test-batch')
      expect(stateBeforeRestart!.status).toBe('paused')

      // Simulate cold restart
      setup.processor.dispose()
      const newProcessor = new BatchProcessor({
        ...setup.processor['options'],
        onExecutePrompt: setup.executePrompt,
      })

      // resume() should load from disk and resume
      const progress = newProcessor.resume('test-batch')
      expect(progress.status).toBe('running')
      expect(progress.totalItems).toBe(3)

      newProcessor.dispose()
    })
  })

  // =========================================================================
  // Progress & State
  // =========================================================================

  describe('getProgress / getState', () => {
    it('should return null for unknown batch', () => {
      expect(setup.processor.getProgress('nonexistent')).toBeNull()
      expect(setup.processor.getState('nonexistent')).toBeNull()
    })

    it('should return progress for active batch', async () => {
      setup.processor.start('test-batch')
      await tick()
      const progress = setup.processor.getProgress('test-batch')
      expect(progress).not.toBeNull()
      expect(progress!.totalItems).toBe(3)
    })
  })

  // =========================================================================
  // Global Concurrency Cap (cross-batch)
  // =========================================================================

  describe('globalMaxConcurrentSessions', () => {
    it('caps concurrent sessions across batches and releases as items complete', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'batch-global-cap-'))
      writeFileSync(join(tempDir, 'companies.json'), JSON.stringify([
        { id: 'acme', name: 'Acme' },
      ]))
      // Three independent batches, each with maxConcurrency: 1.
      // Without a global cap, all 3 would spawn sessions immediately.
      writeFileSync(join(tempDir, 'batches.json'), JSON.stringify({
        version: 1,
        batches: [
          { id: 'b1', name: 'b1', source: { type: 'json', path: 'companies.json', idField: 'id' }, execution: { maxConcurrency: 1 }, action: { type: 'prompt', prompt: 'p $BATCH_ITEM_NAME' } },
          { id: 'b2', name: 'b2', source: { type: 'json', path: 'companies.json', idField: 'id' }, execution: { maxConcurrency: 1 }, action: { type: 'prompt', prompt: 'p $BATCH_ITEM_NAME' } },
          { id: 'b3', name: 'b3', source: { type: 'json', path: 'companies.json', idField: 'id' }, execution: { maxConcurrency: 1 }, action: { type: 'prompt', prompt: 'p $BATCH_ITEM_NAME' } },
        ],
      }))

      let counter = 0
      const sessions: { sessionId: string; batchId?: string }[] = []
      const executePrompt = mock(async (params: BatchExecutePromptParams) => {
        const sessionId = `s-${++counter}`
        sessions.push({ sessionId, batchId: params.batchContext?.batchId })
        // Real handler invokes this before sendMessage so the batch processor
        // can register the session→item mapping. The mock must do the same.
        params.onSessionCreated?.(sessionId)
        return { sessionId }
      })

      const processor = new BatchProcessor({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        onExecutePrompt: executePrompt,
        globalMaxConcurrentSessions: 2,
      })

      processor.start('b1')
      processor.start('b2')
      processor.start('b3')
      await tick()

      // Only 2 sessions should have spawned despite 3 batches each with their own slot
      expect(sessions).toHaveLength(2)
      expect(processor.getState('b3')!.items['acme']!.status).toBe('pending')

      // Complete one session; the queued batch's item should now dispatch
      processor.onSessionComplete(sessions[0]!.sessionId, 'complete')
      await tick()

      expect(sessions).toHaveLength(3)
      expect(processor.getState('b3')!.items['acme']!.status).toBe('running')

      processor.dispose()
      rmSync(tempDir, { recursive: true, force: true })
    })

    it('per-batch maxConcurrency still applies under global cap', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'batch-per-cap-'))
      writeFileSync(join(tempDir, 'companies.json'), JSON.stringify([
        { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' },
      ]))
      writeFileSync(join(tempDir, 'batches.json'), JSON.stringify({
        version: 1,
        batches: [
          { id: 'b1', name: 'b1', source: { type: 'json', path: 'companies.json', idField: 'id' }, execution: { maxConcurrency: 1 }, action: { type: 'prompt', prompt: 'p' } },
        ],
      }))

      const sessions: string[] = []
      let counter = 0
      const processor = new BatchProcessor({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        onExecutePrompt: async () => {
          const id = `s-${++counter}`
          sessions.push(id)
          return { sessionId: id }
        },
        globalMaxConcurrentSessions: 10,  // global cap is permissive
      })

      processor.start('b1')
      await tick()

      // Only 1 session despite 3 items and globalMax=10 — per-batch cap wins
      expect(sessions).toHaveLength(1)

      processor.dispose()
      rmSync(tempDir, { recursive: true, force: true })
    })
  })
})

describe('resolveGlobalMaxConcurrentSessions', () => {
  const ENV = GLOBAL_MAX_CONCURRENT_SESSIONS_ENV
  let previous: string | undefined

  beforeEach(() => {
    previous = process.env[ENV]
    delete process.env[ENV]
  })

  afterEach(() => {
    if (previous === undefined) delete process.env[ENV]
    else process.env[ENV] = previous
  })

  it('falls back to the default when unset', () => {
    expect(resolveGlobalMaxConcurrentSessions()).toBe(DEFAULT_GLOBAL_MAX_CONCURRENT_SESSIONS)
  })

  it('honors a positive integer override', () => {
    process.env[ENV] = '25'
    expect(resolveGlobalMaxConcurrentSessions()).toBe(25)
  })

  it('floors fractional values', () => {
    process.env[ENV] = '4.9'
    expect(resolveGlobalMaxConcurrentSessions()).toBe(4)
  })

  it('falls back on zero, negative, or non-numeric values', () => {
    for (const bad of ['0', '-3', 'abc', '']) {
      process.env[ENV] = bad
      expect(resolveGlobalMaxConcurrentSessions()).toBe(DEFAULT_GLOBAL_MAX_CONCURRENT_SESSIONS)
    }
  })
})
