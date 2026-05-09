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
import { strFlag, listFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'
import { rejectActionFlags, type ActionSpec, type EntitySpec } from '../help.ts'

const VALID_CATEGORIES = ['open', 'closed'] as const

export const STATUS_SPEC: EntitySpec = {
  name: 'status',
  description: 'Workspace session statuses (open/closed pipeline)',
  actions: [
    {
      name: 'list',
      description: 'List all statuses in workspace order',
      flags: [],
      example: 'dtpilot status list',
    },
    {
      name: 'get',
      description: 'Show one status',
      positionals: [{ name: 'id', description: 'Status id' }],
      flags: [],
      example: 'dtpilot status get todo',
    },
    {
      name: 'create',
      description: 'Create a new status (color, icon go in --input)',
      flags: [
        { name: 'name', type: 'string', required: true, description: 'Status display label (internally stored as `label`)' },
        { name: 'category', type: 'string', required: true, description: 'Pipeline branch: open | closed' },
      ],
      takesInput: true,
      example: 'dtpilot status create --name "In Progress" --category open --input \'{"color":"info"}\'',
    },
    {
      name: 'update',
      description: 'Update status fields',
      positionals: [{ name: 'id', description: 'Status id' }],
      flags: [],
      takesInput: true,
      example: 'dtpilot status update todo --input \'{"color":"warning"}\'',
    },
    {
      name: 'delete',
      description: 'Delete a status',
      positionals: [{ name: 'id', description: 'Status id' }],
      flags: [],
      example: 'dtpilot status delete todo',
    },
    {
      name: 'reorder',
      description: 'Reorder statuses by passing the desired id list',
      flags: [{ name: 'ids', type: 'list', required: true, description: 'Comma-separated status ids in the new order' }],
      example: 'dtpilot status reorder --ids todo,in-progress,done',
    },
  ],
}

function specOf(action: string): ActionSpec {
  return STATUS_SPEC.actions.find((a) => a.name === action)!
}

export async function routeStatus(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'status', actions: STATUS_SPEC.actions.map((a) => a.name) })
  if (!STATUS_SPEC.actions.some((a) => a.name === action)) {
    fail('USAGE_ERROR', `Unknown status action: ${action}`, {
      suggestion: `Valid actions: ${STATUS_SPEC.actions.map((a) => a.name).join(', ')}`,
    })
  }

  const ws = await requireWorkspace(ctx)
  const client = await ctx.getClient()

  switch (action) {
    case 'list':
      rejectActionFlags(flags, specOf('list'))
      ok(await client.invoke('statuses:list', ws))

    case 'get': {
      rejectActionFlags(flags, specOf('get'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing status id')
      ok(await client.invoke('statuses:get', ws, id))
    }

    case 'create': {
      rejectActionFlags(flags, specOf('create'))
      const input = (await parseInput(flags)) ?? {}
      const label = strFlag(flags, 'name') ?? (input.label as string | undefined)
      if (!label) fail('USAGE_ERROR', 'Missing --name')
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
      rejectActionFlags(flags, specOf('update'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing status id')
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('statuses:update', ws, id, input))
    }

    case 'delete': {
      rejectActionFlags(flags, specOf('delete'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing status id')
      ok(await client.invoke('statuses:delete', ws, id))
    }

    case 'reorder': {
      rejectActionFlags(flags, specOf('reorder'))
      const ids = listFlag(flags, 'ids')
      if (!ids || ids.length === 0) fail('USAGE_ERROR', 'Missing --ids <id1,id2,...>')
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
