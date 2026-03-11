/**
 * craft-agent batch get <id>
 *
 * Show full config for a single batch (by id or name prefix).
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { BatchesFileConfigSchema } from '@craft-agent/shared/batches'
import type { BatchConfig } from '@craft-agent/shared/batches'

export function cmdGet(workspaceRoot: string, idOrName: string): void {
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

  console.log(JSON.stringify(batch, null, 2))
}

export function findBatch(batches: BatchConfig[], idOrName: string): BatchConfig | undefined {
  // Exact id match first
  const byId = batches.find(b => b.id === idOrName)
  if (byId) return byId
  // Name prefix match
  const lower = idOrName.toLowerCase()
  return batches.find(b => b.name.toLowerCase().startsWith(lower))
}
