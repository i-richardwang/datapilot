/**
 * skill entity — wraps the skills:* RPC channels.
 *
 * Flag rule: `create` keeps only `--name` (identity). `--description`, `body`,
 * `globs`, `requiredSources`, etc. flow through `--input '<json>'`. The server
 * (packages/server-core/src/handlers/rpc/skills.ts:145) auto-generates the
 * slug from `input.name` when not supplied, so there's no `--slug` flat flag;
 * pass `slug` inside `--input` to override.
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, parseInput, rejectUnknownFlags, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = [
  'list', 'get', 'create', 'update', 'delete',
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
      rejectUnknownFlags(flags, [])
      ok(await client.invoke('skills:get', ws))

    case 'get': {
      rejectUnknownFlags(flags, [])
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing skill slug')
      const list = (await client.invoke('skills:get', ws)) as Array<{ slug: string }>
      const found = list.find((s) => s.slug === slug)
      if (!found) fail('NOT_FOUND', `Skill '${slug}' not found`)
      ok(found)
    }

    case 'create': {
      rejectUnknownFlags(flags, ['name'])
      const input = (await parseInput(flags)) ?? {}
      const name = strFlag(flags, 'name') ?? (input.name as string | undefined)
      if (!name) {
        fail('USAGE_ERROR', 'Missing --name', {
          suggestion: `datapilot skill create --name "<name>" --input '{"description":"..."}'`,
        })
      }
      ok(await client.invoke('skills:create', ws, { ...input, name }))
    }

    case 'update': {
      rejectUnknownFlags(flags, [])
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing skill slug')
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('skills:update', ws, slug, input))
    }

    case 'delete': {
      rejectUnknownFlags(flags, [])
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing skill slug')
      await client.invoke('skills:delete', ws, slug)
      ok({ deleted: slug })
    }
  }

  fail('USAGE_ERROR', `Unhandled skill action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id>')
  return ws
}
