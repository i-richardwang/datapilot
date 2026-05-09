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
import { parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'
import { rejectActionFlags, type ActionSpec, type EntitySpec } from '../help.ts'

export const PREFERENCE_SPEC: EntitySpec = {
  name: 'preference',
  description: 'User preferences (name, timezone, language, notes — single object)',
  actions: [
    {
      name: 'get',
      description: 'Show the user preferences object',
      flags: [],
      example: 'dtpilot preference get',
    },
    {
      name: 'update',
      description: 'Update preference fields (all fields go in --input)',
      flags: [],
      takesInput: true,
      example: 'dtpilot preference update --input \'{"name":"Alex","timezone":"UTC"}\'',
    },
  ],
}

function specOf(action: string): ActionSpec {
  return PREFERENCE_SPEC.actions.find((a) => a.name === action)!
}

export async function routePreference(
  ctx: RouteCtx,
  action: string | undefined,
  _positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'preference', actions: PREFERENCE_SPEC.actions.map((a) => a.name) })
  if (!PREFERENCE_SPEC.actions.some((a) => a.name === action)) {
    fail('USAGE_ERROR', `Unknown preference action: ${action}`, {
      suggestion: `Valid actions: ${PREFERENCE_SPEC.actions.map((a) => a.name).join(', ')}`,
    })
  }

  const client = await ctx.getClient()

  switch (action) {
    case 'get':
      rejectActionFlags(flags, specOf('get'))
      ok(await client.invoke('preferences:get'))

    case 'update': {
      rejectActionFlags(flags, specOf('update'))
      const input = await parseInput(flags)
      if (!input || Object.keys(input).length === 0) fail('USAGE_ERROR', 'Missing preference fields in --input')
      ok(await client.invoke('preferences:update', input))
    }
  }

  fail('USAGE_ERROR', `Unhandled preference action: ${action}`)
}
