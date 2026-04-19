/**
 * Wire protocol types for the DataPilot RPC WebSocket layer.
 *
 * Vendored from `@craft-agent/shared/protocol/types.ts` so this package can be
 * published standalone. Keep these definitions byte-compatible with the server
 * (see `packages/shared/src/protocol/types.ts`); if the server bumps
 * `PROTOCOL_VERSION`, bump it here too.
 */

export type MessageType =
  | 'handshake'
  | 'handshake_ack'
  | 'request'
  | 'response'
  | 'event'
  | 'error'
  | 'sequence_ack'

export interface MessageEnvelope {
  id: string
  type: MessageType
  channel?: string
  args?: unknown[]
  result?: unknown
  error?: WireError
  protocolVersion?: string
  workspaceId?: string
  token?: string
  clientId?: string
  serverId?: string
  webContentsId?: number
  clientCapabilities?: string[]
  registeredChannels?: string[]
  seq?: number
  lastSeq?: number
  reconnectClientId?: string
  reconnected?: boolean
  stale?: boolean
  serverVersion?: string
}

export interface WireError {
  code: string
  message: string
  data?: unknown
}

export const PROTOCOL_VERSION = '1.0'
