/**
 * status entity — wraps the statuses:* RPC channels.
 *
 * Actions: list / get / create / update / delete / reorder
 *
 * Flag rule: `create` keeps `--name` (identity → maps to status.label) and
 * `--category` (schema-branch selector — open vs closed determines inbox vs
 * archive). All other fields (`color`, `icon`) flow through `--input '<json>'`.
 * `update` is `<id>` + `--input` only. `reorder` takes a comma-separated
 * `--ids` list.
 *
 * Schema validation happens server-side via the Zod schemas in
 * `@craft-agent/shared/statuses` — bad input comes back as a `VALIDATION_ERROR`
 * envelope code from the RPC layer.
 */
import { ok, fail } from '../envelope.ts'
import { strFlag, listFlag, parseInput, rejectUnknownFlags, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = [
  'list', 'get', 'create', 'update', 'delete', 'reorder',
] as const

const VALID_CATEGORIES = ['open', 'closed'] as const

export async function routeStatus(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'status', actions: ACTIONS })
  if (!ACTIONS.includes(action as typeof ACTIONS[number])) {
    fail('USAGE_ERROR', `Unknown status action: ${action}`)
  }

  const ws = await requireWorkspace(ctx)
  const client = await ctx.getClient()

  switch (action) {
    case 'list':
      rejectUnknownFlags(flags, [])
      ok(await client.invoke('statuses:list', ws))

    case 'get': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing status id', { suggestion: 'dtpilot status get <id>' })
      ok(await client.invoke('statuses:get', ws, id))
    }

    case 'create': {
      rejectUnknownFlags(flags, ['name', 'category'], { name: 'label' })
      const input = (await parseInput(flags)) ?? {}
      const label = strFlag(flags, 'name') ?? (input.label as string | undefined)
      if (!label) {
        fail('USAGE_ERROR', 'Missing --name', {
          suggestion: 'dtpilot status create --name "<label>" --category open|closed',
        })
      }
      const category = strFlag(flags, 'category') ?? (input.category as string | undefined)
      if (!category) {
        fail('USAGE_ERROR', `Missing --category. Valid values: ${VALID_CATEGORIES.join(', ')}`)
      }
      if (!(VALID_CATEGORIES as readonly string[]).includes(category)) {
        fail('VALIDATION_ERROR', `Invalid category '${category}'. Valid values: ${VALID_CATEGORIES.join(', ')}`)
      }
      ok(await client.invoke('statuses:create', ws, { ...input, label, category }))
    }

    case 'update': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing status id')
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('statuses:update', ws, id, input))
    }

    case 'delete': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing status id')
      ok(await client.invoke('statuses:delete', ws, id))
    }

    case 'reorder': {
      rejectUnknownFlags(flags, ['ids'])
      const ids = listFlag(flags, 'ids')
      if (!ids || ids.length === 0) {
        fail('USAGE_ERROR', 'Missing --ids <id1,id2,...>', {
          suggestion: 'dtpilot status reorder --ids todo,in-progress,done',
        })
      }
      await client.invoke('statuses:reorder', ws, ids)
      ok({ reordered: ids })
    }
  }

  fail('USAGE_ERROR', `Unhandled status action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id>')
  return ws
}
