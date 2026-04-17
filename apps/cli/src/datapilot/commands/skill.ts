/**
 * skill entity — wraps the skills:* RPC channels.
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = [
  'list', 'get', 'where', 'files', 'create', 'update', 'delete', 'validate',
] as const

export async function routeSkill(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'skill', actions: ACTIONS })
  if (!ACTIONS.includes(action as typeof ACTIONS[number])) {
    fail('USAGE_ERROR', `Unknown skill action: ${action}`)
  }

  const ws = await requireWorkspace(ctx)
  const client = await ctx.getClient()

  switch (action) {
    case 'list':
      ok(await client.invoke('skills:get', ws))

    case 'get': {
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing skill slug')
      const list = (await client.invoke('skills:get', ws)) as Array<{ slug: string }>
      const found = list.find((s) => s.slug === slug)
      if (!found) fail('NOT_FOUND', `Skill '${slug}' not found`)
      ok(found)
    }

    case 'where': {
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing skill slug')
      ok(await client.invoke('skills:where', ws, slug))
    }

    case 'files': {
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing skill slug')
      ok(await client.invoke('skills:getFiles', ws, slug))
    }

    case 'create': {
      const input = (await parseInput(flags)) ?? {}
      const slug = (input.slug as string) ?? strFlag(flags, 'slug')
      if (!slug) fail('USAGE_ERROR', 'Missing --slug')
      ok(await client.invoke('skills:create', ws, slug, input))
    }

    case 'update': {
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing skill slug')
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('skills:update', ws, slug, input))
    }

    case 'delete': {
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing skill slug')
      await client.invoke('skills:delete', ws, slug)
      ok({ deleted: slug })
    }

    case 'validate': {
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing skill slug')
      ok(await client.invoke('skills:validate', ws, slug))
    }
  }

  fail('USAGE_ERROR', `Unhandled skill action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id>')
  return ws
}
