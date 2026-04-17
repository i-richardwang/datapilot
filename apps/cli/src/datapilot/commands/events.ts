/**
 * events entity — subscribe to push events from the server.
 *
 * Default channel is `session:event`; pass --channel <name> to listen on
 * something else (e.g. labels:changed). With --workspace, the client is
 * bound to a workspace before subscribing so workspace-scoped pushes are
 * delivered.
 *
 * Output:
 *   non-TTY: one JSON object per line ({channel, args, ts}) — newline-delimited
 *   TTY:     compact human-readable summary, one line per event
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = ['tail'] as const

export async function routeEvents(
  ctx: RouteCtx,
  action: string | undefined,
  _positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'events', actions: ACTIONS })
  if (!ACTIONS.includes(action as typeof ACTIONS[number])) {
    fail('USAGE_ERROR', `Unknown events action: ${action}`)
  }

  const channel = strFlag(flags, 'channel') ?? 'session:event'
  const sessionFilter = strFlag(flags, 'session')
  const client = await ctx.getClient()

  // Bind to workspace if one was resolved
  await ctx.getWorkspace().catch(() => undefined)

  process.stderr.write(`Listening on ${channel} (Ctrl+C to stop)\n`)

  const isTty = process.stdout.isTTY === true && !ctx.global.json
  client.on(channel, (...args: unknown[]) => {
    const ev = args[0] as Record<string, unknown> | undefined
    if (sessionFilter && ev?.sessionId !== sessionFilter) return
    if (isTty) {
      process.stdout.write(formatEventLine(channel, args) + '\n')
    } else {
      process.stdout.write(JSON.stringify({ channel, args, ts: Date.now() }) + '\n')
    }
  })

  // Block forever — exit on Ctrl+C
  await new Promise(() => {})
  process.exit(0)
}

function formatEventLine(channel: string, args: unknown[]): string {
  const first = args[0]
  if (first && typeof first === 'object') {
    const ev = first as Record<string, unknown>
    if (typeof ev.type === 'string') {
      const sid = ev.sessionId ? ` session=${String(ev.sessionId).slice(0, 8)}` : ''
      const summary = ev.delta ? ` "${String(ev.delta).slice(0, 60).replace(/\n/g, ' ')}"`
        : ev.toolName ? ` tool=${String(ev.toolName)}`
        : ''
      return `[${channel}] ${ev.type}${sid}${summary}`
    }
  }
  return `[${channel}] ${JSON.stringify(args).slice(0, 200)}`
}
