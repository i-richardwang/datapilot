/**
 * Batch Processor
 *
 * Core orchestrator for batch processing. Reads batch configurations,
 * loads data sources, manages concurrency, and dispatches items as
 * independent sessions via the onExecutePrompt callback.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createLogger } from '../utils/debug.ts'
import { BATCHES_CONFIG_FILE, DEFAULT_MAX_CONCURRENCY, DEFAULT_MAX_RETRIES, BATCH_ITEM_ENV_PREFIX } from './constants.ts'
import { BatchesFileConfigSchema } from './schemas.ts'
import { loadBatchItems } from './data-source.ts'
import {
  loadBatchState,
  saveBatchState,
  createInitialBatchState,
  updateItemState,
  computeProgress,
  isBatchDone,
} from './batch-state-manager.ts'
import { expandEnvVars } from '../automations/utils.ts'
import { sanitizeForShell } from '../automations/security.ts'
import type {
  BatchConfig,
  BatchesFileConfig,
  BatchItem,
  BatchState,
  BatchProgress,
  BatchSystemOptions,
  BatchExecutePromptParams,
} from './types.ts'

const log = createLogger('batch-processor')

export class BatchProcessor {
  private options: BatchSystemOptions

  /** Loaded batch items keyed by batchId → itemId → BatchItem */
  private batchItems: Map<string, Map<string, BatchItem>> = new Map()

  /** Active batch states keyed by batchId (in-memory mirror of persisted state) */
  private activeStates: Map<string, BatchState> = new Map()

  /** Reverse lookup: sessionId → { batchId, itemId } */
  private sessionToItem: Map<string, { batchId: string; itemId: string }> = new Map()

  constructor(options: BatchSystemOptions) {
    this.options = options
    log.debug(`[BatchProcessor] Created for workspace: ${options.workspaceId}`)
  }

  // ============================================================================
  // Configuration Management
  // ============================================================================

  /**
   * Backfill missing IDs in batches.json and write back to disk.
   * Called once at init time to ensure all batches have stable, persisted IDs.
   */
  ensureConfigIds(): void {
    const configPath = join(this.options.workspaceRootPath, BATCHES_CONFIG_FILE)
    if (!existsSync(configPath)) return

    try {
      const content = readFileSync(configPath, 'utf-8')
      const raw = JSON.parse(content)
      if (!Array.isArray(raw?.batches)) return

      let changed = false
      for (const batch of raw.batches) {
        if (typeof batch === 'object' && batch !== null && !batch.id) {
          batch.id = randomBytes(3).toString('hex')
          changed = true
        }
      }

      if (changed) {
        writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n', 'utf-8')
        log.info(`[BatchProcessor] Backfilled missing batch IDs in batches.json`)
      }
    } catch {
      // Non-critical: IDs will be assigned on next mutation
    }
  }

  /**
   * Load and validate batches.json from the workspace root.
   */
  loadConfig(): BatchesFileConfig | null {
    const configPath = join(this.options.workspaceRootPath, BATCHES_CONFIG_FILE)
    try {
      const content = readFileSync(configPath, 'utf-8')
      const raw = JSON.parse(content)
      const result = BatchesFileConfigSchema.safeParse(raw)
      if (!result.success) {
        log.error(`[BatchProcessor] Invalid batches.json: ${result.error.message}`)
        this.options.onError?.('config', new Error(`Invalid batches.json: ${result.error.message}`))
        return null
      }

      log.debug(`[BatchProcessor] Loaded ${result.data.batches.length} batch definitions`)
      return result.data as BatchesFileConfig
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        log.debug(`[BatchProcessor] No batches.json found at ${configPath}`)
        return null // No config file is fine
      }
      log.error(`[BatchProcessor] Failed to load batches.json:`, error)
      this.options.onError?.('config', error instanceof Error ? error : new Error(String(error)))
      return null
    }
  }

  /**
   * Get a specific batch configuration by ID.
   */
  getBatchConfig(batchId: string): BatchConfig | undefined {
    const config = this.loadConfig()
    return config?.batches.find((b) => b.id === batchId)
  }

  /**
   * List all batch configurations with current progress.
   */
  listBatches(): Array<BatchConfig & { progress?: BatchProgress }> {
    const config = this.loadConfig()
    if (!config) return []

    return config.batches.map((batch) => {
      const state = this.activeStates.get(batch.id!) ?? loadBatchState(this.options.workspaceRootPath, batch.id!)
      return {
        ...batch,
        progress: state ? computeProgress(state) : undefined,
      }
    })
  }

  // ============================================================================
  // Batch Lifecycle
  // ============================================================================

  /**
   * Start (or restart) a batch. Loads data, creates/resumes state, begins
   * dispatching in the background. Returns initial progress immediately.
   */
  start(batchId: string): BatchProgress {
    const state = this.ensureActive(batchId)

    // Full (re)start: reset every item to pending so the batch re-executes
    for (const itemId of Object.keys(state.items)) {
      updateItemState(state, itemId, {
        status: 'pending',
        sessionId: undefined,
        startedAt: undefined,
        completedAt: undefined,
        error: undefined,
        retryCount: 0,
      })
    }

    state.status = 'running'
    state.startedAt = Date.now()
    state.completedAt = undefined
    saveBatchState(this.options.workspaceRootPath, state)

    const config = this.getBatchConfig(batchId)!
    log.info(`[BatchProcessor] Started batch "${batchId}" with ${state.totalItems} items (maxConcurrency: ${config.execution?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY})`)

    return this.beginDispatching(batchId, state)
  }

  /**
   * Pause a batch. Running sessions continue but no new items are dispatched.
   */
  pause(batchId: string): BatchProgress {
    const state = this.activeStates.get(batchId)
    if (!state) {
      throw new Error(`Batch "${batchId}" is not active`)
    }

    state.status = 'paused'
    saveBatchState(this.options.workspaceRootPath, state)

    log.info(`[BatchProcessor] Paused batch "${batchId}"`)

    const progress = computeProgress(state)
    this.options.onProgress?.(progress)
    return progress
  }

  /**
   * Resume a paused batch. After a cold restart the batch may only exist on
   * disk — ensureActive() transparently loads it back into memory.
   */
  resume(batchId: string): BatchProgress {
    // Load into memory if needed (cold restart case)
    if (!this.activeStates.has(batchId)) {
      this.ensureActive(batchId)
    }

    const state = this.activeStates.get(batchId)!

    if (state.status !== 'paused') {
      throw new Error(`Batch "${batchId}" is not paused (status: ${state.status})`)
    }

    // Crash recovery: running items lost their sessions on restart
    for (const [itemId, itemState] of Object.entries(state.items)) {
      if (itemState.status === 'running') {
        updateItemState(state, itemId, { status: 'pending', sessionId: undefined })
      }
    }

    state.status = 'running'
    saveBatchState(this.options.workspaceRootPath, state)

    log.info(`[BatchProcessor] Resumed batch "${batchId}"`)

    return this.beginDispatching(batchId, state)
  }

  /**
   * Get progress for a batch.
   */
  getProgress(batchId: string): BatchProgress | null {
    const state = this.activeStates.get(batchId) ?? loadBatchState(this.options.workspaceRootPath, batchId)
    return state ? computeProgress(state) : null
  }

  /**
   * Get full state for a batch.
   */
  getState(batchId: string): BatchState | null {
    return this.activeStates.get(batchId) ?? loadBatchState(this.options.workspaceRootPath, batchId)
  }

  // ============================================================================
  // Session Completion Callback
  // ============================================================================

  /**
   * Handle session completion. Called by SessionManager when a session stops.
   * Returns true if the session belonged to a batch item.
   */
  onSessionComplete(sessionId: string, reason: 'complete' | 'interrupted' | 'error' | 'timeout'): boolean {
    const mapping = this.sessionToItem.get(sessionId)
    if (!mapping) return false

    const { batchId, itemId } = mapping
    const state = this.activeStates.get(batchId)
    if (!state) return false

    const config = this.getBatchConfig(batchId)
    const itemState = state.items[itemId]
    if (!itemState) return false

    if (reason === 'complete') {
      updateItemState(state, itemId, {
        status: 'completed',
        completedAt: Date.now(),
      })
      log.debug(`[BatchProcessor] Item "${itemId}" completed in batch "${batchId}"`)
    } else {
      // Check retry eligibility
      const shouldRetry = config?.execution?.retryOnFailure &&
        itemState.retryCount < (config.execution.maxRetries ?? DEFAULT_MAX_RETRIES)

      if (shouldRetry) {
        updateItemState(state, itemId, {
          status: 'pending',
          sessionId: undefined,
          retryCount: itemState.retryCount + 1,
          error: `${reason} (retry ${itemState.retryCount + 1})`,
        })
        log.info(`[BatchProcessor] Item "${itemId}" failed (${reason}), retrying (attempt ${itemState.retryCount + 1})`)
      } else {
        updateItemState(state, itemId, {
          status: 'failed',
          completedAt: Date.now(),
          error: reason,
        })
        log.warn(`[BatchProcessor] Item "${itemId}" failed permanently in batch "${batchId}": ${reason}`)
      }
    }

    this.sessionToItem.delete(sessionId)
    saveBatchState(this.options.workspaceRootPath, state)

    // Check completion
    if (isBatchDone(state)) {
      this.completeBatch(batchId)
    } else if (state.status === 'running') {
      // Dispatch next items to fill concurrency slots
      this.dispatchNext(batchId).catch((error) => {
        log.error(`[BatchProcessor] Failed to dispatch next items for batch "${batchId}":`, error)
        this.options.onError?.(batchId, error instanceof Error ? error : new Error(String(error)))
      })
    }

    // Notify progress
    const progress = computeProgress(state)
    this.options.onProgress?.(progress)

    return true
  }

  // ============================================================================
  // Internal: Activation & Dispatching
  // ============================================================================

  /**
   * Load a batch into memory: validate config, load data source, create or
   * recover state. Pure loading — no item reset logic. Called by start() and
   * resume() before they apply their own reset semantics.
   */
  private ensureActive(batchId: string): BatchState {
    const config = this.getBatchConfig(batchId)
    if (!config) {
      throw new Error(`Batch "${batchId}" not found in configuration`)
    }
    if (config.enabled === false) {
      throw new Error(`Batch "${batchId}" is disabled`)
    }

    // Load data source
    const items = loadBatchItems(config.source, this.options.workspaceRootPath)
    log.info(`[BatchProcessor] Loaded ${items.length} items from ${config.source.path} for batch "${batchId}"`)

    const itemMap = new Map<string, BatchItem>()
    for (const item of items) {
      itemMap.set(item.id, item)
    }
    this.batchItems.set(batchId, itemMap)

    // Create or recover state
    let state = loadBatchState(this.options.workspaceRootPath, batchId)

    if (state) {
      log.info(`[BatchProcessor] Recovering batch "${batchId}" from persisted state`)
      // Add any new items that appeared in the data source
      for (const item of items) {
        if (!(item.id in state.items)) {
          state.items[item.id] = { status: 'pending', retryCount: 0 }
          state.totalItems++
        }
      }
    } else {
      state = createInitialBatchState(batchId, items.map((i) => i.id))
    }

    this.activeStates.set(batchId, state)
    return state
  }

  /**
   * Emit initial progress and kick off background dispatching.
   * Returns the progress snapshot for the caller.
   */
  private beginDispatching(batchId: string, state: BatchState): BatchProgress {
    const progress = computeProgress(state)
    this.options.onProgress?.(progress)

    this.dispatchNext(batchId).catch((error) => {
      log.error(`[BatchProcessor] Failed to dispatch items for batch "${batchId}":`, error)
      this.options.onError?.(batchId, error instanceof Error ? error : new Error(String(error)))
    })

    return progress
  }

  // ============================================================================
  // Internal: Dispatch Pipeline
  // ============================================================================

  /**
   * Fill concurrency slots by dispatching pending items.
   */
  private async dispatchNext(batchId: string): Promise<void> {
    const state = this.activeStates.get(batchId)
    if (!state || state.status !== 'running') return

    const config = this.getBatchConfig(batchId)
    if (!config) return

    const maxConcurrency = config.execution?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY

    // Count currently running items
    let runningCount = 0
    for (const item of Object.values(state.items)) {
      if (item.status === 'running') runningCount++
    }

    // Find pending items and dispatch
    const pendingIds: string[] = []
    for (const [itemId, item] of Object.entries(state.items)) {
      if (item.status === 'pending') {
        pendingIds.push(itemId)
      }
    }

    const slotsAvailable = maxConcurrency - runningCount
    const toDispatch = pendingIds.slice(0, slotsAvailable)

    if (toDispatch.length > 0) {
      log.debug(`[BatchProcessor] Dispatching ${toDispatch.length} items for batch "${batchId}" (running: ${runningCount}, pending: ${pendingIds.length})`)
    }

    await Promise.allSettled(
      toDispatch.map((itemId) => this.dispatchItem(batchId, itemId, config))
    )

    // Notify progress after dispatch round so UI sees item state transitions
    if (toDispatch.length > 0 && this.activeStates.has(batchId)) {
      this.options.onProgress?.(computeProgress(state))
    }

    // Check if all items finished during dispatch (e.g. all session creations failed)
    if (isBatchDone(state)) {
      this.completeBatch(batchId)
    }
  }

  /**
   * Dispatch a single item: build env vars, expand prompt, create session.
   */
  private async dispatchItem(batchId: string, itemId: string, config: BatchConfig): Promise<void> {
    const state = this.activeStates.get(batchId)
    if (!state) return

    const itemMap = this.batchItems.get(batchId)
    const item = itemMap?.get(itemId)
    if (!item) {
      log.warn(`[BatchProcessor] Item "${itemId}" not found in data source, skipping`)
      updateItemState(state, itemId, { status: 'skipped', error: 'Item not found in data source' })
      saveBatchState(this.options.workspaceRootPath, state)
      return
    }

    // Build environment variables from item fields
    const env = this.buildItemEnv(item)

    // Expand prompt template with item variables
    const expandedPrompt = expandEnvVars(config.action.prompt, env)

    // Mark as running with truncated prompt summary for UI display
    updateItemState(state, itemId, {
      status: 'running',
      startedAt: Date.now(),
      summary: expandedPrompt.length > 100 ? expandedPrompt.slice(0, 100) + '…' : expandedPrompt,
    })
    saveBatchState(this.options.workspaceRootPath, state)

    try {
      const params: BatchExecutePromptParams = {
        workspaceId: this.options.workspaceId,
        workspaceRootPath: this.options.workspaceRootPath,
        prompt: expandedPrompt,
        labels: config.action.labels,
        permissionMode: config.execution?.permissionMode,
        mentions: config.action.mentions,
        llmConnection: config.execution?.llmConnection,
        model: config.execution?.model,
      }

      const result = await this.options.onExecutePrompt(params)

      // After await, batch may have been stopped/deleted — abort if so
      if (!this.activeStates.has(batchId)) {
        log.debug(`[BatchProcessor] Batch "${batchId}" was stopped during dispatch of item "${itemId}", skipping state update`)
        return
      }

      // Record session mapping for completion callback
      updateItemState(state, itemId, { sessionId: result.sessionId })
      this.sessionToItem.set(result.sessionId, { batchId, itemId })
      saveBatchState(this.options.workspaceRootPath, state)

      log.debug(`[BatchProcessor] Dispatched item "${itemId}" → session ${result.sessionId}`)
    } catch (error) {
      // After await, batch may have been stopped/deleted — abort if so
      if (!this.activeStates.has(batchId)) {
        log.debug(`[BatchProcessor] Batch "${batchId}" was stopped during dispatch of item "${itemId}", ignoring error`)
        return
      }

      log.error(`[BatchProcessor] Failed to dispatch item "${itemId}":`, error)
      updateItemState(state, itemId, {
        status: 'failed',
        completedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      })
      saveBatchState(this.options.workspaceRootPath, state)
    }
  }

  /**
   * Build environment variables from a batch item's fields.
   * Each field becomes $BATCH_ITEM_{FIELD_NAME} with shell-safe values.
   */
  private buildItemEnv(item: BatchItem): Record<string, string> {
    const env: Record<string, string> = {}

    for (const [key, value] of Object.entries(item.fields)) {
      const envKey = `${BATCH_ITEM_ENV_PREFIX}${key.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`
      env[envKey] = sanitizeForShell(value)
    }

    // Also provide the item ID directly
    env[`${BATCH_ITEM_ENV_PREFIX}ID`] = sanitizeForShell(item.id)

    return env
  }

  /**
   * Mark a batch as completed and clean up active state.
   */
  private completeBatch(batchId: string): void {
    const state = this.activeStates.get(batchId)
    if (!state) return

    const progress = computeProgress(state)
    state.status = progress.failedItems > 0 ? 'failed' : 'completed'
    state.completedAt = Date.now()

    saveBatchState(this.options.workspaceRootPath, state)

    log.info(`[BatchProcessor] Batch "${batchId}" ${state.status}: ${progress.completedItems} completed, ${progress.failedItems} failed`)

    this.options.onBatchComplete?.(batchId, state.status)
    this.options.onProgress?.(computeProgress(state))
  }

  /**
   * Stop a specific batch and clean up its in-memory state.
   * Running sessions will finish but no new items will be dispatched,
   * and session completions will no longer write state back to disk.
   */
  stop(batchId: string): void {
    this.activeStates.delete(batchId)
    this.batchItems.delete(batchId)

    // Remove all sessionToItem mappings for this batch
    for (const [sessionId, mapping] of this.sessionToItem) {
      if (mapping.batchId === batchId) {
        this.sessionToItem.delete(sessionId)
      }
    }

    log.info(`[BatchProcessor] Stopped batch "${batchId}" and cleaned up in-memory state`)
  }

  /**
   * Save all active batch states as paused. Called during cleanup.
   */
  dispose(): void {
    for (const [batchId, state] of this.activeStates) {
      if (state.status === 'running') {
        state.status = 'paused'
        saveBatchState(this.options.workspaceRootPath, state)
        log.debug(`[BatchProcessor] Saved batch "${batchId}" as paused during dispose`)
      }
    }
    this.activeStates.clear()
    this.sessionToItem.clear()
    this.batchItems.clear()
    log.debug(`[BatchProcessor] Disposed`)
  }
}
