/**
 * Batch commands — 10 actions
 *
 * Storage: batches.json for config + workspace.db for runtime state
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { ok, fail } from '../envelope.ts'
import { strFlag, boolFlag, intFlag, listFlag } from '../args.ts'
import { parseInput } from '../input.ts'
import {
  BatchesFileConfigSchema,
  validateBatchesContent,
  validateBatches,
  loadBatchState,
  saveBatchState,
  updateItemState,
  computeProgress,
} from '@craft-agent/shared/batches'
import type { BatchConfig, BatchesFileConfig } from '@craft-agent/shared/batches'

const BATCHES_FILE = 'batches.json'

export function routeBatch(
  ws: string,
  action: string | undefined,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  if (!action) ok({
    usage: 'datapilot batch <action> [args] [--flags]',
    actions: ['list', 'get', 'create', 'update', 'delete', 'enable', 'disable', 'validate', 'status', 'retry'],
  })

  switch (action) {
    case 'list': return cmdList(ws)
    case 'get': return cmdGet(ws, positionals)
    case 'create': return cmdCreate(ws, flags)
    case 'update': return cmdUpdate(ws, positionals, flags)
    case 'delete': return cmdDelete(ws, positionals)
    case 'enable': return cmdToggle(ws, positionals, true)
    case 'disable': return cmdToggle(ws, positionals, false)
    case 'validate': return cmdValidate(ws)
    case 'status': return cmdStatus(ws, positionals, flags)
    case 'retry': return cmdRetry(ws, positionals)
    default:
      fail('USAGE_ERROR', `Unknown batch action: ${action}`)
  }
}

// ─── config helpers ────────────���─────────────────────────────────────────────

function configPath(ws: string): string {
  return join(ws, BATCHES_FILE)
}

function loadConfig(ws: string): BatchesFileConfig {
  const path = configPath(ws)
  if (!existsSync(path)) {
    return { batches: [] }
  }
  const raw = readFileSync(path, 'utf-8')
  const parsed = BatchesFileConfigSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    fail('VALIDATION_ERROR', `Invalid ${BATCHES_FILE}: ${parsed.error.message}`)
  }
  return parsed.data
}

function saveConfig(ws: string, config: BatchesFileConfig): void {
  const json = JSON.stringify(config, null, 2)
  const validation = validateBatchesContent(json)
  if (!validation.valid) {
    const messages = validation.errors.map(e => `${e.path}: ${e.message}`).join('; ')
    fail('VALIDATION_ERROR', `Invalid batch config: ${messages}`)
  }
  writeFileSync(configPath(ws), json + '\n', 'utf-8')
}

function findBatch(batches: BatchConfig[], idOrName: string): BatchConfig | undefined {
  const byId = batches.find(b => b.id === idOrName)
  if (byId) return byId
  const lower = idOrName.toLowerCase()
  return batches.find(b => b.name.toLowerCase().startsWith(lower))
}

function requireBatch(batches: BatchConfig[], idOrName: string): BatchConfig {
  const batch = findBatch(batches, idOrName)
  if (!batch) fail('NOT_FOUND', `Batch not found: ${idOrName}`)
  return batch
}

function requireId(positionals: string[], action: string): string {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', `Missing batch id`, `datapilot batch ${action} <id>`)
  return id
}

// ─── deep merge (RFC 7386) ──���─────────────────────��─────────────────────────

/** RFC 7386 JSON Merge Patch — null removes, objects recurse, rest overwrites. */
function deepMergeRaw(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target }
  for (const [key, val] of Object.entries(source)) {
    if (val === null) {
      delete result[key]
    } else if (
      typeof val === 'object' && !Array.isArray(val) &&
      typeof result[key] === 'object' && result[key] !== null && !Array.isArray(result[key])
    ) {
      result[key] = deepMergeRaw(result[key] as Record<string, unknown>, val as Record<string, unknown>)
    } else {
      result[key] = val
    }
  }
  return result
}

/**
 * Apply a patch to a BatchConfig via RFC 7386 deep merge.
 * The result is validated by saveConfig before writing.
 *
 * Uses `as unknown` at the boundary because deepMerge operates on untyped
 * records — this is the single coercion point for the entire module.
 */
function patchBatchConfig(base: BatchConfig, patch: Record<string, unknown>): BatchConfig {
  return deepMergeRaw(base as unknown as Record<string, unknown>, patch) as unknown as BatchConfig
}

// ─── list ─────────���──────────────────────────────��───────────────────────────

