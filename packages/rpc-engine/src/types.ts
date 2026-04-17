/**
 * Transport-agnostic RPC dispatcher facade.
 *
 * Decouples `register*Handlers` functions from the concrete WS transport
 * so handler files don't import `RpcServer` just to call `handle` / `push`.
 *
 * Method naming follows the existing WS transport (`push`, `invokeClient`)
 * so that `RpcServer` is a structural superset of `RpcDispatcher` and no
 * handler call sites need renaming.
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
  /** Emit an event to subscribers matching the push target. */
  push(channel: string, target: PushTarget, ...args: any[]): void
  /**
   * Reverse RPC into a connected client (e.g. capability invocations such
   * as opening an external URL). Optional so that implementations without
   * a reverse channel don't have to stub it; callers guard with `?.`.
   */
  invokeClient?(clientId: string, channel: string, ...args: any[]): Promise<any>
  /** Optional — update a client's workspace scope for push routing. */
  updateClientWorkspace?(clientId: string, workspaceId: string): void
}
