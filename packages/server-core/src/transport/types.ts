/**
 * Transport-layer interfaces for the WS-based RPC.
 *
 * `RpcServer` extends the transport-agnostic `RpcDispatcher` from
 * `@craft-agent/rpc-engine` and adds the WS-specific guarantee that
 * `invokeClient` is available (the WS transport always has a client to
 * call back into; embedded transports do not).
 */

import type { PushTarget } from '@craft-agent/shared/protocol'
import type { RpcDispatcher } from '@craft-agent/rpc-engine'

export type { RequestContext, HandlerFn } from '@craft-agent/rpc-engine'

export interface RpcServer extends RpcDispatcher {
  invokeClient(clientId: string, channel: string, ...args: any[]): Promise<any>
  updateClientWorkspace?(clientId: string, workspaceId: string): void
}

export interface RpcClient {
  invoke(channel: string, ...args: any[]): Promise<any>
  on(channel: string, callback: (...args: any[]) => void): () => void
  handleCapability(channel: string, handler: (...args: any[]) => Promise<any> | any): void
}

export type EventSink = (channel: string, target: PushTarget, ...args: any[]) => void
