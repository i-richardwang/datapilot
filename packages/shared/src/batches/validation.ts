/**
 * Batch Config Validation
 *
 * Validators for batches.json configuration files.
 * Follows the same pattern as automations/validation.ts.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { BATCHES_CONFIG_FILE } from './constants.ts'
import { BatchesFileConfigSchema, zodErrorToIssues } from './schemas.ts'
import type { ValidationResult, ValidationIssue } from '../config/validators.ts'

/**
 * Validate batches config from a JSON string (no disk reads).
 * Used by config_validate tool to validate before writing to disk.
 */
export function validateBatchesContent(jsonString: string, fileName?: string): ValidationResult {
  const file = fileName ?? BATCHES_CONFIG_FILE
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  // Parse JSON
  let content: unknown
  try {
    content = JSON.parse(jsonString)
  } catch (e) {
    return {
      valid: false,
      errors: [{
        file,
        path: '',
        message: `Invalid JSON: ${e instanceof Error ? e.message : 'Unknown error'}`,
        severity: 'error',
      }],
      warnings: [],
    }
  }

  // Validate schema
  const result = BatchesFileConfigSchema.safeParse(content)
  if (!result.success) {
    errors.push(...zodErrorToIssues(result.error, file))
    return { valid: false, errors, warnings }
  }

  const config = result.data

  // Warn about empty batches
  if (config.batches.length === 0) {
    warnings.push({
      file,
      path: 'batches',
      message: 'No batches configured',
      severity: 'warning',
      suggestion: 'Add batch definitions to the batches array',
    })
  }

  // Per-batch semantic checks
  for (let i = 0; i < config.batches.length; i++) {
    const batch = config.batches[i]!

    // Warn about allow-all permission mode
    if (batch.execution?.permissionMode === 'allow-all') {
      warnings.push({
        file,
        path: `batches[${i}].execution.permissionMode`,
        message: 'permissionMode "allow-all" bypasses all security checks — use with caution',
        severity: 'warning',
        suggestion: 'Consider using "safe" or "ask" permission mode instead',
      })
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Validate batches.json from workspace path (reads from disk).
 * Follows the same pattern as validateAutomations().
 */
export function validateBatches(workspaceRoot: string): ValidationResult {
  const configPath = join(workspaceRoot, BATCHES_CONFIG_FILE)
  const file = BATCHES_CONFIG_FILE

  // Batches config is optional
  if (!existsSync(configPath)) {
    return { valid: true, errors: [], warnings: [] }
  }

  let raw: string
  try {
    raw = readFileSync(configPath, 'utf-8')
  } catch (e) {
    return {
      valid: false,
      errors: [{
        file,
        path: '',
        message: `Cannot read file: ${e instanceof Error ? e.message : 'Unknown error'}`,
        severity: 'error',
      }],
      warnings: [],
    }
  }

  // Content validation (schema + semantic)
  const contentResult = validateBatchesContent(raw)
  if (!contentResult.valid) {
    return contentResult
  }

  // Workspace-aware validations
  const warnings = [...contentResult.warnings]

  // Check that data source files exist
  try {
    const config = JSON.parse(raw) as { batches?: Array<{ name?: string; source?: { path?: string } }> }
    if (config.batches) {
      for (let i = 0; i < config.batches.length; i++) {
        const batch = config.batches[i]!
        const sourcePath = batch.source?.path
        if (sourcePath) {
          const resolved = isAbsolute(sourcePath) ? sourcePath : join(workspaceRoot, sourcePath)
          if (!existsSync(resolved)) {
            warnings.push({
              file,
              path: `batches[${i}].source.path`,
              message: `Data source file not found: ${sourcePath}`,
              severity: 'warning',
              suggestion: 'Create the file or update the path',
            })
          }
        }
      }
    }
  } catch {
    // JSON already validated above
  }

  return {
    valid: contentResult.errors.length === 0,
    errors: contentResult.errors,
    warnings,
  }
}
