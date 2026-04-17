/**
 * Transport-agnostic RPC dispatcher facade.
 *
 * The dispatcher is the seam that lets `register*Handlers` functions wire
 * channels onto either a real WS transport or an in-process call site
 * without forking the handler implementation.
 *
 * Method naming follows the existing WS transport (`push`, `invokeClient`)
 * so that `RpcServer` is a structural superset of `RpcDispatcher` and no
 * handler call sites need renaming. In transports without subscribers
 * (e.g. embedded in-process), `push` must be a safe no-op.
 */

import type { PushTarget } from '@craft-agent/shared/protocol'

export interface RequestContext {
  clientId: string
  workspaceId: string | null
  webContentsId: number | null
}

export type HandlerFn = (ctx: RequestContext, ...args: any[]) => Promise<any> | any

export interface RpcDispatcher {
  /** Register a request handler for a channel. Throws on duplicate. */
  handle(channel: string, handler: HandlerFn): void
  /**
   * Emit an event to subscribers matching the push target. In transports
   * without live subscribers (e.g. embedded one-shot mode), this is a
   * safe no-op; in WS mode it fans out to matching connected clients.
   */
  push(channel: string, target: PushTarget, ...args: any[]): void
  /**
   * Reverse RPC into a connected client (e.g. capability invocations such
   * as opening an external URL). Optional — embedded transports have no
   * clients to invoke; callers must guard with `?.`.
   */
  invokeClient?(clientId: string, channel: string, ...args: any[]): Promise<any>
  /** Optional — WS transport routes by workspace; embedded transports may omit. */
  updateClientWorkspace?(clientId: string, workspaceId: string): void
}
