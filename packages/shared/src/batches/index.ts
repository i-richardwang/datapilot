/**
 * Batch Processing System - Public API
 *
 * Barrel file that re-exports from all batch processing modules.
 */

// ============================================================================
// Types
// ============================================================================

export type {
  BatchToolProfile,
  BatchSourceType,
  BatchSource,
  BatchExecution,
  BatchPromptAction,
  BatchOutputConfig,
  BatchConfig,
  BatchesFileConfig,
  BatchItemStatus,
  BatchItemState,
  BatchStatus,
  BatchState,
  BatchProgress,
  BatchSystemOptions,
  BatchExecutePromptParams,
  BatchItem,
  TestBatchResult,
  PersistedTestResult,
  BatchItemsPage,
} from './types.ts'

// ============================================================================
// Constants
// ============================================================================

export {
  BATCHES_CONFIG_FILE,
  BATCH_STATE_FILE_PREFIX,
  BATCH_TEST_RESULT_FILE_PREFIX,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_MAX_RETRIES,
  BATCH_ITEM_ENV_PREFIX,
  DEFAULT_TEST_SAMPLE_SIZE,
  TEST_BATCH_SUFFIX,
} from './constants.ts'

// ============================================================================
// Schemas
// ============================================================================

export {
  BatchSourceSchema,
  BatchExecutionSchema,
  BatchPromptActionSchema,
  BatchOutputConfigSchema,
  BatchConfigSchema,
  BatchesFileConfigSchema,
  zodErrorToIssues,
} from './schemas.ts'

// ============================================================================
// Data Source
// ============================================================================

export { loadBatchItems } from './data-source.ts'

// ============================================================================
// State Manager
// ============================================================================

export {
  getBatchStatePath,
  loadBatchState,
  saveBatchState,
  createInitialBatchState,
  updateItemState,
  computeProgress,
  isBatchDone,
  getTestResultPath,
  saveTestResult,
  loadTestResult,
  deleteTestResult,
  getBatchItemsPage,
} from './batch-state-manager.ts'

// ============================================================================
// Validation
// ============================================================================

export { validateBatchesContent, validateBatches } from './validation.ts'

// ============================================================================
// Output Instruction
// ============================================================================

export { buildBatchOutputInstruction } from './output-instruction.ts'

// ============================================================================
// Processor
// ============================================================================

export { BatchProcessor } from './batch-processor.ts'
