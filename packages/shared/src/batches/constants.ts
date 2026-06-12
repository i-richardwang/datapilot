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

/** Env var to override the global concurrent-session ceiling at deploy time */
export const GLOBAL_MAX_CONCURRENT_SESSIONS_ENV = 'DATAPILOT_BATCH_GLOBAL_MAX_CONCURRENT_SESSIONS'

/**
 * Resolve the global concurrent-session ceiling. Reads
 * `DATAPILOT_BATCH_GLOBAL_MAX_CONCURRENT_SESSIONS` (a positive integer) and
 * falls back to {@link DEFAULT_GLOBAL_MAX_CONCURRENT_SESSIONS} when unset or
 * invalid. Evaluated at process start; changing the env mid-run requires a
 * restart to take effect.
 */
export function resolveGlobalMaxConcurrentSessions(): number {
  const v = Number(process.env[GLOBAL_MAX_CONCURRENT_SESSIONS_ENV])
  if (Number.isFinite(v) && v > 0) return Math.floor(v)
  return DEFAULT_GLOBAL_MAX_CONCURRENT_SESSIONS
}

/**
 * Throttle window for machine-driven progress emissions (item completions,
 * dispatch rounds, timeout sweeps). The first event in a quiet period emits
 * immediately; the rest of the burst coalesces into one trailing emission.
 * User-initiated transitions (start/pause/retry) and terminal transitions
 * bypass the throttle entirely.
 */
export const BATCH_PROGRESS_THROTTLE_MS = 200

/** Default maximum retry attempts per item */
export const DEFAULT_MAX_RETRIES = 2

/**
 * Default item timeout (undefined = no timeout). Only applied when
 * `execution.itemTimeoutMs` is explicitly set in the batch config.
 */
export const DEFAULT_ITEM_TIMEOUT_MS: number | undefined = undefined

/** Environment variable prefix for batch item fields */
export const BATCH_ITEM_ENV_PREFIX = 'BATCH_ITEM_'
