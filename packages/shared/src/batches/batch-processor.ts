/**
 * Batch Processor
 *
 * Core orchestrator for batch processing. Reads batch configurations,
 * loads data sources, manages concurrency, and dispatches items as
 * independent sessions via the onExecutePrompt callback.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { createLogger } from '../utils/debug.ts'
import { BATCHES_CONFIG_FILE, DEFAULT_MAX_CONCURRENCY, DEFAULT_GLOBAL_MAX_CONCURRENT_SESSIONS, DEFAULT_MAX_RETRIES, BATCH_ITEM_ENV_PREFIX, DEFAULT_ITEM_TIMEOUT_MS } from './constants.ts'
import { BatchesFileConfigSchema } from './schemas.ts'
import { loadBatchItems } from './data-source.ts'
import {
  loadBatchState,
  loadAllBatchStates,
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
import { expandEnvVars } from '../automations/utils.ts'
import { sanitizeForShell } from '../automations/security.ts'
import type {
  BatchConfig,
  BatchesFileConfig,
  BatchItem,
  BatchItemStatus,
  BatchState,
  BatchProgress,
  BatchSystemOptions,
  BatchExecutePromptParams,
  BatchItemsPage,
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

  /** Interval handle for periodic timeout checks */
  private timeoutCheckInterval: ReturnType<typeof setInterval> | null = null

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
          batch.id = randomBytes(8).toString('hex')
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
    return this.loadConfig()?.batches.find((b) => b.id === batchId)
  }

  /**
   * List all batch configurations with current progress.
   */
  listBatches(): Array<BatchConfig & { progress?: BatchProgress }> {
    const config = this.loadConfig()
    if (!config) return []

    return config.batches.map((batch) => {
      // Active batches compute from memory; inactive ones aggregate item
      // counts in SQL — loading full item state here made the batch list
      // parse several multi-MB blobs on every visit.
      const state = this.activeStates.get(batch.id!)
      const progress = state
        ? computeProgress(state)
        : loadBatchProgress(this.options.workspaceRootPath, batch.id!) ?? undefined
      return {
        ...batch,
        progress,
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
    saveBatchMeta(this.options.workspaceRootPath, state)

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
    const recoveredFromDisk = !this.activeStates.has(batchId)

    // Load into memory if needed (cold restart case)
    if (recoveredFromDisk) {
      this.ensureActive(batchId)
    }

    const state = this.activeStates.get(batchId)!

    if (state.status !== 'paused') {
      throw new Error(`Batch "${batchId}" is not paused (status: ${state.status})`)
    }

    if (recoveredFromDisk) {
      // Crash recovery: running items lost their in-memory session mappings on
      // restart, so they must be re-dispatched. During a normal pause/resume,
      // those mappings are still valid and running sessions should continue.
      const rePended = this.resetRunningItems(state)
      saveBatchItemStates(this.options.workspaceRootPath, state, rePended)
    }

    state.status = 'running'
    saveBatchMeta(this.options.workspaceRootPath, state)

    log.info(`[BatchProcessor] Resumed batch "${batchId}"`)

    return this.beginDispatching(batchId, state)
  }

  /**
   * Re-pend every in-flight (running) item back to pending. After the owning
   * process dies, a "running" item's in-memory session→item mapping is gone,
   * so onSessionComplete can never fire for it and it would stay running
   * forever — it must be re-dispatched from scratch. Mutates `state` in place;
   * the caller persists. Shared by resume() (cold-restart recovery) and
   * reconcileCrashedBatches() (boot-time recovery). Returns the re-pended
   * item IDs so callers can persist just those rows.
   */
  private resetRunningItems(state: BatchState): string[] {
    const rePended: string[] = []
    for (const [itemId, itemState] of Object.entries(state.items)) {
      if (itemState.status === 'running') {
        updateItemState(state, itemId, { status: 'pending', sessionId: undefined })
        rePended.push(itemId)
      }
    }
    return rePended
  }

  /**
   * Reconcile batches the server left `running` after a crash.
   *
   * A batch's `running` status is an in-memory, process-liveness fact that is
   * mirrored to disk only so the UI can show live progress. The single path
   * that flips it back to `paused` is dispose() on graceful shutdown. When the
   * server dies without one — power loss, `docker kill`, or a `docker stop`
   * that outruns the stop grace period before dispose() finishes — the on-disk
   * status is stranded at `running` with no live process behind it. That zombie
   * shows as active in the UI forever, pollutes status aggregates, and cannot be
   * paused via the normal API (it is not in `activeStates`).
   *
   * This is dispose()'s boot-time counterpart: it scans every persisted batch
   * state and, for any still `running`, flips it to `paused` and re-pends its
   * in-flight items so a later resume() re-dispatches them. Because the owning
   * process is gone, every disk-only `running` is by definition a crash
   * leftover. Idempotent; intended to run once per workspace when its
   * BatchProcessor is first initialised (before any batch is activated).
   *
   * Returns the IDs of the batches it reconciled (empty on a clean boot).
   */
  reconcileCrashedBatches(): string[] {
    const reconciled: string[] = []
    for (const state of loadAllBatchStates(this.options.workspaceRootPath)) {
      if (state.status !== 'running') continue
      // A genuinely active batch is tracked in memory; never touch one. At init
      // time activeStates is empty, so this only guards against misuse.
      if (this.activeStates.has(state.batchId)) continue

      state.status = 'paused'
      const rePended = this.resetRunningItems(state)
      saveBatchMeta(this.options.workspaceRootPath, state)
      saveBatchItemStates(this.options.workspaceRootPath, state, rePended)
      reconciled.push(state.batchId)
      log.info(`[BatchProcessor] Reconciled crashed batch "${state.batchId}": running → paused, re-pended in-flight items`)
    }
    return reconciled
  }

  /**
   * Retry a single item (failed, completed, or skipped). Resets it to pending
   * and dispatches if the batch is running. If the batch already completed/failed,
   * it is reactivated. Running and pending items cannot be retried.
   */
  retryItem(batchId: string, itemId: string): BatchProgress {
    // Load into memory if needed (cold restart / completed batch on disk only)
    if (!this.activeStates.has(batchId)) {
      this.ensureActive(batchId)
    }

    const state = this.activeStates.get(batchId)!
    const itemState = state.items[itemId]
    if (!itemState) {
      throw new Error(`Item "${itemId}" not found in batch "${batchId}"`)
    }
    if (itemState.status === 'running' || itemState.status === 'pending') {
      throw new Error(`Item "${itemId}" cannot be retried (status: ${itemState.status})`)
    }

    // Reset item to pending — preserve retryCount for historical tracking
    updateItemState(state, itemId, {
      status: 'pending',
      sessionId: undefined,
      completedAt: undefined,
      error: undefined,
    })

    saveBatchItemStates(this.options.workspaceRootPath, state, [itemId])

    if (state.status === 'completed' || state.status === 'failed') {
      // Reactivate a finished batch
      state.status = 'running'
      state.completedAt = undefined
      saveBatchMeta(this.options.workspaceRootPath, state)

      log.info(`[BatchProcessor] Retrying item "${itemId}" — reactivated batch "${batchId}"`)
      return this.beginDispatching(batchId, state)
    }

    if (state.status === 'running') {
      this.dispatchNext(batchId).catch((error) => {
        log.error(`[BatchProcessor] Failed to dispatch after retry for batch "${batchId}":`, error)
        this.options.onError?.(batchId, error instanceof Error ? error : new Error(String(error)))
      })
    }

    log.info(`[BatchProcessor] Retrying item "${itemId}" in batch "${batchId}" (batch status: ${state.status})`)

    const progress = computeProgress(state)
    this.options.onProgress?.(progress)
    return progress
  }

  /**
   * Retry every failed item in a batch at once. Resets each failed item to
   * pending (preserving retryCount for historical tracking) and dispatches.
   * Mirrors retryItem() but for the whole failed set. No-op if nothing failed.
   */
  retryFailedItems(batchId: string): BatchProgress {
    // Load into memory if needed (cold restart / completed batch on disk only)
    if (!this.activeStates.has(batchId)) {
      this.ensureActive(batchId)
    }

    const state = this.activeStates.get(batchId)!

    const failedIds = Object.entries(state.items)
      .filter(([, item]) => item.status === 'failed')
      .map(([itemId]) => itemId)

    if (failedIds.length === 0) {
      // Nothing to retry — return current progress unchanged.
      return computeProgress(state)
    }

    for (const itemId of failedIds) {
      // Reset item to pending — preserve retryCount for historical tracking
      updateItemState(state, itemId, {
        status: 'pending',
        sessionId: undefined,
        completedAt: undefined,
        error: undefined,
      })
    }

    saveBatchItemStates(this.options.workspaceRootPath, state, failedIds)

    if (state.status === 'completed' || state.status === 'failed') {
      // Reactivate a finished batch
      state.status = 'running'
      state.completedAt = undefined
      saveBatchMeta(this.options.workspaceRootPath, state)

      log.info(`[BatchProcessor] Retrying ${failedIds.length} failed items — reactivated batch "${batchId}"`)
      return this.beginDispatching(batchId, state)
    }

    if (state.status === 'running') {
      this.dispatchNext(batchId).catch((error) => {
        log.error(`[BatchProcessor] Failed to dispatch after retry-failed for batch "${batchId}":`, error)
        this.options.onError?.(batchId, error instanceof Error ? error : new Error(String(error)))
      })
    }

    log.info(`[BatchProcessor] Retrying ${failedIds.length} failed items in batch "${batchId}" (batch status: ${state.status})`)

    const progress = computeProgress(state)
    this.options.onProgress?.(progress)
    return progress
  }

  /**
   * Get progress for a batch. For inactive batches this aggregates item
   * counts in SQL instead of loading every item row into memory.
   */
  getProgress(batchId: string): BatchProgress | null {
    const state = this.activeStates.get(batchId)
    if (state) return computeProgress(state)
    return loadBatchProgress(this.options.workspaceRootPath, batchId)
  }

  /**
   * Get full state for a batch.
   */
  getState(batchId: string): BatchState | null {
    return this.activeStates.get(batchId) ?? loadBatchState(this.options.workspaceRootPath, batchId)
  }

  /**
   * Get a paginated slice of items for a batch. When `filterStatus` is
   * provided, only items matching that status are returned and `total`
   * reflects the filtered count.
   */
  getItems(batchId: string, offset: number, limit: number, filterStatus?: BatchItemStatus): BatchItemsPage | null {
    const state = this.activeStates.get(batchId) ?? loadBatchState(this.options.workspaceRootPath, batchId)
    if (!state) return null
    return getBatchItemsPage(state, offset, limit, filterStatus)
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
      // Clear any stale `error` left over from a previous failed attempt that
      // was auto-retried. Without this, a successful retry still shows the old
      // "error (retry N)" string in the UI (BatchItemTimeline prefers `error`
      // over `summary`), contradicting the green completed status.
      updateItemState(state, itemId, {
        status: 'completed',
        completedAt: Date.now(),
        error: undefined,
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
    saveBatchItemStates(this.options.workspaceRootPath, state, [itemId])

    // Check completion
    if (isBatchDone(state)) {
      this.completeBatch(batchId)
    }

    // Wake every running batch — the slot that just freed may be claimed by a
    // different batch than the one whose session ended. Without this, batches
    // queued behind the global cap would stay stuck even after slots open.
    this.dispatchAllRunning()

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
      const newIds: string[] = []
      for (const item of items) {
        if (!(item.id in state.items)) {
          state.items[item.id] = { status: 'pending', retryCount: 0 }
          state.totalItems++
          newIds.push(item.id)
        }
      }
      // Persist appended items immediately — callers like resume() only write
      // meta + changed rows afterwards, so new rows must exist by then.
      if (newIds.length > 0) {
        appendBatchItems(this.options.workspaceRootPath, state, newIds)
        saveBatchMeta(this.options.workspaceRootPath, state)
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

    this.startTimeoutCheckIfNeeded()

    return progress
  }

  // ============================================================================
  // Internal: Item Timeout
  // ============================================================================

  private startTimeoutCheckIfNeeded(): void {
    if (this.timeoutCheckInterval) return

    const hasTimeout = [...this.activeStates.keys()].some((batchId) => {
      const config = this.getBatchConfig(batchId)
      return config?.execution?.itemTimeoutMs != null
    })
    if (!hasTimeout) return

    this.timeoutCheckInterval = setInterval(() => this.checkItemTimeouts(), 30_000)
  }

  private stopTimeoutCheck(): void {
    // Only stop if no running batches with timeouts remain
    const hasRunningWithTimeout = [...this.activeStates.entries()].some(([batchId, state]) => {
      if (state.status !== 'running') return false
      return this.getBatchConfig(batchId)?.execution?.itemTimeoutMs != null
    })
    if (!hasRunningWithTimeout && this.timeoutCheckInterval) {
      clearInterval(this.timeoutCheckInterval)
      this.timeoutCheckInterval = null
    }
  }

  private checkItemTimeouts(): void {
    const now = Date.now()
    for (const [batchId, state] of this.activeStates) {
      if (state.status !== 'running') continue
      const config = this.getBatchConfig(batchId)
      const timeoutMs = config?.execution?.itemTimeoutMs ?? DEFAULT_ITEM_TIMEOUT_MS
      if (!timeoutMs) continue

      const timedOut: string[] = []
      for (const [itemId, item] of Object.entries(state.items)) {
        if (item.status !== 'running' || !item.startedAt) continue
        if ((now - item.startedAt) > timeoutMs) {
          log.warn(`[BatchProcessor] Item "${itemId}" in batch "${batchId}" timed out after ${Math.round((now - item.startedAt) / 1000)}s`)
          updateItemState(state, itemId, { status: 'failed', completedAt: now, error: 'timeout' })
          // The underlying session keeps running — it will complete on its own
          // and onSessionComplete will no-op (mapping already removed).
          if (item.sessionId) this.sessionToItem.delete(item.sessionId)
          timedOut.push(itemId)
        }
      }

      if (timedOut.length > 0) {
        saveBatchItemStates(this.options.workspaceRootPath, state, timedOut)
        this.options.onProgress?.(computeProgress(state))
        if (isBatchDone(state)) {
          this.completeBatch(batchId)
        } else {
          this.dispatchAllRunning()
        }
      }
    }
  }

  // ============================================================================
  // Internal: Dispatch Pipeline
  // ============================================================================

  /**
   * Count items currently running across every active batch in this workspace.
   * Used to enforce the global concurrency cap so that N batches each with
   * `maxConcurrency: 1` cannot collectively spawn N sessions and saturate the
   * server event loop.
   */
  private countGlobalRunning(): number {
    let count = 0
    for (const s of this.activeStates.values()) {
      for (const item of Object.values(s.items)) {
        if (item.status === 'running') count++
      }
    }
    return count
  }

  /**
   * Wake every active running batch so any with pending items can claim slots
   * that just freed up. Called when a session completes — the freed slot may
   * belong to a different batch than the one whose session ended.
   */
  private dispatchAllRunning(): void {
    for (const otherBatchId of this.activeStates.keys()) {
      const otherState = this.activeStates.get(otherBatchId)
      if (otherState?.status !== 'running') continue
      this.dispatchNext(otherBatchId).catch((error) => {
        log.error(`[BatchProcessor] Failed to dispatch items for batch "${otherBatchId}":`, error)
        this.options.onError?.(otherBatchId, error instanceof Error ? error : new Error(String(error)))
      })
    }
  }

  /**
   * Fill concurrency slots by dispatching pending items.
   */
  private async dispatchNext(batchId: string): Promise<void> {
    const state = this.activeStates.get(batchId)
    if (!state || state.status !== 'running') return

    const config = this.getBatchConfig(batchId)
    if (!config) return

    const maxConcurrency = config.execution?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY
    const globalMax = this.options.globalMaxConcurrentSessions ?? DEFAULT_GLOBAL_MAX_CONCURRENT_SESSIONS

    // Count running items and collect pending ones in dispatch order.
    // Order MUST come from itemOrder (mirrors batch_items.position) — not from
    // Object.keys/entries(state.items): item ids are often integer-like strings
    // (they come from the data source's idField), and JS objects iterate such
    // keys in ascending numeric order regardless of insertion order, which
    // would silently override the persisted ordering.
    const orderedIds = state.itemOrder ?? Object.keys(state.items)
    let runningCount = 0
    const pendingIds: string[] = []
    for (const itemId of orderedIds) {
      const status = state.items[itemId]?.status
      if (status === 'running') runningCount++
      else if (status === 'pending') pendingIds.push(itemId)
    }

    const globalRunning = this.countGlobalRunning()
    const batchSlots = maxConcurrency - runningCount
    const globalSlots = globalMax - globalRunning
    const slotsAvailable = Math.max(0, Math.min(batchSlots, globalSlots))
    const toDispatch = pendingIds.slice(0, slotsAvailable)

    if (toDispatch.length > 0) {
      log.debug(`[BatchProcessor] Dispatching ${toDispatch.length} items for batch "${batchId}" (batch ${runningCount}/${maxConcurrency}, global ${globalRunning}/${globalMax}, pending ${pendingIds.length})`)
    } else if (pendingIds.length > 0 && globalSlots <= 0) {
      log.debug(`[BatchProcessor] Batch "${batchId}" has ${pendingIds.length} pending but global cap reached (${globalRunning}/${globalMax})`)
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
      return
    }

    // If items failed during dispatch (no session created), remaining pending
    // items would be stranded because onSessionComplete never fires for them.
    // Re-dispatch to fill the freed slots.
    if (toDispatch.length > 0 && state.status === 'running') {
      const stillRunning = Object.values(state.items).filter(i => i.status === 'running').length
      const stillPending = Object.values(state.items).filter(i => i.status === 'pending').length
      if (stillPending > 0 && stillRunning < (config.execution?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY)) {
        this.dispatchNext(batchId).catch((error) => {
          log.error(`[BatchProcessor] Failed to re-dispatch items for batch "${batchId}":`, error)
          this.options.onError?.(batchId, error instanceof Error ? error : new Error(String(error)))
        })
      }
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
      saveBatchItemStates(this.options.workspaceRootPath, state, [itemId])
      return
    }

    // Build environment variables from item fields
    const env = this.buildItemEnv(item)

    // Expand prompt template with item variables
    const expandedPrompt = expandEnvVars(config.action.prompt, env)

    // Mark as running with a per-item summary for UI display. Prefer a preview
    // of the item's own fields (which is what actually distinguishes items in
    // a batch) over the expanded prompt prefix (which is identical for every
    // item when the template's variable slots come after the leading text).
    updateItemState(state, itemId, {
      status: 'running',
      startedAt: Date.now(),
      summary: buildItemSummary(item, config.source.idField, expandedPrompt),
    })
    saveBatchItemStates(this.options.workspaceRootPath, state, [itemId])

    try {
      const params: BatchExecutePromptParams = {
        workspaceId: this.options.workspaceId,
        workspaceRootPath: this.options.workspaceRootPath,
        prompt: expandedPrompt,
        labels: config.action.labels,
        permissionMode: config.execution?.permissionMode,
        toolProfile: config.execution?.toolProfile,
        mentions: config.action.mentions,
        llmConnection: config.execution?.llmConnection,
        model: config.execution?.model,
        workingDirectory: config.workingDirectory,
        automationName: `Batch: ${config.name} — ${itemId}`,
      }

      // Attach batch context (always present for batch sessions).
      // `outputPath` is only set when the batch has an `output` block — downstream
      // uses its presence to decide whether to expose the `batch_output` tool.
      params.batchContext = {
        batchId: batchId,
        itemId: itemId,
        outputPath: config.output ? resolve(this.options.workspaceRootPath, config.output.path) : undefined,
        outputSchema: config.output?.schema as Record<string, unknown> | undefined,
        toolProfile: config.execution?.toolProfile,
      }

      // Register the session→item mapping BEFORE processing starts.
      // executePromptAutomation awaits sendMessage which blocks until the agent
      // finishes. On completion, onProcessingStopped fires (without await) and
      // calls onSessionComplete — if the mapping isn't set yet, the batch item
      // stays stuck in "running" forever. With synchronous DB writes (SQLite),
      // the microtask ordering guarantees this race always loses.
      params.onSessionCreated = (sessionId) => {
        updateItemState(state, itemId, { sessionId })
        this.sessionToItem.set(sessionId, { batchId, itemId })
        saveBatchItemStates(this.options.workspaceRootPath, state, [itemId])
        log.debug(`[BatchProcessor] Dispatched item "${itemId}" → session ${sessionId}`)
      }

      await this.options.onExecutePrompt(params)

      // After await, batch may have been stopped/deleted — abort if so
      if (!this.activeStates.has(batchId)) {
        log.debug(`[BatchProcessor] Batch "${batchId}" was stopped during dispatch of item "${itemId}", skipping state update`)
        return
      }
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
      saveBatchItemStates(this.options.workspaceRootPath, state, [itemId])
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

    saveBatchMeta(this.options.workspaceRootPath, state)

    log.info(`[BatchProcessor] Batch "${batchId}" ${state.status}: ${progress.completedItems} completed, ${progress.failedItems} failed, ${progress.skippedItems} skipped`)

    this.stopTimeoutCheck()
    this.options.onBatchComplete?.(batchId, state.status, progress)
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
    if (this.timeoutCheckInterval) {
      clearInterval(this.timeoutCheckInterval)
      this.timeoutCheckInterval = null
    }

    for (const [batchId, state] of this.activeStates) {
      if (state.status === 'running') {
        state.status = 'paused'
        // Meta-only write: in-flight items stay `running` on disk and are
        // re-pended by resume()/reconcileCrashedBatches(). Keeping dispose
        // O(1) matters — it races the docker-stop grace period.
        saveBatchMeta(this.options.workspaceRootPath, state)
        log.debug(`[BatchProcessor] Saved batch "${batchId}" as paused during dispose`)
      }
    }
    this.activeStates.clear()
    this.sessionToItem.clear()
    this.batchItems.clear()

    log.debug(`[BatchProcessor] Disposed`)
  }
}

/**
 * Build a per-item summary line shown in the batch items timeline.
 *
 * Format: `value · value · value — <prompt prefix>`
 *   - Up to 3 non-empty, non-id field values (values only, no key prefix —
 *     keys would be redundant noise; values alone distinguish items).
 *   - Followed by a normalized truncated prompt as bonus context. The UI
 *     column is `flex-1 truncate`, so the prompt tail is hidden visually
 *     when the row is narrow but remains in the DOM for wider layouts.
 *   - When the item has no usable fields, only the prompt prefix is shown.
 *
 * Exported so the one-shot backfill script can regenerate summaries for
 * batches that completed before this helper existed.
 */
export function buildItemSummary(item: BatchItem, idField: string, expandedPrompt: string): string {
  const MAX_FIELDS = 3
  const MAX_VALUE_LEN = 40
  const PROMPT_MAX = 100

  const values: string[] = []
  for (const [key, value] of Object.entries(item.fields)) {
    if (values.length >= MAX_FIELDS) break
    if (key === idField) continue
    if (value == null) continue
    const sv = String(value).trim().replace(/\s+/g, ' ')
    if (!sv) continue
    values.push(sv.length > MAX_VALUE_LEN ? `${sv.slice(0, MAX_VALUE_LEN)}…` : sv)
  }
  const valuesPart = values.join(' · ')

  const promptNormalized = expandedPrompt.replace(/\s+/g, ' ').trim()
  const promptPart = promptNormalized.length > PROMPT_MAX
    ? `${promptNormalized.slice(0, PROMPT_MAX)}…`
    : promptNormalized

  if (valuesPart && promptPart) return `${valuesPart} — ${promptPart}`
  return valuesPart || promptPart
}
