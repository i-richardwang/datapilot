/**
 * batch entity — wraps the batches:* RPC channels.
 *
 * Flag rule: `create` keeps only `--name` (identity). Everything else —
 * `source`, `idField`, `promptFile`, execution config — goes through
 * `--input '<json>'`. Read-side actions keep query-param flat flags
 * (`--offset`, `--limit`, `--sample-size`).
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, intFlag, parseInput, rejectUnknownFlags, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = [
  'list', 'get', 'create', 'update', 'delete',
  'start', 'pause', 'resume',
  'items',
  'test', 'retry-item',
] as const

export async function routeBatch(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'batch', actions: ACTIONS })
  if (!ACTIONS.includes(action as typeof ACTIONS[number])) {
    fail('USAGE_ERROR', `Unknown batch action: ${action}`)
  }

  const ws = await requireWorkspace(ctx)
  const client = await ctx.getClient()

  switch (action) {
    case 'list':
      rejectUnknownFlags(flags, [])
      ok(await client.invoke('batches:list', ws))

    case 'get': {
      rejectUnknownFlags(flags, [])
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
      rejectUnknownFlags(flags, ['name'])
      const input = (await parseInput(flags)) ?? {}
      const name = strFlag(flags, 'name') ?? (input.name as string | undefined)
      if (!name) fail('USAGE_ERROR', 'Missing --name')
      ok(await client.invoke('batches:create', ws, { ...input, name }))
    }

    case 'update': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('batches:update', ws, id, input))
    }

    case 'delete': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      await client.invoke('batches:delete', ws, id)
      ok({ deleted: id })
    }

    case 'start': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      ok(await client.invoke('batches:start', ws, id))
    }

    case 'pause': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      ok(await client.invoke('batches:pause', ws, id))
    }

    case 'resume': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      ok(await client.invoke('batches:resume', ws, id))
    }

    case 'items': {
      rejectUnknownFlags(flags, ['offset', 'limit'])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      const offset = intFlag(flags, 'offset') ?? 0
      const limit = intFlag(flags, 'limit') ?? 100
      ok(await client.invoke('batches:getItems', ws, id, offset, limit))
    }

    case 'test': {
      rejectUnknownFlags(flags, ['sample-size'])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      const sampleSize = intFlag(flags, 'sample-size')
      ok(await client.invoke('batches:test', ws, id, sampleSize))
    }

    case 'retry-item': {
      rejectUnknownFlags(flags, [])
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
