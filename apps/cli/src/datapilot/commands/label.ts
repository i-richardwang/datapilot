/**
 * label entity — wraps the labels:* RPC channels.
 *
 * Actions: list, get, create, update, delete,
 *          auto-rule-add, auto-rule-remove
 *
 * Flag rule: flat flags are identity only (`--name` on create,
 * `--index` on auto-rule-remove). Every other field — `color`,
 * `parentId`, `valueType`, rule `pattern` / `flags` / `valueTemplate` /
 * `description` — goes through `--input '<json>'` or `--stdin`.
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, intFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'
import { rejectActionFlags, type ActionSpec, type EntitySpec } from '../help.ts'

export const LABEL_SPEC: EntitySpec = {
  name: 'label',
  description: 'Workspace labels and auto-rules (regex-based label assignment)',
  actions: [
    {
      name: 'list',
      description: 'List all labels (tree-ordered)',
      flags: [],
      example: 'dtpilot label list',
    },
    {
      name: 'get',
      description: 'Show one label including its auto-rules',
      positionals: [{ name: 'id', description: 'Label id' }],
      flags: [],
      example: 'dtpilot label get bug',
    },
    {
      name: 'create',
      description: 'Create a new label (color, parentId, valueType go in --input)',
      flags: [{ name: 'name', type: 'string', required: true, description: 'Label display name (id is generated as a slug)' }],
      takesInput: true,
      example: 'dtpilot label create --name "Bug" --input \'{"color":"accent"}\'',
    },
    {
      name: 'update',
      description: 'Update label fields',
      positionals: [{ name: 'id', description: 'Label id' }],
      flags: [],
      takesInput: true,
      example: 'dtpilot label update bug --input \'{"name":"Bug Report","color":"destructive"}\'',
    },
    {
      name: 'delete',
      description: 'Delete a label',
      positionals: [{ name: 'id', description: 'Label id' }],
      flags: [],
      example: 'dtpilot label delete bug',
    },
    {
      name: 'auto-rule-add',
      description: 'Add a regex auto-rule to a label',
      positionals: [{ name: 'id', description: 'Label id' }],
      flags: [],
      takesInput: true,
      example: 'dtpilot label auto-rule-add linear-issue --input \'{"pattern":"\\\\b([A-Z]{2,5}-\\\\d+)\\\\b","valueTemplate":"$1"}\'',
    },
    {
      name: 'auto-rule-remove',
      description: 'Remove an auto-rule by its array position',
      positionals: [{ name: 'id', description: 'Label id' }],
      flags: [{ name: 'index', type: 'int', required: true, description: 'Zero-based position in the autoRules array' }],
      example: 'dtpilot label auto-rule-remove linear-issue --index 0',
    },
  ],
}

function specOf(action: string): ActionSpec {
  return LABEL_SPEC.actions.find((a) => a.name === action)!
}

export async function routeLabel(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'label', actions: LABEL_SPEC.actions.map((a) => a.name) })
  if (!LABEL_SPEC.actions.some((a) => a.name === action)) {
    fail('USAGE_ERROR', `Unknown label action: ${action}`, {
      suggestion: `Valid actions: ${LABEL_SPEC.actions.map((a) => a.name).join(', ')}`,
    })
  }

  const ws = await requireWorkspace(ctx)
  const client = await ctx.getClient()

  switch (action) {
    case 'list':
      rejectActionFlags(flags, specOf('list'))
      ok(await client.invoke('labels:list', ws))

    case 'get': {
      rejectActionFlags(flags, specOf('get'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id')
      const [labels, autoRules] = await Promise.all([
        client.invoke('labels:list', ws),
        client.invoke('labels:autoRuleList', ws, id),
      ])
      const found = findInTree(labels as LabelNode[], id)
      if (!found) fail('NOT_FOUND', `Label '${id}' not found`)
      ok({ ...found, autoRules })
    }

    case 'create': {
      rejectActionFlags(flags, specOf('create'))
      const input = (await parseInput(flags)) ?? {}
      const name = strFlag(flags, 'name') ?? (input.name as string | undefined)
      if (!name) fail('USAGE_ERROR', 'Missing --name')
      ok(await client.invoke('labels:create', ws, { ...input, name }))
    }

    case 'update': {
      rejectActionFlags(flags, specOf('update'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id')
      const input = (await parseInput(flags)) ?? {}
      const updates: Record<string, unknown> = { ...input }
      if (updates.valueType === 'none') updates.valueType = ''
      ok(await client.invoke('labels:update', ws, id, updates))
    }

    case 'delete': {
      rejectActionFlags(flags, specOf('delete'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id')
      ok(await client.invoke('labels:delete', ws, id))
    }

    case 'auto-rule-add': {
      rejectActionFlags(flags, specOf('auto-rule-add'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id')
      const input = (await parseInput(flags)) ?? {}
      if (!input.pattern) fail('USAGE_ERROR', 'Missing pattern in --input')
      ok(await client.invoke('labels:autoRuleAdd', ws, id, input))
    }

    case 'auto-rule-remove': {
      rejectActionFlags(flags, specOf('auto-rule-remove'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id')
      const index = intFlag(flags, 'index')
      if (index === undefined) fail('USAGE_ERROR', 'Missing --index <n>')
      ok(await client.invoke('labels:autoRuleRemove', ws, id, index))
    }

  }

  fail('USAGE_ERROR', `Unhandled label action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id> or create one with `dtpilot workspace create`')
  return ws
}

interface LabelNode { id: string; children?: LabelNode[] }

function findInTree(labels: LabelNode[], id: string): LabelNode | null {
  for (const label of labels) {
    if (label.id === id) return label
    if (label.children) {
      const found = findInTree(label.children, id)
      if (found) return found
    }
  }
  return null
}
