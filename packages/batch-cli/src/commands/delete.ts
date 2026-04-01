/**
 * datapilot-batch delete <id>
 *
 * Remove a batch from batches.json and clean up its state file.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { BatchesFileConfigSchema } from '@craft-agent/shared/batches'
import { findBatch } from './get.ts'
import { colors as c } from '../format.ts'

export function cmdDelete(workspaceRoot: string, idOrName: string, asJson: boolean): void {
  const configPath = join(workspaceRoot, 'batches.json')
  if (!existsSync(configPath)) {
    console.error('No batches.json found in workspace.')
    process.exit(1)
  }

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

  const newBatches = parsed.data.batches.filter(b => b !== batch)
  const newConfig = { ...parsed.data, batches: newBatches }
  writeFileSync(configPath, JSON.stringify(newConfig, null, 2) + '\n', 'utf-8')

  // Clean up associated state file if present
  if (batch.id) {
    const statePath = join(workspaceRoot, `batch-state-${batch.id}.json`)
    if (existsSync(statePath)) {
      unlinkSync(statePath)
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ deleted: batch.id ?? batch.name }, null, 2))
  } else {
    console.log(c.green + `✓ Deleted batch "${batch.name}"` + c.reset)
  }
}
