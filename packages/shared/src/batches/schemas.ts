/**
 * Batch Processing Schema Definitions
 *
 * Zod schemas for validating batches.json configuration.
 */

import { z } from 'zod'
import type { ValidationIssue } from '../config/validators.ts'

// ============================================================================
// Zod Schemas
// ============================================================================

export const BatchSourceSchema = z.object({
  type: z.enum(['csv', 'json', 'jsonl']),
  path: z.string().min(1, 'Source path cannot be empty'),
  idField: z.string().min(1, 'ID field cannot be empty'),
})

export const BatchExecutionSchema = z.object({
  maxConcurrency: z.number().int().min(1).max(50).optional(),
  retryOnFailure: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  permissionMode: z.enum(['safe', 'ask', 'allow-all']).optional(),
  model: z.string().min(1).optional(),
  llmConnection: z.string().min(1).optional(),
})

export const BatchPromptActionSchema = z.object({
  type: z.literal('prompt'),
  prompt: z.string().min(1, 'Prompt cannot be empty'),
  labels: z.array(z.string()).optional(),
  mentions: z.array(z.string()).optional(),
})

export const BatchOutputConfigSchema = z.object({
  path: z.string().min(1, 'Output path cannot be empty'),
  schema: z.object({
    type: z.literal('object'),
    properties: z.record(z.string(), z.unknown()),
    required: z.array(z.string()).optional(),
  }).optional(),
})

export const BatchConfigSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Batch name cannot be empty'),
  enabled: z.boolean().optional(),
  source: BatchSourceSchema,
  execution: BatchExecutionSchema.optional(),
  action: BatchPromptActionSchema,
  output: BatchOutputConfigSchema.optional(),
})

export const BatchesFileConfigSchema = z.object({
  version: z.number().optional(),
  batches: z.array(BatchConfigSchema),
})

// ============================================================================
// Schema Utilities
// ============================================================================

/**
 * Convert Zod error to ValidationIssues (matches validators.ts pattern)
 */
export function zodErrorToIssues(error: z.ZodError, file: string): ValidationIssue[] {
  return error.issues.map((issue) => ({
    file,
    path: issue.path.join('.') || 'root',
    message: issue.message,
    severity: 'error' as const,
  }))
}
