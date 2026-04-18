import { readFile, writeFile } from 'fs/promises'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { appendAutomationHistoryEntry } from '@craft-agent/shared/automations'
import { AUTOMATION_HISTORY_MAX_RUNS_PER_MATCHER } from '@craft-agent/shared/automations/constants'
import { getWorkspaceDb } from '@craft-agent/shared/db'
import { automationHistory } from '@craft-agent/shared/db/schema/automations.sql'
import { eq, desc } from 'drizzle-orm'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

interface HistoryEntry { id: string; ts: number; ok: boolean; sessionId?: string; prompt?: string; error?: string; webhook?: { method: string; url: string; statusCode: number; durationMs: number; attempts?: number; error?: string; responseBody?: string } }

// Per-workspace config mutex: serializes read-modify-write cycles on automations.json
// to prevent concurrent IPC calls from clobbering each other's changes.
const configMutexes = new Map<string, Promise<void>>()
function withConfigMutex<T>(workspaceRoot: string, fn: () => Promise<T>): Promise<T> {
  const prev = configMutexes.get(workspaceRoot) ?? Promise.resolve()
  const next = prev.then(fn, fn) // run fn regardless of previous result
  configMutexes.set(workspaceRoot, next.then(() => {}, () => {}))
  return next
}

// Shared helper: resolve workspace, read automations.json, validate matcher, mutate, write back
interface AutomationsConfigJson { automations?: Record<string, Record<string, unknown>[]>; [key: string]: unknown }
async function withAutomationMatcher(workspaceId: string, eventName: string, matcherIndex: number, mutate: (matchers: Record<string, unknown>[], index: number, config: AutomationsConfigJson, genId: () => string) => void) {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error('Workspace not found')

  await withConfigMutex(workspace.rootPath, async () => {
    const { resolveAutomationsConfigPath, generateShortId } = await import('@craft-agent/shared/automations/resolve-config-path')
    const configPath = resolveAutomationsConfigPath(workspace.rootPath)

    const raw = await readFile(configPath, 'utf-8')
    const config = JSON.parse(raw)

    const eventMap = config.automations ?? {}
    const matchers = eventMap[eventName]
    if (!Array.isArray(matchers) || matcherIndex < 0 || matcherIndex >= matchers.length) {
      throw new Error(`Invalid automation reference: ${eventName}[${matcherIndex}]`)
    }

    mutate(matchers, matcherIndex, config, generateShortId)

    // Backfill missing IDs on all matchers before writing
    for (const eventMatchers of Object.values(eventMap)) {
      if (!Array.isArray(eventMatchers)) continue
      for (const m of eventMatchers as Record<string, unknown>[]) {
        if (!m.id) m.id = generateShortId()
      }
    }

    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
  })
}

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.automations.LIST,
  RPC_CHANNELS.automations.CREATE,
  RPC_CHANNELS.automations.UPDATE,
  RPC_CHANNELS.automations.TEST,
  RPC_CHANNELS.automations.SET_ENABLED,
  RPC_CHANNELS.automations.DUPLICATE,
  RPC_CHANNELS.automations.DELETE,
  RPC_CHANNELS.automations.GET_HISTORY,
  RPC_CHANNELS.automations.GET_LAST_EXECUTED,
  RPC_CHANNELS.automations.REPLAY,
  RPC_CHANNELS.automations.VALIDATE,
  RPC_CHANNELS.automations.LINT,
] as const

