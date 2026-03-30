/**
 * craft-agent batch update <id> [flags] [--patch <json>]
 *
 * Update a batch config using flags and/or a raw JSON patch.
 * Flags take precedence over --patch values.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { BatchesFileConfigSchema, validateBatchesContent } from '@craft-agent/shared/batches'
import { findBatch } from './get.ts'
import { colors as c } from '../format.ts'

export function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target }
  for (const [key, val] of Object.entries(source)) {
    if (val === null) {
      // RFC 7386 (JSON Merge Patch): null means "remove this field"
      delete result[key]
    } else if (typeof val === 'object' && !Array.isArray(val) &&
        typeof result[key] === 'object' && result[key] !== null && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, val as Record<string, unknown>)
    } else {
      result[key] = val
    }
  }
  return result
}

export interface UpdateOptions {
  name?: string
  prompt?: string
  source?: string
  idField?: string
  concurrency?: number
  model?: string | null
  connection?: string | null
  permissionMode?: 'safe' | 'ask' | 'allow-all' | null
  labels?: string[] | null
  workingDirectory?: string | null
  enabled?: boolean
  outputPath?: string | null
  outputSchema?: string | null
  patch?: string
}

/**
 * Build a patch object from structured flags.
 * Only includes fields that were explicitly provided.
 */
function buildPatchFromFlags(opts: UpdateOptions): Record<string, unknown> {
  const patch: Record<string, unknown> = {}

  if (opts.name !== undefined) patch.name = opts.name
  if (opts.enabled !== undefined) patch.enabled = opts.enabled
  if (opts.workingDirectory !== undefined) patch.workingDirectory = opts.workingDirectory

  // Source fields
  const sourcePatch: Record<string, unknown> = {}
  if (opts.source !== undefined) {
    sourcePatch.path = opts.source
    const ext = opts.source.split('.').pop()?.toLowerCase() ?? ''
    if (['csv', 'json', 'jsonl'].includes(ext)) sourcePatch.type = ext
  }
  if (opts.idField !== undefined) sourcePatch.idField = opts.idField
  if (Object.keys(sourcePatch).length > 0) patch.source = sourcePatch

  // Action fields
  const actionPatch: Record<string, unknown> = {}
  if (opts.prompt !== undefined) actionPatch.prompt = opts.prompt
  if (opts.labels !== undefined) actionPatch.labels = opts.labels
  if (Object.keys(actionPatch).length > 0) patch.action = actionPatch

  // Execution fields
  const execPatch: Record<string, unknown> = {}
  if (opts.concurrency !== undefined) execPatch.maxConcurrency = opts.concurrency
  if (opts.model !== undefined) execPatch.model = opts.model
  if (opts.connection !== undefined) execPatch.llmConnection = opts.connection
  if (opts.permissionMode !== undefined) execPatch.permissionMode = opts.permissionMode
  if (Object.keys(execPatch).length > 0) patch.execution = execPatch

  // Output fields — clearing output-path clears the entire output block
  if (opts.outputPath === null) {
    patch.output = null
  } else {
    const outputPatch: Record<string, unknown> = {}
    if (opts.outputPath !== undefined) outputPatch.path = opts.outputPath
    if (opts.outputSchema !== undefined) {
      if (opts.outputSchema === null) {
        outputPatch.schema = null
      } else {
        try {
          outputPatch.schema = JSON.parse(opts.outputSchema)
        } catch {
          console.error('Invalid --output-schema JSON:', opts.outputSchema)
          process.exit(1)
        }
      }
    }
    if (Object.keys(outputPatch).length > 0) patch.output = outputPatch
  }

  return patch
}

export function cmdUpdate(workspaceRoot: string, idOrName: string, opts: UpdateOptions, asJson: boolean): void {
  const configPath = join(workspaceRoot, 'batches.json')
  if (!existsSync(configPath)) {
    console.error('No batches.json found in workspace.')
    process.exit(1)
  }

  // Build patch: start with --patch JSON, then overlay flags (flags win)
  let patchObj: Record<string, unknown> = {}
  if (opts.patch) {
    try {
      patchObj = JSON.parse(opts.patch)
    } catch {
      console.error('Invalid --patch JSON:', opts.patch)
      process.exit(1)
    }
  }
  const flagPatch = buildPatchFromFlags(opts)
  patchObj = deepMerge(patchObj, flagPatch)

  const raw = readFileSync(configPath, 'utf-8')
  const parsed = BatchesFileConfigSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    console.error('Invalid batches.json:', parsed.error.message)
    process.exit(1)
  }

  const batch = findBatch(parsed.data.batches, idOrName)
  if (!batch) {
    console.error(`Batch not found: ${idOrName}`)
    process.exit(1)
  }

  const updated = deepMerge(batch as unknown as Record<string, unknown>, patchObj)

  // Clean up empty optional parent objects left after field clearing
  for (const key of ['execution', 'output']) {
    const val = updated[key]
    if (val && typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) {
      delete updated[key]
    }
  }

  const newBatches = parsed.data.batches.map(b => (b === batch ? updated : b))
  const newConfig = { ...parsed.data, batches: newBatches }
  const json = JSON.stringify(newConfig, null, 2)

  const validation = validateBatchesContent(json)
  if (!validation.valid) {
    console.error('Validation failed:')
    for (const err of validation.errors) {
      console.error(c.red + `  ${err.path}: ${err.message}` + c.reset)
    }
    process.exit(1)
  }

  writeFileSync(configPath, json + '\n', 'utf-8')

  if (asJson) {
    console.log(JSON.stringify(updated, null, 2))
  } else {
    console.log(c.green + `✓ Updated batch "${batch.name}"` + c.reset)
  }
}
