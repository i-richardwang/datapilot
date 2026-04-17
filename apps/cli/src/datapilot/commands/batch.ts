/**
 * batch entity — wraps the batches:* RPC channels.
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = [
  'list', 'get', 'create', 'update', 'delete',
  'start', 'pause', 'resume', 'duplicate',
  'status', 'state', 'items',
  'validate', 'test', 'test-result', 'retry-item',
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
      ok(await client.invoke('batches:list', ws))

    case 'get': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      const list = (await client.invoke('batches:list', ws)) as Array<{ id: string }>
      const found = list.find((b) => b.id === id)
      if (!found) fail('NOT_FOUND', `Batch '${id}' not found`)
      ok(found)
    }

    case 'create': {
      const input = (await parseInput(flags)) ?? {}
      const name = (input.name as string) ?? strFlag(flags, 'name')
      if (!name) fail('USAGE_ERROR', 'Missing --name')
      ok(await client.invoke('batches:create', ws, { ...input, name }))
    }

    case 'update': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('batches:update', ws, id, input))
    }

    case 'delete': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      await client.invoke('batches:delete', ws, id)
      ok({ deleted: id })
    }

    case 'start': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      ok(await client.invoke('batches:start', ws, id))
    }

    case 'pause': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      ok(await client.invoke('batches:pause', ws, id))
    }

    case 'resume': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      ok(await client.invoke('batches:resume', ws, id))
    }

    case 'duplicate': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      ok(await client.invoke('batches:duplicate', ws, id))
    }

    case 'status': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      ok(await client.invoke('batches:getStatus', ws, id))
    }

    case 'state': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      ok(await client.invoke('batches:getState', ws, id))
    }

    case 'items': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      ok(await client.invoke('batches:getItems', ws, id))
    }

    case 'validate': {
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('batches:validate', ws, input))
    }

    case 'test': {
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('batches:test', ws, input))
    }

    case 'test-result': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing test id')
      ok(await client.invoke('batches:getTestResult', ws, id))
    }

    case 'retry-item': {
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
