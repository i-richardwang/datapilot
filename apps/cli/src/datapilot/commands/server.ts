/**
 * server entity — infrastructure for managing the local datapilot server.
 *
 * Actions:
 *   start        Spawn a local server, write the discovery file, and exit
 *                (server keeps running in the foreground unless --detach).
 *   stop         Read the discovery file, signal SIGTERM to the recorded PID.
 *   health       Connect to a running server and report its health check.
 *   status       Report startup info: connected client count, uptime.
 *   versions     Print the server's reported runtime versions.
 *   endpoint     Print the resolved endpoint without connecting.
 *   home-dir     Print the server's home directory.
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { ok, fail } from '../envelope.ts'
import { strFlag, intFlag, boolFlag, type Flags } from '../args.ts'
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
  const detach = boolFlag(flags, 'detach') ?? false

  // Spawn — port 0 lets the kernel pick when port is 0; otherwise force the requested one.
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
    pid: process.pid,
    startedAt: Date.now(),
  })

  process.stderr.write(`Server ready: ${server.url}\n`)
  process.stderr.write(`Discovery file: ${DISCOVERY_FILE}\n`)

  if (detach) {
    // Best effort: leave the spawned process running, exit the CLI. The server
    // is the parent's child though, so when this CLI exits the OS will keep
    // the orphan alive only on Unix; document this caveat in the help.
    ok({
      url: server.url,
      token: server.token,
      pid: process.pid,
      detached: true,
      discoveryFile: DISCOVERY_FILE,
    })
  }

  // Foreground mode — wire signals so SIGINT cleanly stops the spawned server
  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    try { await server.stop() } catch { /* ignore */ }
    try { unlinkSync(DISCOVERY_FILE) } catch { /* ignore */ }
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  // Block forever — server is now running
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
