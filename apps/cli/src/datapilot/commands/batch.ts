/**
 * batch entity — wraps the batches:* RPC channels.
 *
 * Flag rule: `create` keeps only `--name` (identity). Everything else —
 * `source`, `idField`, `promptFile`, execution config — goes through
 * `--input '<json>'`. Read-side actions keep query-param flat flags
 * (`--offset`, `--limit`, `--sample-size`).
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, intFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'
import { rejectActionFlags, type ActionSpec, type EntitySpec } from '../help.ts'

export const BATCH_SPEC: EntitySpec = {
  name: 'batch',
  description: 'Batch processing jobs (CSV/JSON ingest, prompt fan-out, structured output)',
  actions: [
    {
      name: 'list',
      description: 'List all batches in the workspace',
      flags: [],
      example: 'dtpilot batch list',
    },
    {
      name: 'get',
      description: 'Show batch config + progress for one batch',
      positionals: [{ name: 'id', description: 'Batch id' }],
      flags: [],
      example: 'dtpilot batch get my-batch-id',
    },
    {
      name: 'create',
      description: 'Create a new batch (full config goes in --input)',
      flags: [{ name: 'name', type: 'string', required: true, description: 'Batch name (identity)' }],
      takesInput: true,
      example: 'dtpilot batch create --name "Onboarding" --input "$(cat config.json)"',
    },
    {
      name: 'update',
      description: 'Update a batch config',
      positionals: [{ name: 'id', description: 'Batch id' }],
      flags: [],
      takesInput: true,
      example: 'dtpilot batch update my-batch-id --input \'{"execution":{"maxConcurrency":4}}\'',
    },
    {
      name: 'delete',
      description: 'Delete a batch (no cancelled state — delete to abort a running batch)',
      positionals: [{ name: 'id', description: 'Batch id' }],
      flags: [],
      example: 'dtpilot batch delete my-batch-id',
    },
    {
      name: 'start',
      description: 'Start a pending or paused batch',
      positionals: [{ name: 'id', description: 'Batch id' }],
      flags: [],
      example: 'dtpilot batch start my-batch-id',
    },
    {
      name: 'pause',
      description: 'Pause a running batch (paused is non-terminal)',
      positionals: [{ name: 'id', description: 'Batch id' }],
      flags: [],
      example: 'dtpilot batch pause my-batch-id',
    },
    {
      name: 'resume',
      description: 'Resume a paused batch',
      positionals: [{ name: 'id', description: 'Batch id' }],
      flags: [],
      example: 'dtpilot batch resume my-batch-id',
    },
    {
      name: 'items',
      description: 'List items in a batch with their per-item status',
      positionals: [{ name: 'id', description: 'Batch id' }],
      flags: [
        { name: 'offset', type: 'int', description: 'Pagination offset', default: 0 },
        { name: 'limit', type: 'int', description: 'Page size', default: 100 },
      ],
      example: 'dtpilot batch items my-batch-id --offset 0 --limit 100',
    },
    {
      name: 'test',
      description: 'Dry-run the batch on a deterministic random sample (writes to {output}.test.jsonl)',
      positionals: [{ name: 'id', description: 'Batch id' }],
      flags: [{ name: 'sample-size', type: 'int', description: 'Number of items to sample', default: 3 }],
      example: 'dtpilot batch test my-batch-id --sample-size 3',
    },
    {
      name: 'retry-item',
      description: 'Retry a single failed item',
      positionals: [
        { name: 'batch-id', description: 'Batch id' },
        { name: 'item-id', description: 'Item id (the value from source.idField)' },
      ],
      flags: [],
      example: 'dtpilot batch retry-item my-batch-id item-42',
    },
  ],
}

function specOf(action: string): ActionSpec {
  return BATCH_SPEC.actions.find((a) => a.name === action)!
}

export async function routeBatch(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'batch', actions: BATCH_SPEC.actions.map((a) => a.name) })
  if (!BATCH_SPEC.actions.some((a) => a.name === action)) {
    fail('USAGE_ERROR', `Unknown batch action: ${action}`, {
      suggestion: `Valid actions: ${BATCH_SPEC.actions.map((a) => a.name).join(', ')}`,
    })
  }

  const ws = await requireWorkspace(ctx)
  const client = await ctx.getClient()

  switch (action) {
    case 'list':
      rejectActionFlags(flags, specOf('list'))
      ok(await client.invoke('batches:list', ws))

    case 'get': {
      rejectActionFlags(flags, specOf('get'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      const [list, progress] = await Promise.all([
        client.invoke('batches:list', ws),
        client.invoke('batches:getStatus', ws, id),
      ])
      const found = (list as Array<{ id: string }>).find((b) => b.id === id)
      if (!found) fail('NOT_FOUND', `Batch '${id}' not found`)
      ok({ ...found, progress })
    }

    case 'create': {
      rejectActionFlags(flags, specOf('create'))
      const input = (await parseInput(flags)) ?? {}
      const name = strFlag(flags, 'name') ?? (input.name as string | undefined)
      if (!name) fail('USAGE_ERROR', 'Missing --name')
      ok(await client.invoke('batches:create', ws, { ...input, name }))
    }

    case 'update': {
      rejectActionFlags(flags, specOf('update'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('batches:update', ws, id, input))
    }

    case 'delete': {
      rejectActionFlags(flags, specOf('delete'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      await client.invoke('batches:delete', ws, id)
      ok({ deleted: id })
    }

    case 'start': {
      rejectActionFlags(flags, specOf('start'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      ok(await client.invoke('batches:start', ws, id))
    }

    case 'pause': {
      rejectActionFlags(flags, specOf('pause'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      ok(await client.invoke('batches:pause', ws, id))
    }

    case 'resume': {
      rejectActionFlags(flags, specOf('resume'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      ok(await client.invoke('batches:resume', ws, id))
    }

    case 'items': {
      rejectActionFlags(flags, specOf('items'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      const offset = intFlag(flags, 'offset') ?? 0
      const limit = intFlag(flags, 'limit') ?? 100
      ok(await client.invoke('batches:getItems', ws, id, offset, limit))
    }

    case 'test': {
      rejectActionFlags(flags, specOf('test'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      const sampleSize = intFlag(flags, 'sample-size')
      ok(await client.invoke('batches:test', ws, id, sampleSize))
    }

    case 'retry-item': {
      rejectActionFlags(flags, specOf('retry-item'))
      const batchId = positionals[0]
      const itemId = positionals[1]
      if (!batchId || !itemId) fail('USAGE_ERROR', 'Usage: batch retry-item <batch-id> <item-id>')
      ok(await client.invoke('batches:retryItem', ws, batchId, itemId))
    }
  }

  fail('USAGE_ERROR', `Unhandled batch action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id>')
  return ws
}
