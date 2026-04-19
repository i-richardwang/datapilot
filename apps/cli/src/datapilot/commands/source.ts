/**
 * source entity — wraps the sources:* RPC channels.
 *
 * Flag rule: `create` keeps `--name` (identity) and `--provider` / `--type`
 * (schema-branch selectors — nested `mcp` / `api` / `local` config only makes
 * sense once `type` is known). All other fields go through `--input '<json>'`.
 * `update` is `<slug>` + `--input` only.
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, parseInput, rejectUnknownFlags, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = [
  'list', 'get', 'create', 'update', 'delete',
] as const

export async function routeSource(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'source', actions: ACTIONS })
  if (!ACTIONS.includes(action as typeof ACTIONS[number])) {
    fail('USAGE_ERROR', `Unknown source action: ${action}`)
  }

  const ws = await requireWorkspace(ctx)
  const client = await ctx.getClient()

  switch (action) {
    case 'list':
      rejectUnknownFlags(flags, [])
      ok(await client.invoke('sources:get', ws))

    case 'get': {
      rejectUnknownFlags(flags, [])
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing source slug')
      const sources = (await client.invoke('sources:get', ws)) as Array<{ slug: string }>
      const found = sources.find((s) => s.slug === slug)
      if (!found) fail('NOT_FOUND', `Source '${slug}' not found`)
      const [permissions, mcpTools] = await Promise.all([
        client.invoke('sources:getPermissions', ws, slug),
        client.invoke('sources:getMcpTools', ws, slug),
      ])
      ok({ ...found, permissions, mcpTools })
    }

    case 'create': {
      rejectUnknownFlags(flags, ['name', 'provider', 'type'])
      const input = (await parseInput(flags)) ?? {}
      const name = strFlag(flags, 'name') ?? (input.name as string | undefined)
      const provider = strFlag(flags, 'provider') ?? (input.provider as string | undefined)
      const type = strFlag(flags, 'type') ?? (input.type as string | undefined)
      if (!name || !provider || !type) {
        fail('USAGE_ERROR', 'Missing required fields: --name, --provider, --type (or --input <json>)')
      }
      const payload: Record<string, unknown> = { ...input, name, provider, type }
      ok(await client.invoke('sources:create', ws, payload))
    }

    case 'update': {
      rejectUnknownFlags(flags, [])
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing source slug')
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('sources:update', ws, slug, input))
    }

    case 'delete': {
      rejectUnknownFlags(flags, [])
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing source slug')
      await client.invoke('sources:delete', ws, slug)
      ok({ deleted: slug })
    }
  }

  fail('USAGE_ERROR', `Unhandled source action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id>')
  return ws
}
