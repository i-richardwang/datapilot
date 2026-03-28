/**
 * Label commands — 12 subcommands
 *
 * Storage: SQLite via @craft-agent/shared/labels
 */

import { ok, fail, warn } from '../envelope.ts'
import { strFlag, boolFlag, listFlag } from '../args.ts'
import { parseInput } from '../input.ts'
import { listLabelsFlat, getLabel, loadLabelConfig, saveLabelConfig } from '@craft-agent/shared/labels/storage'
import { createLabel, updateLabel, deleteLabel, moveLabel, reorderLabels } from '@craft-agent/shared/labels/crud'
import { validateAutoLabelRule } from '@craft-agent/shared/labels/auto'
import type { AutoLabelRule } from '@craft-agent/shared/labels'
import type { EntityColor } from '@craft-agent/shared/colors'

export function routeLabel(
  ws: string,
  action: string | undefined,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  if (!action) fail('USAGE_ERROR', 'Missing action', 'datapilot label <list|get|create|update|delete|move|reorder|auto-rule-*>')

  switch (action) {
    case 'list': return cmdList(ws)
    case 'get': return cmdGet(ws, positionals)
    case 'create': return cmdCreate(ws, positionals, flags)
    case 'update': return cmdUpdate(ws, positionals, flags)
    case 'delete': return cmdDelete(ws, positionals)
    case 'move': return cmdMove(ws, positionals, flags)
    case 'reorder': return cmdReorder(ws, positionals, flags)
    case 'auto-rule-list': return cmdAutoRuleList(ws, positionals)
    case 'auto-rule-add': return cmdAutoRuleAdd(ws, positionals, flags)
    case 'auto-rule-remove': return cmdAutoRuleRemove(ws, positionals, flags)
    case 'auto-rule-clear': return cmdAutoRuleClear(ws, positionals)
    case 'auto-rule-validate': return cmdAutoRuleValidate(ws, positionals)
    default:
      fail('USAGE_ERROR', `Unknown label action: ${action}`)
  }
}

// ─── list ────────────────────────────────────────────────────────────────────

function cmdList(ws: string): void {
  ok(listLabelsFlat(ws))
}

// ─── get ─────────────────────────────────────────────────────────────────────

function cmdGet(ws: string, positionals: string[]): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing label id', 'datapilot label get <id>')

  const label = getLabel(ws, id)
  if (!label) fail('NOT_FOUND', `Label '${id}' not found`)
  ok(label)
}

// ─── create ──────────────────────────────────────────────────────────────────

function cmdCreate(
  ws: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const input = parseInput(flags)
  const name = (input?.name as string) ?? strFlag(flags, 'name')
  if (!name) fail('USAGE_ERROR', 'Missing --name', 'datapilot label create --name "<name>"')

  const color = (input?.color as EntityColor) ?? strFlag(flags, 'color')
  const parentId = (input?.parentId as string) ?? strFlag(flags, 'parent-id') ?? undefined
  const rawValueType = (input?.valueType as string) ?? strFlag(flags, 'value-type')
  const valueType = rawValueType as 'string' | 'number' | 'date' | undefined

  try {
    const label = createLabel(ws, { name, color, parentId, valueType })
    ok(label)
  } catch (e) {
    fail('VALIDATION_ERROR', (e as Error).message)
  }
}

// ─── update ──────────────────────────────────────────────────────────────────

function cmdUpdate(
  ws: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing label id', 'datapilot label update <id> [--name ...] [--color ...] [--value-type ...]')

  const input = parseInput(flags)
  const updates: Record<string, unknown> = {}

  const name = (input?.name as string) ?? strFlag(flags, 'name')
  if (name !== undefined) updates.name = name

  const color = (input?.color as EntityColor) ?? strFlag(flags, 'color')
  if (color !== undefined) updates.color = color

  // --value-type none or --clear-value-type removes the value type
  const clearValueType = boolFlag(flags, 'clear-value-type')
  const rawValueType = (input?.valueType as string) ?? strFlag(flags, 'value-type')
  if (clearValueType || rawValueType === 'none') {
    updates.valueType = ''
  } else if (rawValueType) {
    updates.valueType = rawValueType
  }

  try {
    const label = updateLabel(ws, id, updates)
    ok(label)
  } catch (e) {
    fail('NOT_FOUND', (e as Error).message)
  }
}

// ─── delete ──────────────────────────────────────────────────────────────────

function cmdDelete(ws: string, positionals: string[]): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing label id', 'datapilot label delete <id>')

  try {
    const result = deleteLabel(ws, id)
    ok({ deleted: id, ...result })
  } catch (e) {
    fail('NOT_FOUND', (e as Error).message)
  }
}

// ─── move ────────────────────────────────────────────────────────────────────

function cmdMove(
  ws: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing label id', 'datapilot label move <id> --parent <id|root>')

  const parent = strFlag(flags, 'parent')
  if (parent === undefined) fail('USAGE_ERROR', 'Missing --parent flag', 'datapilot label move <id> --parent <id|root>')

  const newParentId = parent === 'root' ? null : parent

  try {
    moveLabel(ws, id, newParentId)
    ok({ moved: id, parent: parent })
  } catch (e) {
    fail('VALIDATION_ERROR', (e as Error).message)
  }
}

// ─── reorder ─────────────────────────────────────────────────────────────────

