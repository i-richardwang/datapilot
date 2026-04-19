/**
 * workspace entity — wraps the workspaces:* / workspace:* RPC channels.
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = [
  'list', 'get', 'create', 'update-remote',
  'permissions', 'settings', 'set-settings',
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

    case 'create': {
      const path = positionals[0] ?? strFlag(flags, 'path')
      if (!path) fail('USAGE_ERROR', 'Missing workspace path (positional or --path)')
      const name = strFlag(flags, 'name') ?? 'workspace'
      ok(await client.invoke('workspaces:create', path, name))
    }

    case 'update-remote': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing workspace id')
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('workspaces:updateRemote', id, input))
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

    case 'set-settings': {
      const ws = positionals[0] ?? (await ctx.getWorkspace())
      if (!ws) fail('VALIDATION_ERROR', 'No workspace selected')
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('workspaceSettings:update', ws, input))
    }
  }

  fail('USAGE_ERROR', `Unhandled workspace action: ${action}`)
}
