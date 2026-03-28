/**
 * Automation commands — 13 subcommands
 *
 * Storage: Filesystem JSON (automations.json) + SQLite history
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { ok, fail, warn } from '../envelope.ts'
import { strFlag, boolFlag, listFlag, intFlag } from '../args.ts'
import { parseInput } from '../input.ts'
import {
  resolveAutomationsConfigPath,
  generateShortId,
  validateAutomationsConfig,
  AUTOMATIONS_CONFIG_FILE,
  VALID_EVENTS,
} from '@craft-agent/shared/automations'
import { getWorkspaceDb } from '@craft-agent/shared/db'
import { automationHistory } from '@craft-agent/shared/db/schema'
import { desc, eq } from 'drizzle-orm'
import type { AutomationsConfig, AutomationMatcher, AutomationEvent } from '@craft-agent/shared/automations'

export function routeAutomation(
  ws: string,
  action: string | undefined,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  if (!action) fail('USAGE_ERROR', 'Missing action', 'craft-agent automation <list|get|create|update|delete|enable|disable|duplicate|history|last-executed|test|lint|validate>')

  switch (action) {
    case 'list': return cmdList(ws)
    case 'get': return cmdGet(ws, positionals)
    case 'create': return cmdCreate(ws, flags)
    case 'update': return cmdUpdate(ws, positionals, flags)
    case 'delete': return cmdDelete(ws, positionals)
    case 'enable': return cmdToggle(ws, positionals, true)
    case 'disable': return cmdToggle(ws, positionals, false)
    case 'duplicate': return cmdDuplicate(ws, positionals)
    case 'history': return cmdHistory(ws, positionals, flags)
    case 'last-executed': return cmdLastExecuted(ws, positionals)
    case 'test': return cmdTest(ws, positionals, flags)
    case 'lint': return cmdLint(ws)
    case 'validate': return cmdValidate(ws)
    default:
      fail('USAGE_ERROR', `Unknown automation action: ${action}`)
  }
}

// ─── config helpers ──────────────────────────────────────────────────────────

function loadConfig(ws: string): AutomationsConfig {
  const configPath = resolveAutomationsConfigPath(ws)
  if (!existsSync(configPath)) {
    return { automations: {} }
  }
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as AutomationsConfig
  } catch {
    fail('INTERNAL_ERROR', `Failed to parse ${AUTOMATIONS_CONFIG_FILE}`)
  }
}

function saveConfig(ws: string, config: AutomationsConfig): void {
  const configPath = resolveAutomationsConfigPath(ws)
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/** Flatten config into a list of { event, matcher } entries. */
function flattenMatchers(config: AutomationsConfig): Array<{ event: string; matcher: AutomationMatcher }> {
  const result: Array<{ event: string; matcher: AutomationMatcher }> = []
  for (const [event, matchers] of Object.entries(config.automations)) {
    if (matchers) {
      for (const matcher of matchers) {
        result.push({ event, matcher })
      }
    }
  }
  return result
}

/** Find a matcher by id across all events. */
function findMatcher(config: AutomationsConfig, id: string): { event: string; matcher: AutomationMatcher; index: number } | null {
  for (const [event, matchers] of Object.entries(config.automations)) {
    if (matchers) {
      const index = matchers.findIndex(m => m.id === id)
      if (index !== -1) return { event, matcher: matchers[index]!, index }
    }
  }
  return null
}

// ─── list ────────────────────────────────────────────────────────────────────

function cmdList(ws: string): void {
  const config = loadConfig(ws)
  ok(flattenMatchers(config))
}

// ─── get ─────────────────────────────────────────────────────────────────────

function cmdGet(ws: string, positionals: string[]): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing automation id', 'craft-agent automation get <id>')

  const config = loadConfig(ws)
  const found = findMatcher(config, id)
  if (!found) fail('NOT_FOUND', `Automation '${id}' not found`)
  ok({ event: found.event, ...found.matcher })
}

