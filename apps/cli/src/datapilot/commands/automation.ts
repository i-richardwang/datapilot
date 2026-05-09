/**
 * automation entity — wraps the automations:* RPC channels.
 *
 * Flag rule: `create` keeps `--name` (identity) and `--event` (schema-branch
 * selector — the event type determines which matcher shape is valid). All
 * other matcher fields flow through `--input '<json>'`. `update` is `<id>` +
 * `--input` only. `history` keeps `--limit` as a query-param flat flag.
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, intFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'
import { rejectActionFlags, type ActionSpec, type EntitySpec } from '../help.ts'

interface AutomationMatcher { id?: string; [key: string]: unknown }
interface AutomationsListResult { automations?: Record<string, AutomationMatcher[]> }

interface ResolvedAutomation {
  eventName: string
  matcherIndex: number
  matcher: AutomationMatcher
}

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

export const AUTOMATION_SPEC: EntitySpec = {
  name: 'automation',
  description: 'Workspace automations (event-triggered prompt executions)',
  actions: [
    {
      name: 'list',
      description: 'List all automations grouped by event',
      flags: [],
      example: 'dtpilot automation list',
    },
    {
      name: 'get',
      description: 'Show one automation matcher',
      positionals: [{ name: 'id', description: 'Automation matcher id' }],
      flags: [],
      example: 'dtpilot automation get my-matcher-id',
    },
    {
      name: 'create',
      description: 'Create a new automation (matcher fields go in --input)',
      flags: [
        { name: 'name', type: 'string', required: true, description: 'Matcher display name' },
        { name: 'event', type: 'string', required: true, description: 'Event name (selects the matcher schema branch)' },
      ],
      takesInput: true,
      example: 'dtpilot automation create --name "On new session" --event SessionCreated --input \'{"actions":[...]}\'',
    },
    {
      name: 'update',
      description: 'Update matcher fields',
      positionals: [{ name: 'id', description: 'Automation matcher id' }],
      flags: [],
      takesInput: true,
      example: 'dtpilot automation update my-matcher-id --input \'{"permissionMode":"safe"}\'',
    },
    {
      name: 'delete',
      description: 'Delete a matcher',
      positionals: [{ name: 'id', description: 'Automation matcher id' }],
      flags: [],
      example: 'dtpilot automation delete my-matcher-id',
    },
    {
      name: 'enable',
      description: 'Enable a matcher',
      positionals: [{ name: 'id', description: 'Automation matcher id' }],
      flags: [],
      example: 'dtpilot automation enable my-matcher-id',
    },
    {
      name: 'disable',
      description: 'Disable a matcher',
      positionals: [{ name: 'id', description: 'Automation matcher id' }],
      flags: [],
      example: 'dtpilot automation disable my-matcher-id',
    },
    {
      name: 'history',
      description: 'Show recent triggers for one matcher',
      positionals: [{ name: 'id', description: 'Automation matcher id' }],
      flags: [{ name: 'limit', type: 'int', description: 'Max history entries', default: 50 }],
      example: 'dtpilot automation history my-matcher-id --limit 20',
    },
    {
      name: 'test',
      description: 'Manually fire a matcher to verify it runs end-to-end',
      positionals: [{ name: 'id', description: 'Automation matcher id' }],
      flags: [],
      example: 'dtpilot automation test my-matcher-id',
    },
  ],
}

function specOf(action: string): ActionSpec {
  return AUTOMATION_SPEC.actions.find((a) => a.name === action)!
}

export async function routeAutomation(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'automation', actions: AUTOMATION_SPEC.actions.map((a) => a.name) })
  if (!AUTOMATION_SPEC.actions.some((a) => a.name === action)) {
    fail('USAGE_ERROR', `Unknown automation action: ${action}`, {
      suggestion: `Valid actions: ${AUTOMATION_SPEC.actions.map((a) => a.name).join(', ')}`,
    })
  }

  const ws = await requireWorkspace(ctx)
  const client = await ctx.getClient()

  switch (action) {
    case 'list':
      rejectActionFlags(flags, specOf('list'))
      ok(await client.invoke('automations:list', ws))

    case 'get': {
      rejectActionFlags(flags, specOf('get'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const resolved = await resolveAutomationId(client, ws, id)
      if (!resolved) fail('NOT_FOUND', `Automation '${id}' not found`)
      ok({ event: resolved.eventName, ...resolved.matcher })
    }

    case 'create': {
      rejectActionFlags(flags, specOf('create'))
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
      rejectActionFlags(flags, specOf('update'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const resolved = await resolveAutomationId(client, ws, id)
      if (!resolved) fail('NOT_FOUND', `Automation '${id}' not found`)
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('automations:update', ws, resolved.eventName, resolved.matcherIndex, input))
    }

    case 'delete': {
      rejectActionFlags(flags, specOf('delete'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const resolved = await resolveAutomationId(client, ws, id)
      if (!resolved) fail('NOT_FOUND', `Automation '${id}' not found`)
      await client.invoke('automations:delete', ws, resolved.eventName, resolved.matcherIndex)
      ok({ deleted: id })
    }

    case 'enable': {
      rejectActionFlags(flags, specOf('enable'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const resolved = await resolveAutomationId(client, ws, id)
      if (!resolved) fail('NOT_FOUND', `Automation '${id}' not found`)
      await client.invoke('automations:setEnabled', ws, resolved.eventName, resolved.matcherIndex, true)
      ok({ enabled: id })
    }

    case 'disable': {
      rejectActionFlags(flags, specOf('disable'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const resolved = await resolveAutomationId(client, ws, id)
      if (!resolved) fail('NOT_FOUND', `Automation '${id}' not found`)
      await client.invoke('automations:setEnabled', ws, resolved.eventName, resolved.matcherIndex, false)
      ok({ disabled: id })
    }

    case 'history': {
      rejectActionFlags(flags, specOf('history'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const limit = intFlag(flags, 'limit') ?? 50
      ok(await client.invoke('automations:getHistory', ws, id, limit))
    }

    case 'test': {
      rejectActionFlags(flags, specOf('test'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing automation id')
      const resolved = await resolveAutomationId(client, ws, id)
      if (!resolved) fail('NOT_FOUND', `Automation '${id}' not found`)
      const m = resolved.matcher as {
        name?: string
        actions?: unknown
        permissionMode?: string
        labels?: string[]
        telegramTopic?: string
      }
      ok(await client.invoke('automations:test', {
        workspaceId: ws,
        automationId: id,
        automationName: m.name,
        actions: m.actions,
        permissionMode: m.permissionMode,
        labels: m.labels,
        telegramTopic: m.telegramTopic,
      }))
    }
  }

  fail('USAGE_ERROR', `Unhandled automation action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id>')
  return ws
}
