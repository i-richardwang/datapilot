/**
 * Type-safe push helper — constrains args against BroadcastEventMap at
 * compile time. Mirrors the existing `pushTyped` in server-core/transport
 * but is bound to RpcDispatcher so it works against any transport.
 */

import type { BroadcastEventMap, PushTarget } from '@craft-agent/shared/protocol'
import type { RpcDispatcher } from './types'

export function pushTyped<K extends keyof BroadcastEventMap & string>(
  dispatcher: RpcDispatcher,
  channel: K,
  target: PushTarget,
  ...args: BroadcastEventMap[K]
): void {
  dispatcher.push(channel, target, ...args)
}