// ─── create ──────────────────────────────────────────────────────────────────

function cmdCreate(
  ws: string,
  flags: Record<string, string | boolean | string[]>,
): void {
  const input = parseInput(flags)

  const event = ((input?.event as string) ?? strFlag(flags, 'event')) as AutomationEvent | undefined
  if (!event) fail('USAGE_ERROR', 'Missing --event', 'craft-agent automation create --event <EventName>')
  if (!VALID_EVENTS.includes(event)) {
    fail('USAGE_ERROR', `Invalid event: ${event}`, `Valid events: ${VALID_EVENTS.join(', ')}`)
  }

  const id = generateShortId()
  const matcher: AutomationMatcher = { id, actions: [] }

  // Apply --json input fields
  if (input) {
    if (input.name) matcher.name = input.name as string
    if (input.matcher) matcher.matcher = input.matcher as string
    if (input.cron) matcher.cron = input.cron as string
    if (input.timezone) matcher.timezone = input.timezone as string
    if (input.permissionMode) matcher.permissionMode = input.permissionMode as AutomationMatcher['permissionMode']
    if (input.labels) matcher.labels = input.labels as string[]
    if (input.enabled !== undefined) matcher.enabled = input.enabled as boolean
    if (input.actions) matcher.actions = input.actions as AutomationMatcher['actions']
    if (input.conditions) matcher.conditions = input.conditions as AutomationMatcher['conditions']
  }

  // Flat flags override --json
  const name = strFlag(flags, 'name')
  if (name) matcher.name = name
  const matcherPattern = strFlag(flags, 'matcher')
  if (matcherPattern) matcher.matcher = matcherPattern
  const cron = strFlag(flags, 'cron')
  if (cron) matcher.cron = cron
  const timezone = strFlag(flags, 'timezone')
  if (timezone) matcher.timezone = timezone
  const permissionMode = strFlag(flags, 'permission-mode')
  if (permissionMode) matcher.permissionMode = permissionMode as AutomationMatcher['permissionMode']
  const labels = listFlag(flags, 'labels')
  if (labels) matcher.labels = labels
  const enabled = boolFlag(flags, 'enabled')
  if (enabled !== undefined) matcher.enabled = enabled
  const llmConnection = strFlag(flags, 'llm-connection')
  const model = strFlag(flags, 'model')

  // --prompt shortcut: auto-wrap as prompt action
  const prompt = strFlag(flags, 'prompt')
  if (prompt) {
    const promptAction: Record<string, unknown> = { type: 'prompt', prompt }
    if (llmConnection) promptAction.llmConnection = llmConnection
    if (model) promptAction.model = model
    matcher.actions = [promptAction as unknown as AutomationMatcher['actions'][number]]
  }

  if (matcher.actions.length === 0) {
    fail('USAGE_ERROR', 'Automation must have at least one action. Use --prompt or --json with actions array.')
  }

  const config = loadConfig(ws)
  if (!config.automations[event as keyof typeof config.automations]) {
    (config.automations as Record<string, AutomationMatcher[]>)[event] = []
  }
  ;(config.automations as Record<string, AutomationMatcher[]>)[event]!.push(matcher)

  // Validate before saving
  const validation = validateAutomationsConfig(config)
  if (!validation.valid) {
    fail('VALIDATION_ERROR', `Invalid automation config: ${validation.errors.join(', ')}`)
  }

  saveConfig(ws, config)
  ok({ event, ...matcher })
}

// ─── update ──────────────────────────────────────────────────────────────────