export function registerAutomationsHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  // List automations — reads automations.json and returns raw config.
  // The UI parses this into AutomationListItem[].
  server.handle(RPC_CHANNELS.automations.LIST, async (_ctx, workspaceId: string) => {
    log.info(`AUTOMATIONS_LIST: Loading automations for workspace: ${workspaceId}`)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.error(`AUTOMATIONS_LIST: Workspace not found: ${workspaceId}`)
      return null
    }
    try {
      const { resolveAutomationsConfigPath } = await import('@craft-agent/shared/automations/resolve-config-path')
      const configPath = resolveAutomationsConfigPath(workspace.rootPath)
      log.info(`AUTOMATIONS_LIST: Reading config from: ${configPath}`)
      const content = await readFile(configPath, 'utf-8')
      const parsed = JSON.parse(content)
      const eventCount = parsed?.automations ? Object.keys(parsed.automations).length : 0
      log.info(`AUTOMATIONS_LIST: Loaded ${eventCount} event type(s) from ${configPath}`)
      return parsed
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        log.info(`AUTOMATIONS_LIST: No automations.json found for workspace ${workspaceId}`)
        return null // No automations configured yet
      }
      log.error(`AUTOMATIONS_LIST: Error loading automations:`, error)
      throw error
    }
  })

  server.handle(RPC_CHANNELS.automations.TEST, async (_ctx, payload: import('@craft-agent/shared/protocol').TestAutomationPayload) => {
    const workspace = getWorkspaceByNameOrId(payload.workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const results: import('@craft-agent/shared/protocol').TestAutomationActionResult[] = []
    const { parsePromptReferences } = await import('@craft-agent/shared/automations')
    const { executeWebhookRequest, createWebhookHistoryEntry, createPromptHistoryEntry } = await import('@craft-agent/shared/automations/webhook-utils')

    for (const action of payload.actions) {
      const start = Date.now()

      if (action.type === 'webhook') {
        // Execute webhook action using shared utility (no env expansion for test — raw URLs)
        // Cast needed: protocol DTO uses loose `method?: string`, WebhookAction uses strict union
        const result = await executeWebhookRequest(action as import('@craft-agent/shared/automations').WebhookAction)
        const method = action.method ?? 'POST'

        results.push({
          ...result,
          duration: Date.now() - start,
        })

        if (payload.automationId) {
          const entry = createWebhookHistoryEntry({
            matcherId: payload.automationId,
            ok: result.success,
            method,
            url: action.url as string,
            statusCode: result.statusCode,
            durationMs: result.durationMs ?? 0,
            error: result.error,
            responseBody: result.responseBody,
          })
          try {
            await appendAutomationHistoryEntry(workspace.rootPath, entry)
          } catch (e) {
            log.warn('[Automations] Failed to write history:', e)
          }
        }
        continue
      }

      // Prompt action
      // Parse @mentions from the prompt to resolve source/skill references
      const references = parsePromptReferences(action.prompt)

      try {
        const { sessionId } = await deps.sessionManager.executePromptAutomation(
          payload.workspaceId,
          workspace.rootPath,
          action.prompt,
          payload.labels,
          payload.permissionMode,
          references.mentions,
          action.llmConnection,
          action.model,
          undefined, // isBatch (fork: batch-only param)
          undefined, // batchContext (fork: batch-only param)
          payload.automationName,
          undefined, // workingDirectory (fork: batch-only param)
        )
        results.push({
          type: 'prompt',
          success: true,
          sessionId,
          duration: Date.now() - start,
        })

        // Write history entry for test runs
        if (payload.automationId) {
          const entry = createPromptHistoryEntry({ matcherId: payload.automationId, ok: true, sessionId, prompt: action.prompt })
          try {
            await appendAutomationHistoryEntry(workspace.rootPath, entry)
          } catch (e) {
            log.warn('[Automations] Failed to write history:', e)
          }
        }
      } catch (err: unknown) {
        results.push({
          type: 'prompt',
          success: false,
          stderr: (err as Error).message,
          duration: Date.now() - start,
        })

        // Write failed history entry
        if (payload.automationId) {
          const entry = createPromptHistoryEntry({ matcherId: payload.automationId, ok: false, error: (err as Error).message, prompt: action.prompt })
          try {
            await appendAutomationHistoryEntry(workspace.rootPath, entry)
          } catch (e) {
            log.warn('[Automations] Failed to write history:', e)
          }
        }
      }
    }

    return { actions: results } satisfies import('@craft-agent/shared/protocol').TestAutomationResult
  })

  // Automation enabled state management (toggle enabled/disabled in automations.json)
  server.handle(RPC_CHANNELS.automations.SET_ENABLED, async (_ctx, workspaceId: string, eventName: string, matcherIndex: number, enabled: boolean) => {
    await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx) => {
      if (enabled) {
        delete matchers[idx].enabled
      } else {
        matchers[idx].enabled = false
      }
    })
    deps.sessionManager.notifyAutomationsChanged(workspaceId)
  })

  // Duplicate an automation matcher
  server.handle(RPC_CHANNELS.automations.DUPLICATE, async (_ctx, workspaceId: string, eventName: string, matcherIndex: number) => {
    await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx, _config, genId) => {
      const clone = JSON.parse(JSON.stringify(matchers[idx]))
      clone.id = genId()
      clone.name = clone.name ? `${clone.name} Copy` : 'Untitled Copy'
      matchers.splice(idx + 1, 0, clone)
    })
    deps.sessionManager.notifyAutomationsChanged(workspaceId)
  })

  // Delete an automation matcher
  server.handle(RPC_CHANNELS.automations.DELETE, async (_ctx, workspaceId: string, eventName: string, matcherIndex: number) => {
    await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx, config) => {
      matchers.splice(idx, 1)
      if (matchers.length === 0) {
        const eventMap = config.automations
        if (eventMap) delete eventMap[eventName]
      }
    })
    deps.sessionManager.notifyAutomationsChanged(workspaceId)
  })

  // Read execution history for a specific automation
  server.handle(RPC_CHANNELS.automations.GET_HISTORY, async (_ctx, workspaceId: string, automationId: string, limit = AUTOMATION_HISTORY_MAX_RUNS_PER_MATCHER) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const clampedLimit = Math.max(1, Math.min(limit, AUTOMATION_HISTORY_MAX_RUNS_PER_MATCHER))
    try {
      const db = getWorkspaceDb(workspace.rootPath)
      const rows = db.select({ entry: automationHistory.entry })
        .from(automationHistory)
        .where(eq(automationHistory.automationId, automationId))
        .orderBy(desc(automationHistory.createdAt))
        .limit(clampedLimit)
        .all()

      return rows.map(r => r.entry as HistoryEntry)
    } catch {
      return []
    }
  })

  // Replay webhook actions for a specific automation matcher
  server.handle(RPC_CHANNELS.automations.REPLAY, async (_ctx, workspaceId: string, automationId: string, eventName: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { resolveAutomationsConfigPath } = await import('@craft-agent/shared/automations/resolve-config-path')
    const configPath = resolveAutomationsConfigPath(workspace.rootPath)
    const raw = await readFile(configPath, 'utf-8')
    const config = JSON.parse(raw) as { automations?: Record<string, Array<{ id?: string; actions?: Array<{ type: string; [key: string]: unknown }> }>> }

    const matchers = config.automations?.[eventName] ?? []
    const matcher = matchers.find(m => m.id === automationId)
    if (!matcher) throw new Error('Automation not found')

    const webhookActions = (matcher.actions ?? []).filter(a => a.type === 'webhook')
    if (webhookActions.length === 0) throw new Error('No webhook actions to replay')

    const { executeWebhookRequest, createWebhookHistoryEntry } = await import('@craft-agent/shared/automations/webhook-utils')
    const results = await Promise.all(
      webhookActions.map(a => executeWebhookRequest(a as unknown as import('@craft-agent/shared/automations').WebhookAction))
    )

    // Write history entries for replay — use index to correctly attribute method per action
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!
      const action = webhookActions[i]!
      const entry = createWebhookHistoryEntry({
        matcherId: automationId,
        ok: result.success,
        method: (action as { method?: string }).method,
        url: result.url,
        statusCode: result.statusCode,
        durationMs: result.durationMs ?? 0,
        error: result.error,
      })
      try {
        await appendAutomationHistoryEntry(workspace.rootPath, entry)
      } catch (e) {
        log.warn('[Automations] Failed to write replay history:', e)
      }
    }

    return { results: results.map(r => ({ ...r, duration: r.durationMs ?? 0 })) }
  })

  // Create a new automation matcher under a given event
  server.handle(RPC_CHANNELS.automations.CREATE, async (_ctx, workspaceId: string, eventName: string, matcher: Record<string, unknown>) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { VALID_EVENTS, validateAutomationsConfig } = await import('@craft-agent/shared/automations')
    if (!VALID_EVENTS.includes(eventName)) {
      throw new Error(`Invalid event: ${eventName}. Valid events: ${VALID_EVENTS.join(', ')}`)
    }

    let created!: Record<string, unknown>
    await withConfigMutex(workspace.rootPath, async () => {
      const { resolveAutomationsConfigPath, generateShortId } = await import('@craft-agent/shared/automations/resolve-config-path')
      const configPath = resolveAutomationsConfigPath(workspace.rootPath)

      let config: AutomationsConfigJson
      try {
        const raw = await readFile(configPath, 'utf-8')
        config = JSON.parse(raw)
      } catch (error) {
        if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          config = { automations: {} }
        } else {
          throw error
        }
      }

      const newMatcher = { ...matcher }
      if (!newMatcher.id) newMatcher.id = generateShortId()
      if (!Array.isArray(newMatcher.actions) || newMatcher.actions.length === 0) {
        throw new Error('Automation must have at least one action')
      }

      if (!config.automations) config.automations = {}
      const eventMap = config.automations
      if (!Array.isArray(eventMap[eventName])) eventMap[eventName] = []
      eventMap[eventName]!.push(newMatcher)

      const validation = validateAutomationsConfig(config as Parameters<typeof validateAutomationsConfig>[0])
      if (!validation.valid) {
        throw new Error(`Invalid automation config: ${validation.errors.join(', ')}`)
      }

      await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
      created = { event: eventName, ...newMatcher }
    })
    deps.sessionManager.notifyAutomationsChanged(workspaceId)
    return created
  })

  // Update fields on an existing matcher (matched by event + index, merge-overwrite)
  server.handle(RPC_CHANNELS.automations.UPDATE, async (_ctx, workspaceId: string, eventName: string, matcherIndex: number, patch: Record<string, unknown>) => {
    const { validateAutomationsConfig } = await import('@craft-agent/shared/automations')
    let updated!: Record<string, unknown>
    await withAutomationMatcher(workspaceId, eventName, matcherIndex, (matchers, idx, config) => {
      const current = matchers[idx]!
      const merged = { ...current, ...patch }
      // Preserve identity
      merged.id = current.id ?? merged.id
      matchers[idx] = merged

      const validation = validateAutomationsConfig(config as Parameters<typeof validateAutomationsConfig>[0])
      if (!validation.valid) {
        throw new Error(`Invalid automation config: ${validation.errors.join(', ')}`)
      }
      updated = { event: eventName, ...merged }
    })
    deps.sessionManager.notifyAutomationsChanged(workspaceId)
    return updated
  })

  // Validate automations.json (schema check, no mutation)
  server.handle(RPC_CHANNELS.automations.VALIDATE, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { resolveAutomationsConfigPath } = await import('@craft-agent/shared/automations/resolve-config-path')
    const { validateAutomationsConfig } = await import('@craft-agent/shared/automations')
    const configPath = resolveAutomationsConfigPath(workspace.rootPath)

    try {
      const content = await readFile(configPath, 'utf-8')
      const parsed = JSON.parse(content)
      return validateAutomationsConfig(parsed)
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { valid: true, errors: [] as string[], note: 'No automations.json found (empty config is valid)' }
      }
      throw error
    }
  })

  // Lint automations.json (best-practice checks beyond schema validation)
  server.handle(RPC_CHANNELS.automations.LINT, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { resolveAutomationsConfigPath } = await import('@craft-agent/shared/automations/resolve-config-path')
    const configPath = resolveAutomationsConfigPath(workspace.rootPath)

    let config: AutomationsConfigJson
    try {
      const raw = await readFile(configPath, 'utf-8')
      config = JSON.parse(raw)
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { clean: true, issues: [] as Array<Record<string, unknown>> }
      }
      throw error
    }

    const issues: Array<{ id?: string; event: string; issue: string }> = []
    const eventMap = config.automations ?? {}
    for (const [event, matchers] of Object.entries(eventMap)) {
      if (!Array.isArray(matchers)) continue
      for (const m of matchers as Array<Record<string, unknown>>) {
        const id = typeof m.id === 'string' ? m.id : undefined
        const matcherStr = typeof m.matcher === 'string' ? m.matcher : undefined
        if (matcherStr) {
          try { new RegExp(matcherStr) } catch { issues.push({ id, event, issue: `Invalid regex: ${matcherStr}` }) }
        }

        const actions = Array.isArray(m.actions) ? m.actions : []
        if (actions.length === 0) issues.push({ id, event, issue: 'No actions defined' })

        if (typeof m.cron === 'string') {
          const parts = m.cron.trim().split(/\s+/)
          if (parts.length !== 5) issues.push({ id, event, issue: `Invalid cron expression (expected 5 fields): ${m.cron}` })
        }

        for (const action of actions as Array<Record<string, unknown>>) {
          if (action.type === 'prompt' && typeof action.prompt === 'string') {
            const mentions = action.prompt.match(/@\w+/g) || []
            if (mentions.length > 5) {
              issues.push({ id, event, issue: `Prompt has ${mentions.length} @mentions (>5 may cause performance issues)` })
            }
          }
        }
      }
    }

    return { clean: issues.length === 0, issues }
  })

  // Return last execution timestamp for all automations
  server.handle(RPC_CHANNELS.automations.GET_LAST_EXECUTED, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    try {
      const db = getWorkspaceDb(workspace.rootPath)
      const rows = db.select({ entry: automationHistory.entry })
        .from(automationHistory)
        .all()

      const result: Record<string, number> = {}
      for (const row of rows) {
        const entry = row.entry as HistoryEntry
        if (entry.id && entry.ts) result[entry.id] = entry.ts
      }
      return result
    } catch {
      return {}
    }
  })
}
