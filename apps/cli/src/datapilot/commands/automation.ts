/**
 * automation entity — wraps the automations:* RPC channels.
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, intFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

interface AutomationMatcher { id?: string; [key: string]: unknown }
interface AutomationsListResult { automations?: Record<string, AutomationMatcher[]> }

interface ResolvedAutomation {
  eventName: string
  matcherIndex: number
  matcher: AutomationMatcher
}

/**
 * Resolve an automation ID to (eventName, matcherIndex, matcher).
 * Returns null if not found.
 */
async function resolveAutomationId(
  client: RouteCtx['getClient'] extends () => Promise<infer T> ? T : never,
  ws: string,
  id: string,
): Promise<ResolvedAutomation | null> {
  const result = (await client.invoke('automations:list', ws)) as AutomationsListResult | null
  if (!result?.automations) return null

  for (const [eventName, matchers] of Object.entries(result.automations)) {
    if (!Array.isArray(matchers)) continue
    const matcherIndex = matchers.findIndex((m) => m.id === id)
    if (matcherIndex !== -1) {
      return { eventName, matcherIndex, matcher: matchers[matcherIndex]! }
    }
  }
  return null
}

const ACTIONS = [
  'list', 'get', 'create', 'update', 'delete',
  'enable', 'disable', 'duplicate',
  'history', 'last-executed', 'test', 'replay',
  'validate', 'lint',
] as const

export async function routeAutomation(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'automation', actions: ACTIONS })
  if (!ACTIONS.includes(action as typeof ACTIONS[number])) {
    fail('USAGE_ERROR', `Unknown automation action: ${action}`)
  }

  const ws = await requireWorkspace(ctx)
  const client = await ctx.getClient()

  switch (action) {
    case 'list':
      ok(await client.invoke('automations:list', ws))

    case 'get': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const resolved = await resolveAutomationId(client, ws, id)
      if (!resolved) fail('NOT_FOUND', `Automation '${id}' not found`)
      ok({ event: resolved.eventName, ...resolved.matcher })
    }

    case 'create': {
      const event = strFlag(flags, 'event')
      if (!event) {
        const { VALID_EVENTS } = await import('@craft-agent/shared/automations')
        fail('USAGE_ERROR', `Missing --event <EventName>. Valid events: ${VALID_EVENTS.join(', ')}`)
      }
      const input = (await parseInput(flags)) ?? {}
      if (!input.name && !strFlag(flags, 'name')) {
        fail('USAGE_ERROR', 'Missing --name (or pass full config via --input <json>)')
      }
      const matcher = input.name ? input : { ...input, name: strFlag(flags, 'name') }
      ok(await client.invoke('automations:create', ws, event, matcher))
    }

    case 'update': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const resolved = await resolveAutomationId(client, ws, id)
      if (!resolved) fail('NOT_FOUND', `Automation '${id}' not found`)
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('automations:update', ws, resolved.eventName, resolved.matcherIndex, input))
    }

    case 'delete': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const resolved = await resolveAutomationId(client, ws, id)
      if (!resolved) fail('NOT_FOUND', `Automation '${id}' not found`)
      await client.invoke('automations:delete', ws, resolved.eventName, resolved.matcherIndex)
      ok({ deleted: id })
    }

    case 'enable': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      ok(await client.invoke('automations:setEnabled', ws, id, true))
    }

    case 'disable': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      ok(await client.invoke('automations:setEnabled', ws, id, false))
    }

    case 'duplicate': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      ok(await client.invoke('automations:duplicate', ws, id))
    }

    case 'history': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const limit = intFlag(flags, 'limit') ?? 50
      ok(await client.invoke('automations:getHistory', ws, id, limit))
    }

    case 'last-executed':
      ok(await client.invoke('automations:getLastExecuted', ws))

    case 'test': {
      const input = (await parseInput(flags)) ?? {}
      const payload = { workspaceId: ws, ...input }
      ok(await client.invoke('automations:test', payload))
    }

    case 'replay': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const resolved = await resolveAutomationId(client, ws, id)
      if (!resolved) fail('NOT_FOUND', `Automation '${id}' not found`)
      ok(await client.invoke('automations:replay', ws, id, resolved.eventName))
    }

    case 'validate': {
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('automations:validate', ws, input))
    }

    case 'lint':
      ok(await client.invoke('automations:lint', ws))
  }

  fail('USAGE_ERROR', `Unhandled automation action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id>')
  return ws
}