function cmdUpdate(
  ws: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing automation id', 'craft-agent automation update <id>')

  const config = loadConfig(ws)
  const found = findMatcher(config, id)
  if (!found) fail('NOT_FOUND', `Automation '${id}' not found`)

  const input = parseInput(flags)

  // Merge --json fields
  if (input) {
    Object.assign(found.matcher, input)
  }

  // Flat flags override
  const name = strFlag(flags, 'name')
  if (name) found.matcher.name = name
  const matcherPattern = strFlag(flags, 'matcher')
  if (matcherPattern) found.matcher.matcher = matcherPattern
  const cronVal = strFlag(flags, 'cron')
  if (cronVal) found.matcher.cron = cronVal
  const timezone = strFlag(flags, 'timezone')
  if (timezone) found.matcher.timezone = timezone
  const permissionMode = strFlag(flags, 'permission-mode')
  if (permissionMode) found.matcher.permissionMode = permissionMode as AutomationMatcher['permissionMode']
  const labels = listFlag(flags, 'labels')
  if (labels) found.matcher.labels = labels
  const enabled = boolFlag(flags, 'enabled')
  if (enabled !== undefined) found.matcher.enabled = enabled
  const prompt = strFlag(flags, 'prompt')
  if (prompt) {
    const llmConnection = strFlag(flags, 'llm-connection')
    const model = strFlag(flags, 'model')
    const promptAction: Record<string, unknown> = { type: 'prompt', prompt }
    if (llmConnection) promptAction.llmConnection = llmConnection
    if (model) promptAction.model = model
    found.matcher.actions = [promptAction as unknown as AutomationMatcher['actions'][number]]
  }

  // Validate
  const validation = validateAutomationsConfig(config)
  if (!validation.valid) {
    fail('VALIDATION_ERROR', `Invalid automation config: ${validation.errors.join(', ')}`)
  }

  saveConfig(ws, config)
  ok({ event: found.event, ...found.matcher })
}

// ─── delete ──────────────────────────────────────────────────────────────────

function cmdDelete(ws: string, positionals: string[]): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing automation id', 'craft-agent automation delete <id>')

  const config = loadConfig(ws)
  const found = findMatcher(config, id)
  if (!found) fail('NOT_FOUND', `Automation '${id}' not found`)

  const matchers = (config.automations as Record<string, AutomationMatcher[]>)[found.event]!
  matchers.splice(found.index, 1)
  if (matchers.length === 0) {
    delete (config.automations as Record<string, AutomationMatcher[]>)[found.event]
  }

  saveConfig(ws, config)
  ok({ deleted: id })
}

// ─── enable / disable ────────────────────────────────────────────────────────

function cmdToggle(ws: string, positionals: string[], enabled: boolean): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', `Missing automation id`, `craft-agent automation ${enabled ? 'enable' : 'disable'} <id>`)

  const config = loadConfig(ws)
  const found = findMatcher(config, id)
  if (!found) fail('NOT_FOUND', `Automation '${id}' not found`)

  found.matcher.enabled = enabled
  saveConfig(ws, config)
  ok({ id, enabled })
}

// ─── duplicate ───────────────────────────────────────────────────────────────

function cmdDuplicate(ws: string, positionals: string[]): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing automation id', 'craft-agent automation duplicate <id>')

  const config = loadConfig(ws)
  const found = findMatcher(config, id)
  if (!found) fail('NOT_FOUND', `Automation '${id}' not found`)

  const clone: AutomationMatcher = JSON.parse(JSON.stringify(found.matcher))
  clone.id = generateShortId()
  if (clone.name) clone.name = `${clone.name} (copy)`

  ;(config.automations as Record<string, AutomationMatcher[]>)[found.event]!.push(clone)
  saveConfig(ws, config)
  ok({ event: found.event, ...clone })
}

// ─── history ─────────────────────────────────────────────────────────────────

function cmdHistory(
  ws: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const automationId = positionals[0]
  const limit = intFlag(flags, 'limit') ?? 20

  const db = getWorkspaceDb(ws)

  let rows
  if (automationId) {
    rows = db.select()
      .from(automationHistory)
      .where(eq(automationHistory.automationId, automationId))
      .orderBy(desc(automationHistory.createdAt))
      .limit(limit)
      .all()
  } else {
    rows = db.select()
      .from(automationHistory)
      .orderBy(desc(automationHistory.createdAt))
      .limit(limit)
      .all()
  }

  ok(rows.map(r => ({ ...r.entry as Record<string, unknown>, createdAt: r.createdAt })))
}

