/**
 * Transport-layer interfaces for the WebSocket RPC server.
 */

import type { PushTarget } from '@craft-agent/shared/protocol'

export interface RequestContext {
  clientId: string
  workspaceId: string | null
  webContentsId: number | null
}

export type HandlerFn = (ctx: RequestContext, ...args: any[]) => Promise<any> | any

export interface RpcServer {
  /** Register a request handler for a channel. Throws on duplicate. */
  handle(channel: string, handler: HandlerFn): void
  /** Emit an event to subscribers matching the push target. */
  push(channel: string, target: PushTarget, ...args: any[]): void
  /**
   * Reverse RPC into a connected client (e.g. capability invocations such
   * as opening an external URL).
   */
  invokeClient(clientId: string, channel: string, ...args: any[]): Promise<any>
  /** Update a client's workspace scope for push routing. */
  updateClientWorkspace(clientId: string, workspaceId: string): void
}

export interface RpcClient {
  invoke(channel: string, ...args: any[]): Promise<any>
  on(channel: string, callback: (...args: any[]) => void): () => void
  handleCapability(channel: string, handler: (...args: any[]) => Promise<any> | any): void
}

export type EventSink = (channel: string, target: PushTarget, ...args: any[]) => void
