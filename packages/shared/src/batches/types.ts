/**
 * Batch Processing System Type Definitions
 *
 * All types and interfaces for the batch processing system.
 */

import type { PermissionMode } from '../agent/mode-types.ts';

// ============================================================================
// Data Source Types
// ============================================================================

export type BatchSourceType = 'csv' | 'json' | 'jsonl'

export interface BatchSource {
  type: BatchSourceType
  /** Path to the data file (relative to workspace root or absolute) */
  path: string
  /** Field name to use as unique item identifier */
  idField: string
}

// ============================================================================
// Execution Configuration
// ============================================================================

export interface BatchExecution {
  /** Maximum number of concurrent sessions (default: 3) */
  maxConcurrency?: number
  /** Whether to retry failed items (default: false) */
  retryOnFailure?: boolean
  /** Maximum number of retries per item (default: 2) */
  maxRetries?: number
  /** Permission mode for created sessions */
  permissionMode?: PermissionMode
  /** Model ID for created sessions */
  model?: string
  /** LLM connection slug for created sessions */
  llmConnection?: string
}

// ============================================================================
// Action Types
// ============================================================================

export interface BatchPromptAction {
  type: 'prompt'
  /** Prompt template with $BATCH_ITEM_* variable placeholders */
  prompt: string
  /** Labels to apply to created sessions */
  labels?: string[]
  /** @mentions to resolve (sources/skills) */
  mentions?: string[]
}

// ============================================================================
// Output Configuration
// ============================================================================

export interface BatchOutputConfig {
  /** Output file path relative to workspace root (must be .jsonl) */
  path: string
  /** JSON Schema defining the expected structure of each output record */
  schema?: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface BatchConfig {
  /** Unique batch ID (auto-generated if omitted) */
  id?: string
  /** Display name */
  name: string
  /** Whether this batch is enabled */
  enabled?: boolean
  /** Working directory for sessions created by this batch (absolute path). Omit to use workspace default. */
  workingDirectory?: string
  /** Data source configuration */
  source: BatchSource
  /** Execution configuration */
  execution?: BatchExecution
  /** Action to perform for each item */
  action: BatchPromptAction
  /** Structured output configuration for collecting results */
  output?: BatchOutputConfig
}

export interface BatchesFileConfig {
  version?: number
  batches: BatchConfig[]
}

// ============================================================================
// Item State Types
// ============================================================================

export type BatchItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export interface BatchItemState {
  status: BatchItemStatus
  /** Session ID if running or completed */
  sessionId?: string
  startedAt?: number
  completedAt?: number
  /** Number of retry attempts */
  retryCount: number
  /** Error message if failed */
  error?: string
  /** Truncated expanded prompt (for display in item timeline) */
  summary?: string
}

// ============================================================================
// Batch State Types
// ============================================================================

export type BatchStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed'

export interface BatchState {
  batchId: string
  status: BatchStatus
  startedAt?: number
  completedAt?: number
  totalItems: number
  items: Record<string, BatchItemState>
}

export interface BatchProgress {
  batchId: string
  status: BatchStatus
  totalItems: number
  completedItems: number
  failedItems: number
  runningItems: number
  pendingItems: number
}

// ============================================================================
// System Options
// ============================================================================

export interface BatchExecutePromptParams {
  workspaceId: string
  workspaceRootPath: string
  prompt: string
  labels?: string[]
  permissionMode?: PermissionMode
  mentions?: string[]
  llmConnection?: string
  model?: string
  /** Working directory for the created session (absolute path). Omit to use workspace default. */
  workingDirectory?: string
  /** Batch context for structured output collection */
  batchContext?: {
    batchId: string
    itemId: string
    outputPath: string
    outputSchema?: Record<string, unknown>
  }
  /** Human-readable name for the session (used as title and triggeredBy metadata) */
  automationName?: string
}

export interface BatchSystemOptions {
  workspaceRootPath: string
  workspaceId: string
  /** Callback to create a session and execute a prompt */
  onExecutePrompt: (params: BatchExecutePromptParams) => Promise<{ sessionId: string }>
  /** Progress update callback */
  onProgress?: (progress: BatchProgress) => void
  /** Batch completion callback */
  onBatchComplete?: (batchId: string, status: BatchStatus) => void
  /** Error callback */
  onError?: (batchId: string, error: Error) => void
}

// ============================================================================
// Data Item Type
// ============================================================================

/** A single item loaded from the data source with all fields as strings */
export interface BatchItem {
  /** Unique item ID (value of idField) */
  id: string
  /** All fields from the data source (values coerced to strings) */
  fields: Record<string, string>
}

// ============================================================================
// Test Batch Types
// ============================================================================

export interface TestBatchResult {
  batchId: string
  testKey: string
  sampleSize: number
  status: 'completed' | 'failed'
  durationMs: number
  items: Array<{
    itemId: string
    status: BatchItemStatus
    sessionId?: string
    durationMs?: number
    error?: string
  }>
  outputPath?: string
}
