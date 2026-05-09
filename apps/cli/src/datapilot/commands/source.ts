/**
 * source entity — wraps the sources:* RPC channels.
 *
 * Flag rule: `create` keeps `--name` (identity) and `--provider` / `--type`
 * (schema-branch selectors — nested `mcp` / `api` / `local` config only makes
 * sense once `type` is known). All other fields go through `--input '<json>'`.
 * `update` is `<slug>` + `--input` only.
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'
import { rejectActionFlags, type ActionSpec, type EntitySpec } from '../help.ts'

export const SOURCE_SPEC: EntitySpec = {
  name: 'source',
  description: 'Workspace sources (MCP servers, HTTP APIs, local filesystem)',
  actions: [
    {
      name: 'list',
      description: 'List all sources in the workspace',
      flags: [],
      example: 'dtpilot source list',
    },
    {
      name: 'get',
      description: 'Show one source with its permissions and MCP tools',
      positionals: [{ name: 'slug', description: 'Source slug' }],
      flags: [],
      example: 'dtpilot source get my-api',
    },
    {
      name: 'create',
      description: 'Create a new source (provider/type select the config schema branch)',
      flags: [
        { name: 'name', type: 'string', required: true, description: 'Source display name' },
        { name: 'provider', type: 'string', required: true, description: 'Provider id (e.g. generic, github, linear)' },
        { name: 'type', type: 'string', required: true, description: 'Source type: mcp | api | local' },
      ],
      takesInput: true,
      example: 'dtpilot source create --name MyAPI --provider generic --type api --input \'{"baseUrl":"https://..."}\'',
    },
    {
      name: 'update',
      description: 'Update source fields',
      positionals: [{ name: 'slug', description: 'Source slug' }],
      flags: [],
      takesInput: true,
      example: 'dtpilot source update my-api --input \'{"name":"My API v2"}\'',
    },
    {
      name: 'delete',
      description: 'Delete a source',
      positionals: [{ name: 'slug', description: 'Source slug' }],
      flags: [],
      example: 'dtpilot source delete my-api',
    },
  ],
}

function specOf(action: string): ActionSpec {
  return SOURCE_SPEC.actions.find((a) => a.name === action)!
}

export async function routeSource(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'source', actions: SOURCE_SPEC.actions.map((a) => a.name) })
  if (!SOURCE_SPEC.actions.some((a) => a.name === action)) {
    fail('USAGE_ERROR', `Unknown source action: ${action}`, {
      suggestion: `Valid actions: ${SOURCE_SPEC.actions.map((a) => a.name).join(', ')}`,
    })
  }

  const ws = await requireWorkspace(ctx)
  const client = await ctx.getClient()

  switch (action) {
    case 'list':
      rejectActionFlags(flags, specOf('list'))
      ok(await client.invoke('sources:get', ws))

    case 'get': {
      rejectActionFlags(flags, specOf('get'))
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing source slug')
      const sources = (await client.invoke('sources:get', ws)) as Array<{ config: { slug: string } }>
      const found = sources.find((s) => s.config?.slug === slug)
      if (!found) fail('NOT_FOUND', `Source '${slug}' not found`)
      const [permissions, mcpTools] = await Promise.all([
        client.invoke('sources:getPermissions', ws, slug),
        client.invoke('sources:getMcpTools', ws, slug),
      ])
      ok({ ...found.config, permissions, mcpTools })
    }

    case 'create': {
      rejectActionFlags(flags, specOf('create'))
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
      rejectActionFlags(flags, specOf('update'))
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing source slug')
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('sources:update', ws, slug, input))
    }

    case 'delete': {
      rejectActionFlags(flags, specOf('delete'))
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
