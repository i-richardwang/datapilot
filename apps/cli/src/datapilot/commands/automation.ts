/**
 * automation entity — wraps the automations:* RPC channels.
 *
 * Flag rule: `create` keeps `--name` (identity) and `--event` (schema-branch
 * selector — the event type determines which matcher shape is valid). All
 * other matcher fields flow through `--input '<json>'`. `update` is `<id>` +
 * `--input` only. `history` keeps `--limit` as a query-param flat flag.
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, intFlag, parseInput, rejectUnknownFlags, type Flags } from '../args.ts'
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
  'enable', 'disable',
  'history', 'test',
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
      rejectUnknownFlags(flags, [])
      ok(await client.invoke('automations:list', ws))

    case 'get': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const resolved = await resolveAutomationId(client, ws, id)
      if (!resolved) fail('NOT_FOUND', `Automation '${id}' not found`)
      ok({ event: resolved.eventName, ...resolved.matcher })
    }

    case 'create': {
      rejectUnknownFlags(flags, ['name', 'event'])
      const event = strFlag(flags, 'event')
      if (!event) {
        const { VALID_EVENTS } = await import('../../vendor/automations.ts')
        fail('USAGE_ERROR', `Missing --event <EventName>. Valid events: ${VALID_EVENTS.join(', ')}`)
      }
      const input = (await parseInput(flags)) ?? {}
      const name = strFlag(flags, 'name') ?? (input.name as string | undefined)
      if (!name) {
        fail('USAGE_ERROR', 'Missing --name (or pass full config via --input <json>)')
      }
      const matcher = { ...input, name }
      ok(await client.invoke('automations:create', ws, event, matcher))
    }

    case 'update': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const resolved = await resolveAutomationId(client, ws, id)
      if (!resolved) fail('NOT_FOUND', `Automation '${id}' not found`)
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('automations:update', ws, resolved.eventName, resolved.matcherIndex, input))
    }

    case 'delete': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const resolved = await resolveAutomationId(client, ws, id)
      if (!resolved) fail('NOT_FOUND', `Automation '${id}' not found`)
      await client.invoke('automations:delete', ws, resolved.eventName, resolved.matcherIndex)
      ok({ deleted: id })
    }

    case 'enable': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const resolved = await resolveAutomationId(client, ws, id)
      if (!resolved) fail('NOT_FOUND', `Automation '${id}' not found`)
      await client.invoke('automations:setEnabled', ws, resolved.eventName, resolved.matcherIndex, true)
      ok({ enabled: id })
    }

    case 'disable': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const resolved = await resolveAutomationId(client, ws, id)
      if (!resolved) fail('NOT_FOUND', `Automation '${id}' not found`)
      await client.invoke('automations:setEnabled', ws, resolved.eventName, resolved.matcherIndex, false)
      ok({ disabled: id })
    }

    case 'history': {
      rejectUnknownFlags(flags, ['limit'])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const limit = intFlag(flags, 'limit') ?? 50
      ok(await client.invoke('automations:getHistory', ws, id, limit))
    }

    case 'test': {
      rejectUnknownFlags(flags, [])
      const input = (await parseInput(flags)) ?? {}
      const payload = { workspaceId: ws, ...input }
      ok(await client.invoke('automations:test', payload))
    }
  }

  fail('USAGE_ERROR', `Unhandled automation action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id>')
  return ws
}
