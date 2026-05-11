#!/usr/bin/env bun
/**
 * One-shot backfill: regenerate `summary` for every item in every batch's
 * persisted state, using the new `buildItemSummary` helper.
 *
 * Why: until this change shipped, `summary` was the first 100 chars of the
 * expanded prompt — identical for every item when the prompt template's
 * variable slots came after the leading text. Existing items were written
 * with that bad summary and never get rewritten (status transitions only
 * patch fields like status/sessionId/completedAt). This script walks every
 * workspace and rewrites those summaries in place.
 *
 * Usage:
 *   bun scripts/backfill-batch-item-summaries.ts [--dry-run] [<workspaces-root>]
 *
 * Defaults to /Users/didi/Documents/docker/datapilot/workspaces (host-side
 * docker volume mount). Pass an alternate path for other environments.
 *
 * Pre-requisites:
 *   - Stop the docker server before running (avoids concurrent writes to
 *     batch_state).
 *   - Back up workspace.db files first if you want a quick rollback path.
 */

import { Database } from 'bun:sqlite'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { loadBatchItems } from '../packages/shared/src/batches/data-source.ts'
import { buildItemSummary } from '../packages/shared/src/batches/batch-processor.ts'
import { expandEnvVars } from '../packages/shared/src/automations/utils.ts'
import { BATCH_ITEM_ENV_PREFIX } from '../packages/shared/src/batches/constants.ts'
import type { BatchConfig, BatchesFileConfig, BatchItem, BatchState } from '../packages/shared/src/batches/types.ts'

const DEFAULT_ROOT = '/Users/didi/Documents/docker/datapilot/workspaces'

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const positional = args.filter((a) => !a.startsWith('--'))
const root = positional[0] ?? DEFAULT_ROOT

if (!existsSync(root)) {
  console.error(`Workspaces root does not exist: ${root}`)
  process.exit(1)
}

console.log(`[backfill] workspaces root: ${root}`)
console.log(`[backfill] mode: ${dryRun ? 'DRY RUN (no writes)' : 'WRITE'}`)
console.log('')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listWorkspaces(root: string): string[] {
  return readdirSync(root)
    .map((name) => join(root, name))
    .filter((p) => statSync(p).isDirectory() && existsSync(join(p, 'batches.json')))
}

function loadBatchesConfig(workspaceRoot: string): BatchConfig[] {
  const content = readFileSync(join(workspaceRoot, 'batches.json'), 'utf-8')
  const parsed: BatchesFileConfig | BatchConfig[] = JSON.parse(content)
  return Array.isArray(parsed) ? parsed : parsed.batches ?? []
}

function buildItemEnv(item: BatchItem): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(item.fields)) {
    const envKey = `${BATCH_ITEM_ENV_PREFIX}${key.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`
    env[envKey] = value
  }
  env[`${BATCH_ITEM_ENV_PREFIX}ID`] = item.id
  return env
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let totalWorkspaces = 0
let totalBatches = 0
let totalItemsRewritten = 0
let totalBatchesSkipped = 0
let totalSourceErrors = 0

for (const workspaceRoot of listWorkspaces(root)) {
  totalWorkspaces++
  const workspaceName = workspaceRoot.split('/').pop()
  console.log(`[workspace] ${workspaceName}`)

  const dbPath = join(workspaceRoot, 'workspace.db')
  if (!existsSync(dbPath)) {
    console.log(`  (no workspace.db — skipping)`)
    continue
  }

  const configs = loadBatchesConfig(workspaceRoot)
  if (configs.length === 0) {
    console.log(`  (no batches in batches.json)`)
    continue
  }

  const db = new Database(dbPath)
  try {
    const selectStmt = db.prepare<{ state: string }, [string]>(
      'SELECT state FROM batch_state WHERE batch_id = ?',
    )
    const updateStmt = db.prepare<unknown, [string, number, string]>(
      'UPDATE batch_state SET state = ?, updated_at = ? WHERE batch_id = ?',
    )

    for (const config of configs) {
      if (!config.id) continue
      totalBatches++

      const row = selectStmt.get(config.id)
      if (!row) {
        // No state row yet (batch never started) — nothing to backfill
        continue
      }

      // Load source data (may throw if source file moved/deleted)
      let sourceItems: BatchItem[]
      try {
        sourceItems = loadBatchItems(config.source, workspaceRoot)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.log(`  [skip] ${config.id} (${config.name}): source load failed — ${msg}`)
        totalBatchesSkipped++
        totalSourceErrors++
        continue
      }

      const sourceMap = new Map<string, BatchItem>()
      for (const item of sourceItems) sourceMap.set(item.id, item)

      // The state column stores JSON (drizzle's mode:'json'), but raw SQLite
      // returns the text — parse it ourselves.
      const state: BatchState = JSON.parse(row.state)
      const idField = config.source.idField

      let rewrittenInBatch = 0
      for (const [itemId, itemState] of Object.entries(state.items)) {
        const sourceItem = sourceMap.get(itemId)
        if (!sourceItem) continue
        const expandedPrompt = expandEnvVars(config.action.prompt, buildItemEnv(sourceItem))
        const nextSummary = buildItemSummary(sourceItem, idField, expandedPrompt)
        if (itemState.summary !== nextSummary) {
          itemState.summary = nextSummary
          rewrittenInBatch++
        }
      }

      if (rewrittenInBatch > 0) {
        if (!dryRun) {
          updateStmt.run(JSON.stringify(state), Date.now(), config.id)
        }
        console.log(`  [${dryRun ? 'would update' : 'updated'}] ${config.id} (${config.name}): ${rewrittenInBatch} items`)
        totalItemsRewritten += rewrittenInBatch
      }
    }
  } finally {
    db.close()
  }
}

console.log('')
console.log('[done]')
console.log(`  workspaces scanned: ${totalWorkspaces}`)
console.log(`  batches scanned:    ${totalBatches}`)
console.log(`  batches skipped:    ${totalBatchesSkipped} (${totalSourceErrors} source load errors)`)
console.log(`  items rewritten:    ${totalItemsRewritten}`)
console.log(`  mode:               ${dryRun ? 'DRY RUN (no writes)' : 'WRITE'}`)
