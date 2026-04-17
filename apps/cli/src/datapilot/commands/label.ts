/**
 * label entity — wraps the labels:* RPC channels.
 *
 * Actions: list, get, create, update, delete, move, reorder,
 *          auto-rule-list, auto-rule-add, auto-rule-remove, auto-rule-clear, auto-rule-validate
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, intFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = [
  'list', 'get', 'create', 'update', 'delete', 'move', 'reorder',
  'auto-rule-list', 'auto-rule-add', 'auto-rule-remove', 'auto-rule-clear', 'auto-rule-validate',
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
      ok(await client.invoke('labels:list', ws))

    case 'get': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id', { suggestion: 'datapilot label get <id>' })
      const labels = (await client.invoke('labels:list', ws)) as Array<{ id: string }>
      const found = findInTree(labels, id)
      if (!found) fail('NOT_FOUND', `Label '${id}' not found`)
      ok(found)
    }

    case 'create': {
      const input = (await parseInput(flags)) ?? {}
      const name = (input.name as string) ?? strFlag(flags, 'name')
      if (!name) fail('USAGE_ERROR', 'Missing --name', { suggestion: 'datapilot label create --name "<name>"' })
      const payload: Record<string, unknown> = { name }
      const color = (input.color as string) ?? strFlag(flags, 'color')
      if (color) payload.color = color
      const parentId = (input.parentId as string) ?? strFlag(flags, 'parent-id')
      if (parentId) payload.parentId = parentId
      const valueType = (input.valueType as string) ?? strFlag(flags, 'value-type')
      if (valueType) payload.valueType = valueType
      ok(await client.invoke('labels:create', ws, payload))
    }

    case 'update': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id')
      const input = (await parseInput(flags)) ?? {}
      const updates: Record<string, unknown> = {}
      const name = (input.name as string) ?? strFlag(flags, 'name')
      if (name !== undefined) updates.name = name
      const color = (input.color as string) ?? strFlag(flags, 'color')
      if (color !== undefined) updates.color = color
      const valueType = (input.valueType as string) ?? strFlag(flags, 'value-type')
      if (valueType !== undefined) updates.valueType = valueType === 'none' ? '' : valueType
      ok(await client.invoke('labels:update', ws, id, updates))
    }

    case 'delete': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id')
      ok(await client.invoke('labels:delete', ws, id))
    }

    case 'move': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id')
      const parent = strFlag(flags, 'parent')
      if (parent === undefined) fail('USAGE_ERROR', 'Missing --parent flag (use "root" for top-level)')
      const newParentId = parent === 'root' ? null : parent
      ok(await client.invoke('labels:move', ws, id, newParentId))
    }

    case 'reorder': {
      if (positionals.length === 0) fail('USAGE_ERROR', 'Missing ordered IDs')
      const parentFlag = strFlag(flags, 'parent')
      const parentId = parentFlag === 'root' || parentFlag === undefined ? null : parentFlag
      ok(await client.invoke('labels:reorder', ws, parentId, positionals))
    }

    case 'auto-rule-list': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id')
      ok(await client.invoke('labels:autoRuleList', ws, id))
    }

    case 'auto-rule-add': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id')
      const input = (await parseInput(flags)) ?? {}
      const pattern = (input.pattern as string) ?? strFlag(flags, 'pattern')
      if (!pattern) fail('USAGE_ERROR', 'Missing --pattern')
      const rule: Record<string, unknown> = { pattern }
      const ruleFlags = (input.flags as string) ?? strFlag(flags, 'flags')
      if (ruleFlags) rule.flags = ruleFlags
      const valueTemplate = (input.valueTemplate as string) ?? strFlag(flags, 'value-template')
      if (valueTemplate) rule.valueTemplate = valueTemplate
      const description = (input.description as string) ?? strFlag(flags, 'description')
      if (description) rule.description = description
      ok(await client.invoke('labels:autoRuleAdd', ws, id, rule))
    }

    case 'auto-rule-remove': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id')
      const index = intFlag(flags, 'index')
      if (index === undefined) fail('USAGE_ERROR', 'Missing --index <n>')
      ok(await client.invoke('labels:autoRuleRemove', ws, id, index))
    }

    case 'auto-rule-clear': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id')
      ok(await client.invoke('labels:autoRuleClear', ws, id))
    }

    case 'auto-rule-validate': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing label id')
      ok(await client.invoke('labels:autoRuleValidate', ws, id))
    }
  }

  fail('USAGE_ERROR', `Unhandled label action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id> or create one with `datapilot workspace create`')
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
