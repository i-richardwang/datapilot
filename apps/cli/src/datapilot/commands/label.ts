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
import { strFlag, intFlag, parseInput, rejectUnknownFlags, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = [
  'list', 'get', 'create', 'update', 'delete',
  'auto-rule-add', 'auto-rule-remove',
] as const

export async function routeLabel(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'label', actions: ACTIONS })
  if (!ACTIONS.includes(action as typeof ACTIONS[number])) {
    fail('USAGE_ERROR', `Unknown label action: ${action}`)
  }

  const ws = await requireWorkspace(ctx)
  const client = await ctx.getClient()

  switch (action) {
    case 'list':
      rejectUnknownFlags(flags, [])
      ok(await client.invoke('labels:list', ws))

    case 'get': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id', { suggestion: 'dtpilot label get <id>' })
      const [labels, autoRules] = await Promise.all([
        client.invoke('labels:list', ws),
        client.invoke('labels:autoRuleList', ws, id),
      ])
      const found = findInTree(labels as LabelNode[], id)
      if (!found) fail('NOT_FOUND', `Label '${id}' not found`)
      ok({ ...found, autoRules })
    }

    case 'create': {
      rejectUnknownFlags(flags, ['name'])
      const input = (await parseInput(flags)) ?? {}
      const name = strFlag(flags, 'name') ?? (input.name as string | undefined)
      if (!name) fail('USAGE_ERROR', 'Missing --name', { suggestion: 'dtpilot label create --name "<name>"' })
      ok(await client.invoke('labels:create', ws, { ...input, name }))
    }

    case 'update': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id')
      const input = (await parseInput(flags)) ?? {}
      const updates: Record<string, unknown> = { ...input }
      if (updates.valueType === 'none') updates.valueType = ''
      ok(await client.invoke('labels:update', ws, id, updates))
    }

    case 'delete': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id')
      ok(await client.invoke('labels:delete', ws, id))
    }

    case 'auto-rule-add': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id')
      const input = (await parseInput(flags)) ?? {}
      if (!input.pattern) {
        fail('USAGE_ERROR', 'Missing pattern', {
          suggestion: `dtpilot label auto-rule-add ${id} --input '{"pattern":"<regex>"}'`,
        })
      }
      ok(await client.invoke('labels:autoRuleAdd', ws, id, input))
    }

    case 'auto-rule-remove': {
      rejectUnknownFlags(flags, ['index'])
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
