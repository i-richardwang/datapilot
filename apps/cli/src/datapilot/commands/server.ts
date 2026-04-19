/**
 * server entity — read-only introspection of the running datapilot server.
 *
 * Actions:
 *   health       Connect to a running server and report its health check.
 *   status       Report startup info: connected client count, uptime.
 *   versions     Print the server's reported runtime versions.
 *   endpoint     Print the resolved endpoint without connecting.
 *   home-dir     Print the server's home directory.
 */

import { ok, fail } from '../envelope.ts'
import type { Flags } from '../args.ts'
import { resolveEndpoint, type ConnectOptions } from '../transport.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = ['health', 'status', 'versions', 'endpoint', 'home-dir'] as const

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
    case 'endpoint': return cmdEndpoint(ctx)
    case 'health': {
      const client = await ctx.getClient()
      ok(await client.invoke('credentials:healthCheck'))
    }
    case 'status': {
      const client = await ctx.getClient()
      ok(await client.invoke('server:getStatus'))
    }
    case 'versions': {
      const client = await ctx.getClient()
      ok(await client.invoke('system:versions'))
    }
    case 'home-dir': {
      const client = await ctx.getClient()
      ok(await client.invoke('system:homeDir'))
    }
  }

  fail('USAGE_ERROR', `Unhandled server action: ${action}`)
}

async function cmdEndpoint(ctx: RouteCtx): Promise<never> {
  const opts: ConnectOptions = {
    url: ctx.global.url,
    token: ctx.global.token,
  }
  const endpoint = resolveEndpoint(opts)
  ok({ url: endpoint.url, source: endpoint.source, hasToken: !!endpoint.token })
}
