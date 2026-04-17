/**
 * automation entity — wraps the automations:* RPC channels.
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, intFlag, boolFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = [
  'list', 'get', 'create', 'update', 'delete',
  'enable', 'disable', 'duplicate',
  'history', 'last-executed', 'test', 'replay',
  'validate', 'lint',
] as const

export async function routeAutomation(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'automation', actions: ACTIONS })
  if (!ACTIONS.includes(action as typeof ACTIONS[number])) {
    fail('USAGE_ERROR', `Unknown automation action: ${action}`)
  }

  const ws = await requireWorkspace(ctx)
  const client = await ctx.getClient()

  switch (action) {
    case 'list':
      ok(await client.invoke('automations:list', ws))

    case 'get': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const list = (await client.invoke('automations:list', ws)) as Array<{ id: string }>
      const found = list.find((a) => a.id === id)
      if (!found) fail('NOT_FOUND', `Automation '${id}' not found`)
      ok(found)
    }

    case 'create': {
      const input = (await parseInput(flags)) ?? {}
      if (!input.name && !strFlag(flags, 'name')) {
        fail('USAGE_ERROR', 'Missing --name (or pass full config via --input <json>)')
      }
      const payload = input.name ? input : { ...input, name: strFlag(flags, 'name') }
      ok(await client.invoke('automations:create', ws, payload))
    }

    case 'update': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('automations:update', ws, id, input))
    }

    case 'delete': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      await client.invoke('automations:delete', ws, id)
      ok({ deleted: id })
    }

    case 'enable': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      ok(await client.invoke('automations:setEnabled', ws, id, true))
    }

    case 'disable': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      ok(await client.invoke('automations:setEnabled', ws, id, false))
    }

    case 'duplicate': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      ok(await client.invoke('automations:duplicate', ws, id))
    }

    case 'history': {
      const limit = intFlag(flags, 'limit') ?? 50
      ok(await client.invoke('automations:getHistory', ws, { limit }))
    }

    case 'last-executed':
      ok(await client.invoke('automations:getLastExecuted', ws))

    case 'test': {
      const input = (await parseInput(flags)) ?? {}
      const payload = { workspaceId: ws, ...input }
      ok(await client.invoke('automations:test', payload))
    }

    case 'replay': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing history entry id')
      const dryRun = boolFlag(flags, 'dry-run') ?? false
      ok(await client.invoke('automations:replay', ws, id, { dryRun }))
    }

    case 'validate': {
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('automations:validate', ws, input))
    }

    case 'lint':
      ok(await client.invoke('automations:lint', ws))
  }

  fail('USAGE_ERROR', `Unhandled automation action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id>')
  return ws
}
