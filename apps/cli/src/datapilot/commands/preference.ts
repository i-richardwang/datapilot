/**
 * preference entity — wraps the preferences:* RPC channels.
 *
 * Preferences are a single user-level object (not per-workspace, not a list),
 * so only `get` and `update` exist. Data fields (`name`, `timezone`, `notes`,
 * `location.*`, `language`, `includeCoAuthoredBy`) flow through
 * `--input '<json>'`. No flat data flags.
 *
 * Schema validation happens server-side via `UserPreferencesSchema` from
 * `@craft-agent/shared/config` — bad input comes back as a `VALIDATION_ERROR`
 * envelope code from the RPC layer.
 */
import { ok, fail } from '../envelope.ts'
import { parseInput, rejectUnknownFlags, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = ['get', 'update'] as const

export async function routePreference(
  ctx: RouteCtx,
  action: string | undefined,
  _positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'preference', actions: ACTIONS })
  if (!ACTIONS.includes(action as typeof ACTIONS[number])) {
    fail('USAGE_ERROR', `Unknown preference action: ${action}`)
  }

  const client = await ctx.getClient()

  switch (action) {
    case 'get':
      rejectUnknownFlags(flags, [])
      ok(await client.invoke('preferences:get'))

    case 'update': {
      rejectUnknownFlags(flags, [])
      const input = await parseInput(flags)
      if (!input || Object.keys(input).length === 0) {
        fail('USAGE_ERROR', 'Missing preference fields', {
          suggestion: `dtpilot preference update --input '{"name":"Alex","timezone":"UTC"}'`,
        })
      }
      ok(await client.invoke('preferences:update', input))
    }
  }

  fail('USAGE_ERROR', `Unhandled preference action: ${action}`)
}
