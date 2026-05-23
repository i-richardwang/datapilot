/** Canonical config filename for batch definitions */
export const BATCHES_CONFIG_FILE = 'batches.json'

/** Prefix for batch state files (e.g., batch-state-abc123.json) */
export const BATCH_STATE_FILE_PREFIX = 'batch-state-'

/** Default maximum concurrent sessions */
export const DEFAULT_MAX_CONCURRENCY = 3

/**
 * Default global ceiling on concurrent active sessions across all batches in
 * a workspace. Per-batch maxConcurrency still applies; the effective slot
 * count is the minimum of the two. Prevents a workspace with many batches
 * from spawning unbounded sessions and saturating the server event loop.
 */
export const DEFAULT_GLOBAL_MAX_CONCURRENT_SESSIONS = 5

/** Default maximum retry attempts per item */
export const DEFAULT_MAX_RETRIES = 2

/**
 * Default item timeout (undefined = no timeout). Only applied when
 * `execution.itemTimeoutMs` is explicitly set in the batch config.
 */
export const DEFAULT_ITEM_TIMEOUT_MS: number | undefined = undefined

/** Environment variable prefix for batch item fields */
export const BATCH_ITEM_ENV_PREFIX = 'BATCH_ITEM_'
