/**
 * workspace entity — wraps the workspaces:* / workspace:* RPC channels.
 */

import { ok, fail } from '../envelope.ts'
import { type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'
import { describeConnection } from '../transport.ts'
import { rejectActionFlags, type ActionSpec, type EntitySpec } from '../help.ts'

export const WORKSPACE_SPEC: EntitySpec = {
  name: 'workspace',
  description: 'Workspaces themselves (read-only from CLI)',
  actions: [
    {
      name: 'list',
      description: 'List all workspaces visible to this server',
      flags: [],
      example: 'dtpilot workspace list',
    },
    {
      name: 'get',
      description: 'Show one workspace including settings and connection info',
      positionals: [{ name: 'id', required: false, description: 'Workspace id|slug|name (defaults to current)' }],
      flags: [],
      example: 'dtpilot workspace get my-workspace',
    },
  ],
}

function specOf(action: string): ActionSpec {
  return WORKSPACE_SPEC.actions.find((a) => a.name === action)!
}

export async function routeWorkspace(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'workspace', actions: WORKSPACE_SPEC.actions.map((a) => a.name) })
  if (!WORKSPACE_SPEC.actions.some((a) => a.name === action)) {
    fail('USAGE_ERROR', `Unknown workspace action: ${action}`, {
      suggestion: `Valid actions: ${WORKSPACE_SPEC.actions.map((a) => a.name).join(', ')}`,
    })
  }

  const client = await ctx.getClient()

  switch (action) {
    case 'list':
      rejectActionFlags(flags, specOf('list'))
      ok(await client.invoke('workspaces:get'))

    case 'get': {
      rejectActionFlags(flags, specOf('get'))
      const id = positionals[0]
      const list = (await client.invoke('workspaces:get')) as Array<{ id: string; slug: string; name: string }>
      const target = id ?? (await ctx.getWorkspace())
      const found = list.find((w) =>
        w.id === target ||
        w.slug === target ||
        w.name?.toLowerCase() === target?.toLowerCase()
      )
      if (!found) fail('NOT_FOUND', `Workspace '${target}' not found`)
      const settings = await client.invoke('workspaceSettings:get', found.id)
      const connection = describeConnection(ctx.getEndpoint())
      ok({ ...found, settings, connection })
    }
  }

  fail('USAGE_ERROR', `Unhandled workspace action: ${action}`)
}