function cmdList(ws: string): void {
  const config = loadConfig(ws)
  const out = config.batches.map(b => {
    const state = b.id ? loadBatchState(ws, b.id) : null
    const progress = state ? computeProgress(state) : null
    return {
      id: b.id ?? '',
      name: b.name,
      enabled: b.enabled ?? true,
      status: state?.status ?? 'not started',
      total: progress?.totalItems ?? 0,
      completed: progress?.completedItems ?? 0,
      failed: progress?.failedItems ?? 0,
    }
  })
  ok(out)
}

// ─── get ────────────────────────────────────────────────────────────────��────

function cmdGet(ws: string, positionals: string[]): void {
  const idOrName = requireId(positionals, 'get')
  const config = loadConfig(ws)
  ok(requireBatch(config.batches, idOrName))
}

// ─── create ──────��─────────────────────────────��─────────────────────────────

function cmdCreate(
  ws: string,
  flags: Record<string, string | boolean | string[]>,
): void {
  const input = parseInput(flags)

  const name = (input?.name as string) ?? strFlag(flags, 'name')
  const source = (input?.source as string) ?? strFlag(flags, 'source')
  const idField = (input?.idField as string) ?? strFlag(flags, 'id-field')

  if (!name) fail('USAGE_ERROR', 'Missing --name', 'datapilot batch create --name <name> --source <path> --id-field <field> --prompt-file <path>')
  if (!source) fail('USAGE_ERROR', 'Missing --source', 'datapilot batch create --name <name> --source <path> --id-field <field> --prompt-file <path>')
  if (!idField) fail('USAGE_ERROR', 'Missing --id-field', 'datapilot batch create --name <name> --source <path> --id-field <field> --prompt-file <path>')

  // Resolve prompt content
  let prompt = (input?.prompt as string) ?? strFlag(flags, 'prompt')
  const promptFile = strFlag(flags, 'prompt-file')
  if (promptFile) {
    if (!existsSync(promptFile)) fail('USAGE_ERROR', `Prompt file not found: ${promptFile}`)
    prompt = readFileSync(promptFile, 'utf-8')
  }
  if (!prompt) fail('USAGE_ERROR', 'Missing prompt — provide --prompt-file <path> or --prompt <text>')

  // Infer source type from extension
  const ext = source.split('.').pop()?.toLowerCase() ?? 'csv'
  const sourceType = (['csv', 'json', 'jsonl'].includes(ext) ? ext : 'csv') as 'csv' | 'json' | 'jsonl'

  const id = randomBytes(3).toString('hex')
  const labels = listFlag(flags, 'label') ?? (input?.labels as string[] | undefined)
  const concurrency = intFlag(flags, 'concurrency') ?? (input?.concurrency as number | undefined)
  const model = strFlag(flags, 'model') ?? (input?.model as string | undefined)
  const connection = strFlag(flags, 'connection') ?? (input?.connection as string | undefined)
  const permissionMode = strFlag(flags, 'permission-mode') ?? (input?.permissionMode as string | undefined)
  const workingDirectory = strFlag(flags, 'working-directory') ?? (input?.workingDirectory as string | undefined)
  const outputPath = strFlag(flags, 'output-path') ?? (input?.outputPath as string | undefined)
  const outputSchema = strFlag(flags, 'output-schema') ?? (input?.outputSchema as string | undefined)

  const newBatch: BatchConfig = {
    id,
    name,
    enabled: true,
    ...(workingDirectory ? { workingDirectory } : {}),
    source: { type: sourceType, path: source, idField },
    action: {
      type: 'prompt',
      prompt,
      ...(labels && labels.length > 0 ? { labels } : {}),
    },
  }

  // Execution block
  if (concurrency !== undefined || model || connection || permissionMode) {
    newBatch.execution = {
      ...(concurrency !== undefined ? { maxConcurrency: concurrency } : {}),
      ...(model ? { model } : {}),
      ...(connection ? { llmConnection: connection } : {}),
      ...(permissionMode ? { permissionMode: permissionMode as 'safe' | 'ask' | 'allow-all' } : {}),
    }
  }

  // Output block
  if (outputSchema && !outputPath) {
    fail('USAGE_ERROR', '--output-schema requires --output-path')
  }
  if (outputPath) {
    newBatch.output = { path: outputPath }
    if (outputSchema) {
      try {
        newBatch.output.schema = JSON.parse(outputSchema)
      } catch {
        fail('USAGE_ERROR', `Invalid --output-schema JSON: ${outputSchema}`)
      }
    }
  }

  // Apply --patch if provided (patch as base, flag-built config overlaid on top — flags win)
  const patchStr = strFlag(flags, 'patch')
  let finalBatch: BatchConfig = newBatch
  if (patchStr) {
    let patchObj: Record<string, unknown>
    try {
      patchObj = JSON.parse(patchStr)
    } catch {
      fail('USAGE_ERROR', `Invalid --patch JSON: ${patchStr}`)
    }
    // Merge: --patch as base, flag-built config overlaid (explicit flags win).
    // Result validated by saveConfig before writing.
    const merged = deepMergeRaw(patchObj, newBatch as unknown as Record<string, unknown>)
    finalBatch = merged as unknown as BatchConfig
  }

  const config = loadConfig(ws)
  config.batches.push(finalBatch)
  saveConfig(ws, config)

  ok(finalBatch)
}

