/** Canonical config filename for batch definitions */
export const BATCHES_CONFIG_FILE = 'batches.json'

/** Prefix for batch state files (e.g., batch-state-abc123.json) */
export const BATCH_STATE_FILE_PREFIX = 'batch-state-'

/** Default maximum concurrent sessions */
export const DEFAULT_MAX_CONCURRENCY = 3

/** Default maximum retry attempts per item */
export const DEFAULT_MAX_RETRIES = 2

/** Environment variable prefix for batch item fields */
export const BATCH_ITEM_ENV_PREFIX = 'BATCH_ITEM_'

/** Default number of items to sample when testing a batch */
export const DEFAULT_TEST_SAMPLE_SIZE = 3

/** Suffix appended to batch ID to form the virtual test key */
export const TEST_BATCH_SUFFIX = '__test'

/** Prefix for persisted test result files (e.g., batch-test-result-abc123.json) */
export const BATCH_TEST_RESULT_FILE_PREFIX = 'batch-test-result-'

