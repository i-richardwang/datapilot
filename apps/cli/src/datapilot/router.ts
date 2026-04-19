/**
 * Entity router — maps `<entity> <action>` to the matching handler module.
 *
 * Each entity module exports a `route(ctx, action, positionals, flags)`
 * function. The router itself is data-only: just a table of available
 * entities. Entry-point code does the dispatch so it can interleave
 * connection + workspace setup as needed.
 */

import type { CliRpcClient } from '../client.ts'

export const ENTITIES = [
  'label',
  'source',
  'automation',
  'skill',
  'batch',
  'session',
  'workspace',
] as const

export type Entity = typeof ENTITIES[number]

export function isEntity(name: string | undefined): name is Entity {
  return ENTITIES.includes(name as Entity)
}

/** Per-command runtime context shared between routers. */
export interface RouteCtx {
  /** Lazily-connected client. Resolved on first call. */
  getClient(): Promise<CliRpcClient>
  /** Workspace ID resolution (lazy). */
  getWorkspace(): Promise<string | undefined>
  /** Drop the connection — caller's responsibility for long-running cmds. */
  destroyClient(): void
  /** Global flags as parsed at the entry. */
  global: {
    url?: string
    token?: string
    workspace?: string
    tlsCa?: string
    timeout?: number
    json?: boolean
  }
}
