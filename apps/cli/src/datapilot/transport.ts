/**
 * Transport layer for the unified `datapilot` CLI — a single WebSocket
 * connection to a running server.
 *
 * URL resolution order:
 *   1. --url flag
 *   2. $DATAPILOT_SERVER_URL env var
 *   3. discovery file at ~/.datapilot/.server.endpoint
 *   4. default ws://127.0.0.1:9100
 *
 * Token resolution mirrors the URL: --token, env, discovery file, then unset.
 *
 * If the connection fails, surface a clear error and exit — never silently
 * spawn a server.
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

/**
 * Connection metadata surfaced to entity commands so agents can introspect
 * the resolved transport without inspecting env vars or the discovery file
 * directly. Today only `workspace get` includes this in its response.
 *
 * `sameMachine` is a heuristic: loopback host → server is on this machine, so
 * agents may pass local absolute paths to session/batch. Anything else is
 * treated as remote (no false positives — false negatives are acceptable).
 */
export interface ConnectionInfo {
  url: string
  host: string
  sameMachine: boolean
  urlSource: ResolvedEndpoint['source']
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0'])

function extractHost(url: string): string {
  try {
    const host = new URL(url).hostname
    // IPv6 hostnames come back wrapped in `[...]` from WHATWG URL; strip so
    // callers can compare against bare addresses like `::1`.
    return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  } catch {
    return ''
  }
}

export function describeConnection(endpoint: ResolvedEndpoint): ConnectionInfo {
  const host = extractHost(endpoint.url)
  return {
    url: endpoint.url,
    host,
    sameMachine: LOOPBACK_HOSTS.has(host),
    urlSource: endpoint.source,
  }
}

export class ConnectionError extends Error {
  readonly url: string
  readonly source: ResolvedEndpoint['source']
  constructor(url: string, source: ResolvedEndpoint['source'], cause: string) {
    super(
      `no server detected at ${url} (${cause}); ` +
      `point at a running server with --url or $DATAPILOT_SERVER_URL`,
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

export interface WorkspaceResolution {
  id: string
  /** Where the workspace selection came from. `fallback` means the caller did
   * not specify one and the server's first workspace was used. */
  source: 'flag' | 'env' | 'fallback'
  /** Fallback happened in a multi-workspace setup — the picked id may not be
   * what the caller expected. Always false for `flag`/`env`, and for
   * `fallback` when the server only has one workspace (no ambiguity). */
  ambiguous: boolean
}

/**
 * Resolve a workspace ID for entity commands that require one.
 *
 * Order: explicit --workspace flag → $DATAPILOT_WORKSPACE env var → first
 * workspace returned by the server. Accepts an id, slug, or name; non-id
 * values are resolved against the server's workspace list. Returns undefined
 * if no workspaces exist (caller decides whether to fail).
 *
 * Side effect: binds the client to the resolved workspace via
 * window:switchWorkspace so push events are routed to us.
 */
export async function resolveWorkspaceId(
  client: CliRpcClient,
  explicit?: string,
): Promise<WorkspaceResolution | undefined> {
  let workspaces: Array<{ id: string; slug?: string; name?: string }> | undefined
  try {
    workspaces = (await client.invoke('workspaces:get')) as typeof workspaces
  } catch {
    /* Fall through */
  }

  if (explicit) {
    const match = workspaces?.find(
      w => w.id === explicit || w.slug === explicit || w.name === explicit,
    )
    const resolved = match?.id ?? explicit
    await client.invoke('window:switchWorkspace', resolved).catch(() => {})
    return { id: resolved, source: 'flag', ambiguous: false }
  }

  const fromEnv = process.env.DATAPILOT_WORKSPACE
  if (fromEnv && fromEnv.length > 0) {
    const match = workspaces?.find(
      w => w.id === fromEnv || w.slug === fromEnv || w.name === fromEnv,
    )
    const resolved = match?.id ?? fromEnv
    await client.invoke('window:switchWorkspace', resolved).catch(() => {})
    return { id: resolved, source: 'env', ambiguous: false }
  }

  if (workspaces && workspaces.length > 0) {
    const id = workspaces[0]!.id
    await client.invoke('window:switchWorkspace', id).catch(() => {})
    return { id, source: 'fallback', ambiguous: workspaces.length > 1 }
  }
  return undefined
}