// ─── update ─────────���───────────────────────────��────────────────────────────

function buildPatchFromFlags(flags: Record<string, string | boolean | string[]>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const input = parseInput(flags)

  // If structured input provided, use it as base patch
  if (input) Object.assign(patch, input)

  const name = strFlag(flags, 'name')
  if (name !== undefined) patch.name = name

  const enabled = boolFlag(flags, 'enabled')
  if (enabled !== undefined) patch.enabled = enabled

  const wd = strFlag(flags, 'working-directory')
  if (wd !== undefined) patch.workingDirectory = wd || null

  // Source fields
  const sourcePatch: Record<string, unknown> = {}
  const sourcePath = strFlag(flags, 'source')
  if (sourcePath !== undefined) {
    sourcePatch.path = sourcePath
    const ext = sourcePath.split('.').pop()?.toLowerCase() ?? ''
    if (['csv', 'json', 'jsonl'].includes(ext)) sourcePatch.type = ext
  }
  const idField = strFlag(flags, 'id-field')
  if (idField !== undefined) sourcePatch.idField = idField
  if (Object.keys(sourcePatch).length > 0) patch.source = sourcePatch

  // Action fields
  const actionPatch: Record<string, unknown> = {}
  let prompt = strFlag(flags, 'prompt')
  const promptFile = strFlag(flags, 'prompt-file')
  if (promptFile) {
    if (!existsSync(promptFile)) fail('USAGE_ERROR', `Prompt file not found: ${promptFile}`)
    prompt = readFileSync(promptFile, 'utf-8')
  }
  if (prompt !== undefined) actionPatch.prompt = prompt
  const labels = listFlag(flags, 'label')
  if (labels !== undefined) {
    actionPatch.labels = labels.length === 1 && labels[0] === '' ? null : labels
  }
  if (Object.keys(actionPatch).length > 0) patch.action = actionPatch

  // Execution fields
  const execPatch: Record<string, unknown> = {}
  const concurrency = intFlag(flags, 'concurrency')
  if (concurrency !== undefined) execPatch.maxConcurrency = concurrency
  const model = strFlag(flags, 'model')
  if (model !== undefined) execPatch.model = model || null
  const connection = strFlag(flags, 'connection')
  if (connection !== undefined) execPatch.llmConnection = connection || null
  const permissionMode = strFlag(flags, 'permission-mode')
  if (permissionMode !== undefined) execPatch.permissionMode = permissionMode || null
  if (Object.keys(execPatch).length > 0) patch.execution = execPatch

  // Output fields
  const outputPath = strFlag(flags, 'output-path')
  if (outputPath === '') {
    patch.output = null
  } else {
    const outputPatch: Record<string, unknown> = {}
    if (outputPath !== undefined) outputPatch.path = outputPath
    const outputSchema = strFlag(flags, 'output-schema')
    if (outputSchema !== undefined) {
      if (outputSchema === '') {
        outputPatch.schema = null
      } else {
        try {
          outputPatch.schema = JSON.parse(outputSchema)
        } catch {
          fail('USAGE_ERROR', `Invalid --output-schema JSON: ${outputSchema}`)
        }
      }
    }
    if (Object.keys(outputPatch).length > 0) patch.output = outputPatch
  }

  return patch
}