// ─── last-executed ───────────────────────────────────────────────────────────

function cmdLastExecuted(ws: string, positionals: string[]): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing automation id', 'craft-agent automation last-executed <id>')

  const db = getWorkspaceDb(ws)
  const row = db.select()
    .from(automationHistory)
    .where(eq(automationHistory.automationId, id))
    .orderBy(desc(automationHistory.createdAt))
    .limit(1)
    .get()

  if (!row) ok(null)
  ok({ ...row!.entry as Record<string, unknown>, createdAt: row!.createdAt })
}

// ─── test ────────────────────────────────────────────────────────────────────

function cmdTest(
  ws: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing automation id', 'craft-agent automation test <id> [--match "..."]')

  const config = loadConfig(ws)
  const found = findMatcher(config, id)
  if (!found) fail('NOT_FOUND', `Automation '${id}' not found`)

  const matchInput = strFlag(flags, 'match')

  if (!found.matcher.matcher) {
    ok({ id, hasPattern: false, note: 'No matcher pattern defined' })
    return
  }

  try {
    const regex = new RegExp(found.matcher.matcher, 'i')
    if (matchInput) {
      const match = regex.test(matchInput)
      ok({ id, pattern: found.matcher.matcher, input: matchInput, matched: match })
    } else {
      // Just validate the regex compiles
      ok({ id, pattern: found.matcher.matcher, valid: true })
    }
  } catch (e) {
    fail('VALIDATION_ERROR', `Invalid matcher regex: ${(e as Error).message}`)
  }
}

// ─── lint ────────────────────────────────────────────────────────────────────

function cmdLint(ws: string): void {
  const config = loadConfig(ws)
  const issues: Array<{ id?: string; event: string; issue: string }> = []

  for (const [event, matchers] of Object.entries(config.automations)) {
    if (!matchers) continue
    for (const matcher of matchers) {
      // Check regex syntax
      if (matcher.matcher) {
        try {
          new RegExp(matcher.matcher)
        } catch {
          issues.push({ id: matcher.id, event, issue: `Invalid regex: ${matcher.matcher}` })
        }
      }

      // Check empty actions
      if (!matcher.actions || matcher.actions.length === 0) {
        issues.push({ id: matcher.id, event, issue: 'No actions defined' })
      }

      // Check cron syntax (basic validation)
      if (matcher.cron) {
        const parts = matcher.cron.trim().split(/\s+/)
        if (parts.length !== 5) {
          issues.push({ id: matcher.id, event, issue: `Invalid cron expression (expected 5 fields): ${matcher.cron}` })
        }
      }

      // Check prompt actions for oversized mentions
      for (const action of matcher.actions ?? []) {
        if (action.type === 'prompt' && action.prompt) {
          const mentions = (action.prompt.match(/@\w+/g) || [])
          if (mentions.length > 5) {
            issues.push({ id: matcher.id, event, issue: `Prompt has ${mentions.length} @mentions (>5 may cause performance issues)` })
          }
        }
      }
    }
  }

  ok({ clean: issues.length === 0, issues })
}

// ─── validate ────────────────────────────────────────────────────────────────

function cmdValidate(ws: string): void {
  const configPath = resolveAutomationsConfigPath(ws)
  if (!existsSync(configPath)) {
    ok({ valid: true, note: 'No automations.json found (empty config is valid)' })
    return
  }

  try {
    const content = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(content)
    const result = validateAutomationsConfig(parsed)
    ok(result)
  } catch (e) {
    fail('VALIDATION_ERROR', `Failed to parse ${AUTOMATIONS_CONFIG_FILE}: ${(e as Error).message}`)
  }
}
