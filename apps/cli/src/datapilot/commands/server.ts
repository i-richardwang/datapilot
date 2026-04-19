/**
 * server entity — read-only introspection of the running datapilot server.
 *
 * Actions:
 *   status       Return workspace runtime snapshot (active sessions, automation count, scheduler state).
 */

import { ok, fail } from '../envelope.ts'
import type { Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = ['status'] as const

export async function routeServer(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'server', actions: ACTIONS })
  if (!ACTIONS.includes(action as typeof ACTIONS[number])) {
    fail('USAGE_ERROR', `Unknown server action: ${action}`)
  }

  switch (action) {
    case 'status': {
      const client = await ctx.getClient()
      const full = await client.invoke('server:getStatus') as { workspaces: unknown[] }
      ok({ workspaces: full.workspaces })
    }
  }

  fail('USAGE_ERROR', `Unhandled server action: ${action}`)
}
