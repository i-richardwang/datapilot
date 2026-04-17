import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type { AutoLabelRule, LabelConfig, UpdateLabelInput } from '@craft-agent/shared/labels'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.labels.LIST,
  RPC_CHANNELS.labels.CREATE,
  RPC_CHANNELS.labels.UPDATE,
  RPC_CHANNELS.labels.DELETE,
  RPC_CHANNELS.labels.MOVE,
  RPC_CHANNELS.labels.REORDER,
  RPC_CHANNELS.labels.AUTO_RULE_LIST,
  RPC_CHANNELS.labels.AUTO_RULE_ADD,
  RPC_CHANNELS.labels.AUTO_RULE_REMOVE,
  RPC_CHANNELS.labels.AUTO_RULE_CLEAR,
  RPC_CHANNELS.labels.AUTO_RULE_VALIDATE,
] as const

function findInTree(label: LabelConfig, id: string): LabelConfig | null {
  if (label.id === id) return label
  if (label.children) {
    for (const child of label.children) {
      const found = findInTree(child, id)
      if (found) return found
    }
  }
  return null
}

function notifyChanged(server: RpcServer, workspaceId: string): void {
  pushTyped(server, RPC_CHANNELS.labels.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
}

export function registerLabelsHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // List all labels for a workspace
  server.handle(RPC_CHANNELS.labels.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listLabels } = await import('@craft-agent/shared/labels/storage')
    return listLabels(workspace.rootPath)
  })

  // Create a new label in a workspace
  server.handle(RPC_CHANNELS.labels.CREATE, async (_ctx, workspaceId: string, input: import('@craft-agent/shared/labels').CreateLabelInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { createLabel } = await import('@craft-agent/shared/labels/crud')
    const label = createLabel(workspace.rootPath, input)
    notifyChanged(server, workspaceId)
    return label
  })

  // Update an existing label's mutable fields (name, color, valueType)
  server.handle(RPC_CHANNELS.labels.UPDATE, async (_ctx, workspaceId: string, labelId: string, updates: UpdateLabelInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { updateLabel } = await import('@craft-agent/shared/labels/crud')
    const label = updateLabel(workspace.rootPath, labelId, updates)
    notifyChanged(server, workspaceId)
    return label
  })

  // Delete a label (and descendants) from a workspace
  server.handle(RPC_CHANNELS.labels.DELETE, async (_ctx, workspaceId: string, labelId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteLabel } = await import('@craft-agent/shared/labels/crud')
    const result = deleteLabel(workspace.rootPath, labelId)
    notifyChanged(server, workspaceId)
    return result
  })

  // Move a label under a new parent (null = move to root)
  server.handle(RPC_CHANNELS.labels.MOVE, async (_ctx, workspaceId: string, labelId: string, newParentId: string | null) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { moveLabel } = await import('@craft-agent/shared/labels/crud')
    moveLabel(workspace.rootPath, labelId, newParentId)
    notifyChanged(server, workspaceId)
    return { moved: labelId, parentId: newParentId }
  })

  // Reorder siblings under a given parent (null = reorder root)
  server.handle(RPC_CHANNELS.labels.REORDER, async (_ctx, workspaceId: string, parentId: string | null, orderedIds: string[]) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { reorderLabels } = await import('@craft-agent/shared/labels/crud')
    reorderLabels(workspace.rootPath, parentId, orderedIds)
    notifyChanged(server, workspaceId)
    return { reordered: orderedIds, parentId }
  })

  // Auto-rule: list rules attached to a label
  server.handle(RPC_CHANNELS.labels.AUTO_RULE_LIST, async (_ctx, workspaceId: string, labelId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { getLabel } = await import('@craft-agent/shared/labels/storage')
    const label = getLabel(workspace.rootPath, labelId)
    if (!label) throw new Error(`Label '${labelId}' not found`)
    return label.autoRules ?? []
  })

  // Auto-rule: add a rule to a label
  server.handle(RPC_CHANNELS.labels.AUTO_RULE_ADD, async (_ctx, workspaceId: string, labelId: string, rule: AutoLabelRule) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { validateAutoLabelRule } = await import('@craft-agent/shared/labels/auto')
    const validation = validateAutoLabelRule(rule.pattern, rule.flags)
    if (!validation.valid) {
      throw new Error(`Invalid auto-rule: ${validation.errors.join(', ')}`)
    }

    const { loadLabelConfig, saveLabelConfig } = await import('@craft-agent/shared/labels/storage')
    const config = loadLabelConfig(workspace.rootPath)
    const label = config.labels.reduce<LabelConfig | null>(
      (found, l) => found ?? findInTree(l, labelId), null
    )
    if (!label) throw new Error(`Label '${labelId}' not found`)

    if (!label.autoRules) label.autoRules = []
    label.autoRules.push(rule)
    saveLabelConfig(workspace.rootPath, config)
    notifyChanged(server, workspaceId)
    return { added: rule, total: label.autoRules.length }
  })

  // Auto-rule: remove a rule by index
  server.handle(RPC_CHANNELS.labels.AUTO_RULE_REMOVE, async (_ctx, workspaceId: string, labelId: string, index: number) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { loadLabelConfig, saveLabelConfig } = await import('@craft-agent/shared/labels/storage')
    const config = loadLabelConfig(workspace.rootPath)
    const label = config.labels.reduce<LabelConfig | null>(
      (found, l) => found ?? findInTree(l, labelId), null
    )
    if (!label) throw new Error(`Label '${labelId}' not found`)

    if (!label.autoRules || index < 0 || index >= label.autoRules.length) {
      throw new Error(`Index ${index} out of range (${label.autoRules?.length ?? 0} rules)`)
    }
    const removed = label.autoRules.splice(index, 1)[0]
    saveLabelConfig(workspace.rootPath, config)
    notifyChanged(server, workspaceId)
    return { removed, remaining: label.autoRules.length }
  })

  // Auto-rule: clear all rules on a label
  server.handle(RPC_CHANNELS.labels.AUTO_RULE_CLEAR, async (_ctx, workspaceId: string, labelId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { loadLabelConfig, saveLabelConfig } = await import('@craft-agent/shared/labels/storage')
    const config = loadLabelConfig(workspace.rootPath)
    const label = config.labels.reduce<LabelConfig | null>(
      (found, l) => found ?? findInTree(l, labelId), null
    )
    if (!label) throw new Error(`Label '${labelId}' not found`)

    const count = label.autoRules?.length ?? 0
    label.autoRules = []
    saveLabelConfig(workspace.rootPath, config)
    notifyChanged(server, workspaceId)
    return { cleared: count }
  })

  // Auto-rule: validate all rules on a label without mutating
  server.handle(RPC_CHANNELS.labels.AUTO_RULE_VALIDATE, async (_ctx, workspaceId: string, labelId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { getLabel } = await import('@craft-agent/shared/labels/storage')
    const { validateAutoLabelRule } = await import('@craft-agent/shared/labels/auto')
    const label = getLabel(workspace.rootPath, labelId)
    if (!label) throw new Error(`Label '${labelId}' not found`)

    const rules = label.autoRules ?? []
    if (rules.length === 0) return { valid: true, rules: 0, results: [] }

    const results = rules.map((rule, i) => ({
      index: i,
      pattern: rule.pattern,
      ...validateAutoLabelRule(rule.pattern, rule.flags),
    }))
    return { valid: results.every(r => r.valid), rules: rules.length, results }
  })
}
