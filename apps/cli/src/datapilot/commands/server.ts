/**
 * server entity — infrastructure for managing the local datapilot server.
 *
 * Actions:
 *   start        Spawn a local server in the foreground; writes the discovery
 *                file with the child server's PID, blocks until SIGINT/SIGTERM
 *                or until the server exits on its own.
 *   stop         Read the discovery file and SIGTERM the recorded child PID.
 *   health       Connect to a running server and report its health check.
 *   status       Report startup info: connected client count, uptime.
 *   versions     Print the server's reported runtime versions.
 *   endpoint     Print the resolved endpoint without connecting.
 *   home-dir     Print the server's home directory.
 *
 * Backgrounding is intentionally out of scope for Phase 4 — wrap with `nohup`
 * / `screen` / a service supervisor instead. (See PR review on DEV-20 for
 * context: real `--detach` requires `proc.unref()` + log redirection and
 * cross-OS handling that doesn't belong in this phase.)
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { ok, fail } from '../envelope.ts'
import { strFlag, intFlag, type Flags } from '../args.ts'
import {
  DEFAULT_PORT,
  DISCOVERY_FILE,
  readDiscoveryFile,
  resolveEndpoint,
  type ConnectOptions,
} from '../transport.ts'
import type { RouteCtx } from '../router.ts'
import { spawnServer } from '../../server-spawner.ts'

const ACTIONS = ['start', 'stop', 'health', 'status', 'versions', 'endpoint', 'home-dir'] as const

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
    case 'start': return cmdStart(flags)
    case 'stop': return cmdStop()
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

async function cmdStart(flags: Flags): Promise<never> {
  const port = intFlag(flags, 'port') ?? DEFAULT_PORT
  const host = strFlag(flags, 'host') ?? '127.0.0.1'
  const serverEntry = strFlag(flags, 'server-entry')

  if (flags['detach']) {
    fail('USAGE_ERROR', '--detach is not yet supported in Phase 4', {
      suggestion: "Run 'datapilot server start' in the foreground and wrap with nohup / a service supervisor; backgrounding lands in a follow-up phase.",
    })
  }

  const env: Record<string, string> = {
    DATAPILOT_RPC_HOST: host,
    DATAPILOT_RPC_PORT: String(port),
  }

  process.stderr.write(`Starting server on ${host}:${port}...\n`)
  const server = await spawnServer({
    serverEntry,
    env,
    startupTimeout: 60_000,
  })

  writeDiscoveryFile({
    url: server.url,
    token: server.token,
    pid: server.pid,
    startedAt: Date.now(),
  })

  process.stderr.write(`Server ready: ${server.url} (pid ${server.pid})\n`)
  process.stderr.write(`Discovery file: ${DISCOVERY_FILE}\n`)

  // Foreground mode — wire signals so SIGINT cleanly stops the spawned server,
  // and watch the child for unexpected exit so we don't sit on a dead PID.
  let stopping = false
  const cleanup = async (): Promise<never> => {
    if (!stopping) {
      stopping = true
      try { await server.stop() } catch { /* ignore */ }
    }
    try { unlinkSync(DISCOVERY_FILE) } catch { /* ignore */ }
    process.exit(0)
  }
  process.on('SIGINT', () => { void cleanup() })
  process.on('SIGTERM', () => { void cleanup() })

  // If the server exits on its own (e.g. someone SIGTERM'd the child PID
  // directly via `datapilot server stop`), tear down the discovery file and
  // exit too — otherwise this CLI sits forever on a dead server.
  void server.exited.then(() => { void cleanup() })

  await new Promise(() => {})
  // Unreachable, but TypeScript needs this for the `never` return type
  process.exit(0)
}

async function cmdStop(): Promise<never> {
  const record = readDiscoveryFile()
  if (!record?.pid) {
    fail('NOT_FOUND', 'No running server recorded in discovery file', {
      suggestion: `Discovery file ${DISCOVERY_FILE} missing or has no PID`,
    })
  }
  try {
    process.kill(record.pid, 'SIGTERM')
  } catch (e) {
    fail('INTERNAL_ERROR', `Could not signal PID ${record.pid}: ${(e as Error).message}`)
  }
  // The foreground `server start` watcher will remove the discovery file on
  // child exit; do the same here defensively in case nobody is watching.
  try { unlinkSync(DISCOVERY_FILE) } catch { /* ignore */ }
  ok({ stopped: record.pid, url: record.url })
}

async function cmdEndpoint(ctx: RouteCtx): Promise<never> {
  const opts: ConnectOptions = {
    url: ctx.global.url,
    token: ctx.global.token,
  }
  const endpoint = resolveEndpoint(opts)
  ok({ url: endpoint.url, source: endpoint.source, hasToken: !!endpoint.token })
}

function writeDiscoveryFile(record: { url: string; token: string; pid: number; startedAt: number }): void {
  const dir = dirname(DISCOVERY_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(DISCOVERY_FILE, JSON.stringify(record, null, 2), { mode: 0o600 })
}
