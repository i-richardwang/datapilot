/**
 * workspace entity — wraps the workspaces:* / workspace:* RPC channels.
 */

import { ok, fail } from '../envelope.ts'
import { type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = [
  'list', 'get', 'permissions', 'settings',
] as const

export async function routeWorkspace(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'workspace', actions: ACTIONS })
  if (!ACTIONS.includes(action as typeof ACTIONS[number])) {
    fail('USAGE_ERROR', `Unknown workspace action: ${action}`)
  }

  const client = await ctx.getClient()

  switch (action) {
    case 'list':
      ok(await client.invoke('workspaces:get'))

    case 'get': {
      const id = positionals[0]
      const list = (await client.invoke('workspaces:get')) as Array<{ id: string }>
      const target = id ?? (await ctx.getWorkspace())
      const found = list.find((w) => w.id === target)
      if (!found) fail('NOT_FOUND', `Workspace '${target}' not found`)
      ok(found)
    }

    case 'permissions': {
      const ws = positionals[0] ?? (await ctx.getWorkspace())
      if (!ws) fail('VALIDATION_ERROR', 'No workspace selected')
      ok(await client.invoke('workspace:getPermissions', ws))
    }

    case 'settings': {
      const ws = positionals[0] ?? (await ctx.getWorkspace())
      if (!ws) fail('VALIDATION_ERROR', 'No workspace selected')
      ok(await client.invoke('workspaceSettings:get', ws))
    }
  }

  fail('USAGE_ERROR', `Unhandled workspace action: ${action}`)
}