function cmdUpdate(
  ws: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const idOrName = requireId(positionals, 'update')
  const config = loadConfig(ws)
  const batch = requireBatch(config.batches, idOrName)

  // Build patch: start with --patch JSON, then overlay flags (flags win)
  let patchObj: Record<string, unknown> = {}
  const patchStr = strFlag(flags, 'patch')
  if (patchStr) {
    try {
      patchObj = JSON.parse(patchStr)
    } catch {
      fail('USAGE_ERROR', `Invalid --patch JSON: ${patchStr}`)
    }
  }
  const flagPatch = buildPatchFromFlags(flags)
  patchObj = deepMergeRaw(patchObj, flagPatch)

  const updated = patchBatchConfig(batch, patchObj)

  // Clean up empty optional parent objects left after field clearing
  for (const key of ['execution', 'output'] as const) {
    if (updated[key] && typeof updated[key] === 'object' && Object.keys(updated[key] as object).length === 0) {
      delete updated[key]
    }
  }

  config.batches = config.batches.map(b => (b === batch ? updated : b))
  saveConfig(ws, config)

  ok(updated)
}

// ─── delete ───────────────��──────────────────────────────��───────────────────

function cmdDelete(ws: string, positionals: string[]): void {
  const idOrName = requireId(positionals, 'delete')
  const config = loadConfig(ws)
  const batch = requireBatch(config.batches, idOrName)

  config.batches = config.batches.filter(b => b !== batch)
  saveConfig(ws, config)

  // Clean up associated state file
  if (batch.id) {
    const statePath = join(ws, `batch-state-${batch.id}.json`)
    if (existsSync(statePath)) {
      unlinkSync(statePath)
    }
  }

  ok({ deleted: batch.id ?? batch.name })
}

// ─── enable / disable ─────────��──────────────────────────────────────────────

function cmdToggle(ws: string, positionals: string[], enabled: boolean): void {
  const idOrName = requireId(positionals, enabled ? 'enable' : 'disable')
  const config = loadConfig(ws)
  const batch = requireBatch(config.batches, idOrName)

  batch.enabled = enabled
  saveConfig(ws, config)

  ok({ id: batch.id, enabled })
}

// ─── validate ─────────────���──────────────────────────────────────────────────

function cmdValidate(ws: string): void {
  const path = configPath(ws)
  if (!existsSync(path)) {
    ok({ valid: true, note: 'No batches.json found (empty config is valid)' })
    return
  }
  ok(validateBatches(ws))
}

// ─── status ───���───────────────────────────────────────────────────────────���──

function cmdStatus(
  ws: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const idOrName = requireId(positionals, 'status')
  const config = loadConfig(ws)
  const batch = requireBatch(config.batches, idOrName)
  const batchId = batch.id
  if (!batchId) fail('INTERNAL_ERROR', 'Batch has no id — cannot load state.')

  const state = loadBatchState(ws, batchId)
  if (!state) {
    ok({ id: batchId, status: 'not started' })
    return
  }

  const progress = computeProgress(state)
  const showItems = boolFlag(flags, 'items') === true

  if (showItems) {
    ok({ ...progress, items: state.items })
  } else {
    ok(progress)
  }
}

// ─── retry ─────────────────────────────────────────────────��─────────────────

function cmdRetry(ws: string, positionals: string[]): void {
  const batchIdOrName = positionals[0]
  const itemId = positionals[1]
  if (!batchIdOrName) fail('USAGE_ERROR', 'Missing batch id', 'datapilot batch retry <batch-id> <item-id>')
  if (!itemId) fail('USAGE_ERROR', 'Missing item id', 'datapilot batch retry <batch-id> <item-id>')

  const config = loadConfig(ws)
  const batch = requireBatch(config.batches, batchIdOrName)
  const batchId = batch.id
  if (!batchId) fail('INTERNAL_ERROR', 'Batch has no id — cannot load state.')

  const state = loadBatchState(ws, batchId)
  if (!state) fail('NOT_FOUND', `Batch "${batchId}" has not been started yet.`)

  const itemState = state.items[itemId]
  if (!itemState) fail('NOT_FOUND', `Item "${itemId}" not found in batch "${batchId}".`)

  if (itemState.status === 'running' || itemState.status === 'pending') {
    fail('USAGE_ERROR', `Item "${itemId}" cannot be retried (status: ${itemState.status}).`, 'Only completed, failed, or skipped items can be retried.')
  }

  updateItemState(state, itemId, {
    status: 'pending',
    sessionId: undefined,
    completedAt: undefined,
    error: undefined,
  })

  const batchWasDone = state.status === 'completed' || state.status === 'failed'
  if (batchWasDone) {
    state.status = 'paused'
    state.completedAt = undefined
  }

  saveBatchState(ws, state)

  ok({
    batchId,
    itemId,
    itemStatus: 'pending',
    batchStatus: state.status,
    needsResume: batchWasDone,
  })
}
