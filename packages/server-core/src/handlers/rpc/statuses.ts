import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { EntityHandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.statuses.LIST,
  RPC_CHANNELS.statuses.GET,
  RPC_CHANNELS.statuses.CREATE,
  RPC_CHANNELS.statuses.UPDATE,
  RPC_CHANNELS.statuses.DELETE,
  RPC_CHANNELS.statuses.REORDER,
] as const

/** Throw an error with a specific envelope code (propagated by WsRpcServer). */
function validationError(message: string): never {
  const err = new Error(message)
  ;(err as { code?: string }).code = 'VALIDATION_ERROR'
  throw err
}

function notFound(message: string): never {
  const err = new Error(message)
  ;(err as { code?: string }).code = 'NOT_FOUND'
  throw err
}

export function registerStatusesHandlers(server: RpcServer, _deps: EntityHandlerDeps): void {
  // List all statuses for a workspace
  server.handle(RPC_CHANNELS.statuses.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { listStatuses } = await import('@craft-agent/shared/statuses')
    return listStatuses(workspace.rootPath)
  })

  // Get a single status by ID
  server.handle(RPC_CHANNELS.statuses.GET, async (_ctx, workspaceId: string, statusId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { getStatus } = await import('@craft-agent/shared/statuses')
    const status = getStatus(workspace.rootPath, statusId)
    if (!status) notFound(`Status '${statusId}' not found`)
    return status
  })

  // Create a new status (schema-validated)
  server.handle(RPC_CHANNELS.statuses.CREATE, async (_ctx, workspaceId: string, input: unknown) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { createStatus, CreateStatusInputSchema } = await import('@craft-agent/shared/statuses')
    const parsed = CreateStatusInputSchema.safeParse(input)
    if (!parsed.success) {
      validationError(`Invalid status input: ${parsed.error.issues.map(i => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ')}`)
    }

    try {
      return createStatus(workspace.rootPath, parsed.data)
    } catch (e) {
      validationError(e instanceof Error ? e.message : String(e))
    }
  })

  // Update a status (schema-validated)
  server.handle(RPC_CHANNELS.statuses.UPDATE, async (_ctx, workspaceId: string, statusId: string, input: unknown) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { updateStatus, UpdateStatusInputSchema } = await import('@craft-agent/shared/statuses')
    const parsed = UpdateStatusInputSchema.safeParse(input)
    if (!parsed.success) {
      validationError(`Invalid status input: ${parsed.error.issues.map(i => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ')}`)
    }

    try {
      return updateStatus(workspace.rootPath, statusId, parsed.data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('not found')) notFound(msg)
      validationError(msg)
    }
  })

  // Delete a status (fixed/default statuses are protected)
  server.handle(RPC_CHANNELS.statuses.DELETE, async (_ctx, workspaceId: string, statusId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteStatus } = await import('@craft-agent/shared/statuses')
    try {
      return deleteStatus(workspace.rootPath, statusId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('not found')) notFound(msg)
      validationError(msg)
    }
  })

  // Reorder statuses (drag-and-drop). Receives new ordered array of status IDs.
  // Config watcher will detect the file change and broadcast STATUSES_CHANGED.
  server.handle(RPC_CHANNELS.statuses.REORDER, async (_ctx, workspaceId: string, orderedIds: unknown) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { reorderStatuses, ReorderStatusesInputSchema } = await import('@craft-agent/shared/statuses')
    const parsed = ReorderStatusesInputSchema.safeParse(orderedIds)
    if (!parsed.success) {
      validationError(`Invalid orderedIds: expected array of non-empty strings`)
    }

    try {
      reorderStatuses(workspace.rootPath, parsed.data)
    } catch (e) {
      validationError(e instanceof Error ? e.message : String(e))
    }
  })
}
