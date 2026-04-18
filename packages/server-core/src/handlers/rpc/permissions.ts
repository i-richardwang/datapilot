import { existsSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  loadRawWorkspacePermissions,
  loadRawSourcePermissions,
  saveWorkspacePermissions,
  saveSourcePermissions,
  getWorkspacePermissionsPath,
  getSourcePermissionsPath,
  validatePermissionsConfig,
  type PermissionsConfigFile,
} from '@craft-agent/shared/agent'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { EntityHandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.permissions.LIST,
  RPC_CHANNELS.permissions.GET,
  RPC_CHANNELS.permissions.SET,
  RPC_CHANNELS.permissions.ADD_MCP_PATTERN,
  RPC_CHANNELS.permissions.ADD_API_ENDPOINT,
  RPC_CHANNELS.permissions.ADD_BASH_PATTERN,
  RPC_CHANNELS.permissions.ADD_WRITE_PATH,
  RPC_CHANNELS.permissions.REMOVE,
  RPC_CHANNELS.permissions.VALIDATE,
  RPC_CHANNELS.permissions.RESET,
] as const

type RemoveType = 'mcp' | 'api' | 'bash' | 'write-path' | 'blocked'

const REMOVE_TYPE_TO_FIELD: Record<RemoveType, keyof PermissionsConfigFile> = {
  'mcp': 'allowedMcpPatterns',
  'api': 'allowedApiEndpoints',
  'bash': 'allowedBashPatterns',
  'write-path': 'allowedWritePaths',
  'blocked': 'blockedTools',
}

function loadPermissionsFor(workspaceRoot: string, sourceSlug?: string): PermissionsConfigFile {
  const raw = sourceSlug
    ? loadRawSourcePermissions(workspaceRoot, sourceSlug)
    : loadRawWorkspacePermissions(workspaceRoot)
  return raw ?? {}
}

function savePermissionsFor(workspaceRoot: string, sourceSlug: string | undefined, config: PermissionsConfigFile): void {
  if (sourceSlug) {
    saveSourcePermissions(workspaceRoot, sourceSlug, config)
  } else {
    saveWorkspacePermissions(workspaceRoot, config)
  }
}

function pathFor(workspaceRoot: string, sourceSlug?: string): string {
  return sourceSlug
    ? getSourcePermissionsPath(workspaceRoot, sourceSlug)
    : getWorkspacePermissionsPath(workspaceRoot)
}