function cmdReorder(
  ws: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const parentFlag = strFlag(flags, 'parent')
  const parentId = parentFlag === 'root' ? null : (parentFlag ?? null)

  if (positionals.length === 0) {
    fail('USAGE_ERROR', 'Missing ordered IDs', 'datapilot label reorder [--parent <id|root>] <id1> <id2> ...')
  }

  try {
    reorderLabels(ws, parentId, positionals)
    ok({ reordered: positionals, parent: parentFlag ?? 'root' })
  } catch (e) {
    fail('VALIDATION_ERROR', (e as Error).message)
  }
}

// ─── auto-rule-list ──────────────────────────────────────────────────────────

function cmdAutoRuleList(ws: string, positionals: string[]): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing label id', 'datapilot label auto-rule-list <id>')

  const label = getLabel(ws, id)
  if (!label) fail('NOT_FOUND', `Label '${id}' not found`)
  ok(label.autoRules ?? [])
}

// ─── auto-rule-add ───────────────────────────────────────────────────────────

function cmdAutoRuleAdd(
  ws: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing label id', 'datapilot label auto-rule-add <id> --pattern "<regex>"')

  const input = parseInput(flags)
  const pattern = (input?.pattern as string) ?? strFlag(flags, 'pattern')
  if (!pattern) fail('USAGE_ERROR', 'Missing --pattern', 'datapilot label auto-rule-add <id> --pattern "<regex>"')

  const rule: AutoLabelRule = { pattern }
  const ruleFlags = (input?.flags as string) ?? strFlag(flags, 'flags')
  if (ruleFlags) rule.flags = ruleFlags
  const valueTemplate = (input?.valueTemplate as string) ?? strFlag(flags, 'value-template')
  if (valueTemplate) rule.valueTemplate = valueTemplate
  const description = (input?.description as string) ?? strFlag(flags, 'description')
  if (description) rule.description = description

  // Validate the rule
  const validation = validateAutoLabelRule(rule.pattern, rule.flags)
  if (!validation.valid) {
    fail('VALIDATION_ERROR', `Invalid auto-rule: ${validation.errors.join(', ')}`)
  }

  const config = loadLabelConfig(ws)
  const label = config.labels.reduce<import('@craft-agent/shared/labels').LabelConfig | null>(
    (found, l) => found ?? findInTree(l, id), null
  )
  if (!label) fail('NOT_FOUND', `Label '${id}' not found`)

  if (!label.autoRules) label.autoRules = []
  label.autoRules.push(rule)
  saveLabelConfig(ws, config)

  ok({ added: rule, total: label.autoRules.length })
}

// ─── auto-rule-remove ────────────────────────────────────────────────────────

function cmdAutoRuleRemove(
  ws: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing label id', 'datapilot label auto-rule-remove <id> --index <n>')

  const indexStr = strFlag(flags, 'index')
  if (indexStr === undefined) fail('USAGE_ERROR', 'Missing --index', 'datapilot label auto-rule-remove <id> --index <n>')
  const index = parseInt(indexStr, 10)
  if (isNaN(index)) fail('USAGE_ERROR', '--index must be a number')

  const config = loadLabelConfig(ws)
  const label = config.labels.reduce<import('@craft-agent/shared/labels').LabelConfig | null>(
    (found, l) => found ?? findInTree(l, id), null
  )
  if (!label) fail('NOT_FOUND', `Label '${id}' not found`)

  if (!label.autoRules || index < 0 || index >= label.autoRules.length) {
    fail('VALIDATION_ERROR', `Index ${index} out of range (${label.autoRules?.length ?? 0} rules)`)
  }

  const removed = label.autoRules.splice(index, 1)[0]
  saveLabelConfig(ws, config)
  ok({ removed, remaining: label.autoRules.length })
}

// ─── auto-rule-clear ─────────────────────────────────────────────────────────

function cmdAutoRuleClear(ws: string, positionals: string[]): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing label id', 'datapilot label auto-rule-clear <id>')

  const config = loadLabelConfig(ws)
  const label = config.labels.reduce<import('@craft-agent/shared/labels').LabelConfig | null>(
    (found, l) => found ?? findInTree(l, id), null
  )
  if (!label) fail('NOT_FOUND', `Label '${id}' not found`)

  const count = label.autoRules?.length ?? 0
  label.autoRules = []
  saveLabelConfig(ws, config)
  ok({ cleared: count })
}

// ─── auto-rule-validate ──────────────────────────────────────────────────────

function cmdAutoRuleValidate(ws: string, positionals: string[]): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing label id', 'datapilot label auto-rule-validate <id>')

  const label = getLabel(ws, id)
  if (!label) fail('NOT_FOUND', `Label '${id}' not found`)

  const rules = label.autoRules ?? []
  if (rules.length === 0) {
    ok({ valid: true, rules: 0, results: [] })
    return
  }

  const results = rules.map((rule, i) => {
    const validation = validateAutoLabelRule(rule.pattern, rule.flags)
    if (!validation.valid) {
      warn(`Rule ${i}: ${validation.errors.join(', ')}`)
    }
    return { index: i, pattern: rule.pattern, ...validation }
  })

  const allValid = results.every(r => r.valid)
  ok({ valid: allValid, rules: rules.length, results })
}

// ─── helper ──────────────────────────────────────────────────────────────────

function findInTree(label: import('@craft-agent/shared/labels').LabelConfig, id: string): import('@craft-agent/shared/labels').LabelConfig | null {
  if (label.id === id) return label
  if (label.children) {
    for (const child of label.children) {
      const found = findInTree(child, id)
      if (found) return found
    }
  }
  return null
}
