/**
 * Transport layer for the unified `datapilot` CLI — a single WebSocket
 * connection to a running server.
 *
 * URL resolution order:
 *   1. --url flag
 *   2. $DATAPILOT_SERVER_URL env var
 *   3. discovery file at ~/.datapilot/.server.endpoint (written by `server start`)
 *   4. default ws://127.0.0.1:9100
 *
 * Token resolution mirrors the URL: --token, env, discovery file, then unset.
 *
 * If the connection fails, surface a clear error with a hint to start a
 * server — never silently spawn one.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { CliRpcClient } from '../client.ts'

export const DEFAULT_PORT = 9100
export const DEFAULT_URL = `ws://127.0.0.1:${DEFAULT_PORT}`
export const DISCOVERY_FILE = join(homedir(), '.datapilot', '.server.endpoint')

export interface ConnectOptions {
  url?: string
  token?: string
  workspace?: string
  timeout?: number
  tlsCa?: string
}

export interface ResolvedEndpoint {
  url: string
  token: string | undefined
  /** Where the URL came from — used in error messages. */
  source: 'flag' | 'env' | 'discovery' | 'default'
}

export interface DiscoveryRecord {
  url: string
  token?: string
  pid?: number
  startedAt?: number
}

export function readDiscoveryFile(): DiscoveryRecord | null {
  if (!existsSync(DISCOVERY_FILE)) return null
  try {
    const raw = readFileSync(DISCOVERY_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as DiscoveryRecord
    if (!parsed?.url || typeof parsed.url !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function resolveEndpoint(opts: ConnectOptions): ResolvedEndpoint {
  if (opts.url) {
    return { url: opts.url, token: opts.token, source: 'flag' }
  }
  if (process.env.DATAPILOT_SERVER_URL) {
    return {
      url: process.env.DATAPILOT_SERVER_URL,
      token: opts.token ?? process.env.DATAPILOT_SERVER_TOKEN ?? undefined,
      source: 'env',
    }
  }
  const discovery = readDiscoveryFile()
  if (discovery) {
    return {
      url: discovery.url,
      token: opts.token ?? discovery.token ?? process.env.DATAPILOT_SERVER_TOKEN ?? undefined,
      source: 'discovery',
    }
  }
  return {
    url: DEFAULT_URL,
    token: opts.token ?? process.env.DATAPILOT_SERVER_TOKEN ?? undefined,
    source: 'default',
  }
}

export class ConnectionError extends Error {
  readonly url: string
  readonly source: ResolvedEndpoint['source']
  constructor(url: string, source: ResolvedEndpoint['source'], cause: string) {
    super(
      `no server detected at ${url} (${cause}); ` +
      `start one with 'datapilot server start' or point elsewhere with --url`,
    )
    this.url = url
    this.source = source
  }
}

/**
 * Connect a CliRpcClient to the resolved server URL. Throws ConnectionError
 * (with an actionable message) on failure.
 */
export async function connect(opts: ConnectOptions): Promise<{ client: CliRpcClient; endpoint: ResolvedEndpoint }> {
  const tlsCa = opts.tlsCa ?? process.env.DATAPILOT_TLS_CA
  if (tlsCa) {
    process.env.NODE_EXTRA_CA_CERTS = tlsCa
  }

  const endpoint = resolveEndpoint(opts)
  const client = new CliRpcClient(endpoint.url, {
    token: endpoint.token,
    workspaceId: opts.workspace,
    requestTimeout: opts.timeout ?? 30_000,
    connectTimeout: opts.timeout ?? 10_000,
  })

  try {
    await client.connect()
  } catch (err) {
    client.destroy()
    const cause = err instanceof Error ? err.message : String(err)
    throw new ConnectionError(endpoint.url, endpoint.source, cause)
  }

  return { client, endpoint }
}

/**
 * Resolve a workspace ID for entity commands that require one.
 *
 * Order: explicit --workspace flag → first workspace returned by the server.
 * Returns undefined if no workspaces exist (caller decides whether to fail).
 *
 * Side effect: binds the client to the resolved workspace via
 * window:switchWorkspace so push events are routed to us.
 */
export async function resolveWorkspaceId(
  client: CliRpcClient,
  explicit?: string,
): Promise<string | undefined> {
  if (explicit) {
    await client.invoke('window:switchWorkspace', explicit).catch(() => {})
    return explicit
  }
  try {
    const workspaces = (await client.invoke('workspaces:get')) as Array<{ id: string }>
    if (workspaces?.length > 0) {
      const id = workspaces[0]!.id
      await client.invoke('window:switchWorkspace', id).catch(() => {})
      return id
    }
  } catch {
    /* Fall through */
  }
  return undefined
}