export function registerPermissionsHandlers(server: RpcServer, _deps: EntityHandlerDeps): void {
  // List workspace + per-source permission files (with existence flags)
  server.handle(RPC_CHANNELS.permissions.LIST, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const results: Array<{ scope: string; slug?: string; path: string; exists: boolean }> = []
    const wsPath = getWorkspacePermissionsPath(workspace.rootPath)
    results.push({ scope: 'workspace', path: wsPath, exists: existsSync(wsPath) })

    const sourcesDir = join(workspace.rootPath, 'sources')
    if (existsSync(sourcesDir)) {
      try {
        const entries = readdirSync(sourcesDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const srcPath = getSourcePermissionsPath(workspace.rootPath, entry.name)
          results.push({ scope: 'source', slug: entry.name, path: srcPath, exists: existsSync(srcPath) })
        }
      } catch {
        // Ignore errors reading sources directory
      }
    }
    return results
  })

  // Get raw permissions config for workspace or a single source
  server.handle(RPC_CHANNELS.permissions.GET, async (_ctx, workspaceId: string, sourceSlug?: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const config = loadPermissionsFor(workspace.rootPath, sourceSlug)
    return { scope: sourceSlug ? 'source' : 'workspace', source: sourceSlug ?? null, config }
  })

  // Replace the entire permissions file (validates first)
  server.handle(RPC_CHANNELS.permissions.SET, async (_ctx, workspaceId: string, sourceSlug: string | undefined, config: PermissionsConfigFile) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const errors = validatePermissionsConfig(config)
    if (errors.length > 0) throw new Error(`Invalid permissions config: ${errors.join(', ')}`)

    savePermissionsFor(workspace.rootPath, sourceSlug, config)
    return { scope: sourceSlug ? 'source' : 'workspace', source: sourceSlug ?? null, config }
  })

  // Add a pattern entry to a list field (mcp/bash/write-path share the same shape)
  function makeAddPatternHandler(field: 'allowedMcpPatterns' | 'allowedBashPatterns' | 'allowedWritePaths') {
    return async (_ctx: unknown, workspaceId: string, sourceSlug: string | undefined, pattern: string, comment?: string) => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error('Workspace not found')

      const config = loadPermissionsFor(workspace.rootPath, sourceSlug)
      const list = (config[field] as Array<string | { pattern: string; comment?: string }> | undefined) ?? []
      const entry = comment ? { pattern, comment } : pattern
      list.push(entry)
      ;(config as Record<string, unknown>)[field] = list

      savePermissionsFor(workspace.rootPath, sourceSlug, config)
      return { added: entry, field, total: list.length }
    }
  }

  server.handle(RPC_CHANNELS.permissions.ADD_MCP_PATTERN, makeAddPatternHandler('allowedMcpPatterns'))
  server.handle(RPC_CHANNELS.permissions.ADD_BASH_PATTERN, makeAddPatternHandler('allowedBashPatterns'))
  server.handle(RPC_CHANNELS.permissions.ADD_WRITE_PATH, makeAddPatternHandler('allowedWritePaths'))

  // Add an API endpoint entry { method, path, comment? }
  server.handle(
    RPC_CHANNELS.permissions.ADD_API_ENDPOINT,
    async (_ctx, workspaceId: string, sourceSlug: string | undefined, method: string, path: string, comment?: string) => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error('Workspace not found')

      const config = loadPermissionsFor(workspace.rootPath, sourceSlug)
      if (!config.allowedApiEndpoints) config.allowedApiEndpoints = []

      const entry = {
        method: method.toUpperCase() as 'GET' | 'POST' | 'HEAD' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS',
        path,
        ...(comment ? { comment } : {}),
      }
      config.allowedApiEndpoints.push(entry)
      savePermissionsFor(workspace.rootPath, sourceSlug, config)
      return { added: entry, total: config.allowedApiEndpoints.length }
    }
  )

  // Remove an entry from a permission list by index
  server.handle(
    RPC_CHANNELS.permissions.REMOVE,
    async (_ctx, workspaceId: string, sourceSlug: string | undefined, type: RemoveType, index: number) => {
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) throw new Error('Workspace not found')

      const field = REMOVE_TYPE_TO_FIELD[type]
      if (!field) throw new Error(`Invalid type: ${type}. Valid: mcp, api, bash, write-path, blocked`)

      const config = loadPermissionsFor(workspace.rootPath, sourceSlug)
      const arr = config[field] as unknown[] | undefined
      if (!arr || index < 0 || index >= arr.length) {
        throw new Error(`Index ${index} out of range (${arr?.length ?? 0} entries in ${field})`)
      }
      const removed = arr.splice(index, 1)[0]
      savePermissionsFor(workspace.rootPath, sourceSlug, config)
      return { removed, field, remaining: arr.length }
    }
  )

  // Validate a single source's permissions, or workspace + all sources
  server.handle(RPC_CHANNELS.permissions.VALIDATE, async (_ctx, workspaceId: string, sourceSlug?: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    if (sourceSlug) {
      const config = loadPermissionsFor(workspace.rootPath, sourceSlug)
      const errors = validatePermissionsConfig(config)
      return { valid: errors.length === 0, scope: 'source' as const, source: sourceSlug, errors }
    }

    const results: Array<{ scope: 'workspace' | 'source'; source?: string; valid: boolean; errors: string[] }> = []
    const wsConfig = loadPermissionsFor(workspace.rootPath)
    const wsErrors = validatePermissionsConfig(wsConfig)
    results.push({ scope: 'workspace', valid: wsErrors.length === 0, errors: wsErrors })

    const sourcesDir = join(workspace.rootPath, 'sources')
    if (existsSync(sourcesDir)) {
      try {
        const entries = readdirSync(sourcesDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const srcPermPath = getSourcePermissionsPath(workspace.rootPath, entry.name)
          if (!existsSync(srcPermPath)) continue
          const srcConfig = loadPermissionsFor(workspace.rootPath, entry.name)
          const srcErrors = validatePermissionsConfig(srcConfig)
          results.push({ scope: 'source', source: entry.name, valid: srcErrors.length === 0, errors: srcErrors })
        }
      } catch {
        // Ignore errors
      }
    }

    return { valid: results.every(r => r.valid), results }
  })

  // Reset (delete) a permissions file
  server.handle(RPC_CHANNELS.permissions.RESET, async (_ctx, workspaceId: string, sourceSlug?: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const filePath = pathFor(workspace.rootPath, sourceSlug)
    if (!existsSync(filePath)) return { reset: false, path: filePath, note: 'No permissions file to reset' }
    unlinkSync(filePath)
    return { reset: true, path: filePath }
  })
}
