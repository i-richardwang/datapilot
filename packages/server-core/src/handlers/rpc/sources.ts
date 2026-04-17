import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { loadWorkspaceSources } from '@craft-agent/shared/sources'
import { safeJsonParse } from '@craft-agent/shared/utils/files'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import type { RpcDispatcher } from '@craft-agent/rpc-engine'
import type { EntityHandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.sources.GET,
  RPC_CHANNELS.sources.CREATE,
  RPC_CHANNELS.sources.UPDATE,
  RPC_CHANNELS.sources.DELETE,
  RPC_CHANNELS.sources.VALIDATE,
  RPC_CHANNELS.sources.TEST,
  RPC_CHANNELS.sources.INIT_GUIDE,
  RPC_CHANNELS.sources.INIT_PERMISSIONS,
  RPC_CHANNELS.sources.AUTH_HELP,
  RPC_CHANNELS.sources.START_OAUTH,
  RPC_CHANNELS.sources.SAVE_CREDENTIALS,
  RPC_CHANNELS.sources.GET_PERMISSIONS,
  RPC_CHANNELS.workspace.GET_PERMISSIONS,
  RPC_CHANNELS.permissions.GET_DEFAULTS,
  RPC_CHANNELS.sources.GET_MCP_TOOLS,
] as const

export function registerSourcesHandlers(server: RpcDispatcher, deps: EntityHandlerDeps): void {
  const log = deps.platform.logger

  // Get all sources for a workspace
  server.handle(RPC_CHANNELS.sources.GET, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      log.error(`SOURCES_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    return loadWorkspaceSources(workspace.rootPath)
  })

  // Create a new source
  server.handle(RPC_CHANNELS.sources.CREATE, async (_ctx, workspaceId: string, config: Partial<import('@craft-agent/shared/sources').CreateSourceInput>) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { createSource } = await import('@craft-agent/shared/sources')
    return createSource(workspace.rootPath, {
      name: config.name || 'New Source',
      provider: config.provider || 'custom',
      type: config.type || 'mcp',
      enabled: config.enabled ?? true,
      mcp: config.mcp,
      api: config.api,
      local: config.local,
    })
  })

  // Update an existing source's config (merge-overwrites top-level fields, preserves identity)
  server.handle(RPC_CHANNELS.sources.UPDATE, async (_ctx, workspaceId: string, sourceSlug: string, patch: Partial<import('@craft-agent/shared/sources').FolderSourceConfig>) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { loadSourceConfig, saveSourceConfig } = await import('@craft-agent/shared/sources')

    const config = loadSourceConfig(workspace.rootPath, sourceSlug)
    if (!config) throw new Error(`Source not found: ${sourceSlug}`)

    // Shallow merge — preserve identity (id/slug) regardless of patch contents
    const updated = {
      ...config,
      ...patch,
      id: config.id,
      slug: config.slug,
      updatedAt: Date.now(),
    } as import('@craft-agent/shared/sources').FolderSourceConfig

    saveSourceConfig(workspace.rootPath, updated)
    return updated
  })

  // Validate a source config (config-only validation, not runtime auth check)
  server.handle(RPC_CHANNELS.sources.VALIDATE, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { loadSourceConfig } = await import('@craft-agent/shared/sources')

    const config = loadSourceConfig(workspace.rootPath, sourceSlug)
    if (!config) throw new Error(`Source not found: ${sourceSlug}`)

    const errors: string[] = []
    if (!config.name) errors.push('Missing name')
    if (!config.type) errors.push('Missing type')
    if (!config.provider) errors.push('Missing provider')

    if (config.type === 'mcp') {
      if (!config.mcp?.url && !config.mcp?.command) errors.push('MCP source requires either url or command')
    } else if (config.type === 'api') {
      if (!config.api?.baseUrl) errors.push('API source requires base-url')
      if (!config.api?.authType) errors.push('API source requires auth-type')
    } else if (config.type === 'local') {
      if (!config.local?.path) errors.push('Local source requires path')
    }

    return { valid: errors.length === 0, errors }
  })

  // Test a source — lightweight checks (config-only, no live network calls)
  server.handle(RPC_CHANNELS.sources.TEST, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { loadSourceConfig } = await import('@craft-agent/shared/sources')

    const config = loadSourceConfig(workspace.rootPath, sourceSlug)
    if (!config) throw new Error(`Source not found: ${sourceSlug}`)

    const checks: Array<{ check: string; passed: boolean; detail?: string }> = []
    checks.push({ check: 'config_exists', passed: true })
    checks.push({ check: 'type_valid', passed: ['mcp', 'api', 'local'].includes(config.type) })

    if (config.type === 'mcp') {
      const hasEndpoint = !!(config.mcp?.url || config.mcp?.command)
      checks.push({ check: 'mcp_endpoint', passed: hasEndpoint, detail: hasEndpoint ? (config.mcp?.url ?? config.mcp?.command) : 'No url or command configured' })
    } else if (config.type === 'api') {
      const hasBaseUrl = !!config.api?.baseUrl
      checks.push({ check: 'api_base_url', passed: hasBaseUrl, detail: config.api?.baseUrl })
      if (config.api?.baseUrl && !config.api.baseUrl.endsWith('/')) {
        checks.push({ check: 'api_trailing_slash', passed: false, detail: 'base-url should end with /' })
      }
    } else if (config.type === 'local') {
      const hasPath = !!config.local?.path
      checks.push({ check: 'local_path', passed: hasPath, detail: config.local?.path })
      if (config.local?.path) {
        const { existsSync } = await import('fs')
        checks.push({ check: 'local_path_exists', passed: existsSync(config.local.path) })
      }
    }

    return { slug: sourceSlug, passed: checks.every(c => c.passed), checks }
  })

  // Initialize a guide.md for a source from a built-in template
  server.handle(RPC_CHANNELS.sources.INIT_GUIDE, async (_ctx, workspaceId: string, sourceSlug: string, template?: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { loadSourceConfig, parseGuideMarkdown, saveSourceGuide } = await import('@craft-agent/shared/sources')

    const config = loadSourceConfig(workspace.rootPath, sourceSlug)
    if (!config) throw new Error(`Source not found: ${sourceSlug}`)

    const chosenTemplate = template ?? config.type ?? 'generic'
    const guideContent = generateGuideTemplate(config.name, config.provider, chosenTemplate)
    const guide = parseGuideMarkdown(guideContent)
    saveSourceGuide(workspace.rootPath, sourceSlug, guide)
    return { slug: sourceSlug, template: chosenTemplate, guide }
  })

  // Initialize permissions.json for a source (read-only or empty starter)
  server.handle(RPC_CHANNELS.sources.INIT_PERMISSIONS, async (_ctx, workspaceId: string, sourceSlug: string, mode?: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { sourceExists } = await import('@craft-agent/shared/sources')
    if (!sourceExists(workspace.rootPath, sourceSlug)) throw new Error(`Source not found: ${sourceSlug}`)

    const { saveSourcePermissions, getSourcePermissionsPath } = await import('@craft-agent/shared/agent/permissions-config')

    const resolvedMode = mode ?? 'read-only'
    const permissions = resolvedMode === 'read-only'
      ? {
          allowedMcpPatterns: [
            { pattern: 'list', comment: 'List operations' },
            { pattern: 'get', comment: 'Get operations' },
            { pattern: 'search', comment: 'Search operations' },
            { pattern: 'read', comment: 'Read operations' },
          ],
        }
      : {}

    saveSourcePermissions(workspace.rootPath, sourceSlug, permissions)
    return { slug: sourceSlug, mode: resolvedMode, path: getSourcePermissionsPath(workspace.rootPath, sourceSlug) }
  })

  // Recommend an auth flow for a source based on its config
  server.handle(RPC_CHANNELS.sources.AUTH_HELP, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { loadSourceConfig } = await import('@craft-agent/shared/sources')

    const config = loadSourceConfig(workspace.rootPath, sourceSlug)
    if (!config) throw new Error(`Source not found: ${sourceSlug}`)

    let recommendation: Record<string, unknown>
    if (config.type === 'mcp') {
      if (config.mcp?.authType === 'oauth') {
        recommendation = {
          method: 'oauth',
          tool: 'source_oauth_trigger',
          steps: [
            `Use the source_oauth_trigger tool with slug "${sourceSlug}"`,
            'Complete the OAuth flow in the browser',
            'The source will be marked as authenticated automatically',
          ],
        }
      } else if (config.mcp?.authType === 'bearer') {
        recommendation = {
          method: 'bearer',
          tool: 'source_credential_prompt',
          steps: [
            `Use the source_credential_prompt tool with slug "${sourceSlug}"`,
            'Provide the bearer token when prompted',
          ],
        }
      } else {
        recommendation = { method: 'none', note: 'This MCP source does not require authentication' }
      }
    } else if (config.type === 'api') {
      if (config.api?.authType === 'bearer' || config.api?.authType === 'header') {
        recommendation = {
          method: config.api.authType,
          tool: 'source_credential_prompt',
          steps: [
            `Use the source_credential_prompt tool with slug "${sourceSlug}"`,
            `Provide the ${config.api.authType === 'bearer' ? 'bearer token' : 'API key'} when prompted`,
          ],
        }
      } else if (config.api?.authType === 'oauth') {
        recommendation = {
          method: 'oauth',
          tool: 'source_oauth_trigger',
          steps: [
            `Use the source_oauth_trigger or source_google_oauth_trigger tool with slug "${sourceSlug}"`,
            'Complete the OAuth flow in the browser',
          ],
        }
      } else {
        recommendation = { method: config.api?.authType ?? 'none', note: 'No additional auth setup needed' }
      }
    } else {
      recommendation = { method: 'none', note: 'Local sources do not require authentication' }
    }

    return { slug: sourceSlug, type: config.type, ...recommendation }
  })

  // Delete a source
  server.handle(RPC_CHANNELS.sources.DELETE, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { deleteSource } = await import('@craft-agent/shared/sources')
    deleteSource(workspace.rootPath, sourceSlug)

    // Clean up stale slug from workspace default sources
    const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
    const config = loadWorkspaceConfig(workspace.rootPath)
    if (config?.defaults?.enabledSourceSlugs?.includes(sourceSlug)) {
      config.defaults.enabledSourceSlugs = config.defaults.enabledSourceSlugs.filter(s => s !== sourceSlug)
      saveWorkspaceConfig(workspace.rootPath, config)
    }
  })

  // Start OAuth flow for a source (DEPRECATED — use oauth:start + performOAuth client-side)
  // Kept for backward compatibility with old IPC preload; WS clients use performOAuth().
  server.handle(RPC_CHANNELS.sources.START_OAUTH, async () => {
    return {
      success: false,
      error: 'Deprecated: use the client-side performOAuth() flow (oauth:start + oauth:complete) instead',
    }
  })

  // Save credentials for a source (bearer token or API key)
  server.handle(RPC_CHANNELS.sources.SAVE_CREDENTIALS, async (_ctx, workspaceId: string, sourceSlug: string, credential: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)
    const { loadSource, getSourceCredentialManager } = await import('@craft-agent/shared/sources')

    const source = loadSource(workspace.rootPath, sourceSlug)
    if (!source) {
      throw new Error(`Source not found: ${sourceSlug}`)
    }

    // SourceCredentialManager handles credential type resolution
    const credManager = getSourceCredentialManager()
    await credManager.save(source, { value: credential })

    log.info(`Saved credentials for source: ${sourceSlug}`)
  })

  // Get permissions config for a source (raw format for UI display)
  server.handle(RPC_CHANNELS.sources.GET_PERMISSIONS, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return null

    const { existsSync, readFileSync } = await import('fs')
    const { getSourcePermissionsPath } = await import('@craft-agent/shared/agent')
    const path = getSourcePermissionsPath(workspace.rootPath, sourceSlug)

    if (!existsSync(path)) return null

    try {
      const content = readFileSync(path, 'utf-8')
      return safeJsonParse(content)
    } catch (error) {
      log.error('Error reading permissions config:', error)
      return null
    }
  })

  // Get permissions config for a workspace (raw format for UI display)
  server.handle(RPC_CHANNELS.workspace.GET_PERMISSIONS, async (_ctx, workspaceId: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return null

    const { existsSync, readFileSync } = await import('fs')
    const { getWorkspacePermissionsPath } = await import('@craft-agent/shared/agent')
    const path = getWorkspacePermissionsPath(workspace.rootPath)

    if (!existsSync(path)) return null

    try {
      const content = readFileSync(path, 'utf-8')
      return safeJsonParse(content)
    } catch (error) {
      log.error('Error reading workspace permissions config:', error)
      return null
    }
  })

  // Get default permissions from ~/.datapilot/permissions/default.json
  server.handle(RPC_CHANNELS.permissions.GET_DEFAULTS, async () => {
    const { existsSync, readFileSync } = await import('fs')
    const { getAppPermissionsDir } = await import('@craft-agent/shared/agent')
    const { join } = await import('path')

    const defaultPath = join(getAppPermissionsDir(), 'default.json')
    if (!existsSync(defaultPath)) return { config: null, path: defaultPath }

    try {
      const content = readFileSync(defaultPath, 'utf-8')
      return { config: safeJsonParse(content), path: defaultPath }
    } catch (error) {
      log.error('Error reading default permissions config:', error)
      return { config: null, path: defaultPath }
    }
  })

  // Get MCP tools for a source with permission status
  server.handle(RPC_CHANNELS.sources.GET_MCP_TOOLS, async (_ctx, workspaceId: string, sourceSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) return { success: false, error: 'Workspace not found' }

    try {
      const sources = await loadWorkspaceSources(workspace.rootPath)
      const source = sources.find(s => s.config.slug === sourceSlug)
      if (!source) return { success: false, error: 'Source not found' }
      if (source.config.type !== 'mcp') return { success: false, error: 'Source is not an MCP server' }
      if (!source.config.mcp) return { success: false, error: 'MCP config not found' }

      if (source.config.connectionStatus === 'needs_auth') {
        return { success: false, error: 'Source requires authentication' }
      }
      if (source.config.connectionStatus === 'failed') {
        return { success: false, error: source.config.connectionError || 'Connection failed' }
      }
      if (source.config.connectionStatus === 'untested') {
        return { success: false, error: 'Source has not been tested yet' }
      }

      const { CraftMcpClient } = await import('@craft-agent/shared/mcp')
      let client: InstanceType<typeof CraftMcpClient>

      if (source.config.mcp.transport === 'stdio') {
        if (!source.config.mcp.command) {
          return { success: false, error: 'Stdio MCP source is missing required "command" field' }
        }
        log.info(`Fetching MCP tools via stdio: ${source.config.mcp.command}`)
        client = new CraftMcpClient({
          transport: 'stdio',
          command: source.config.mcp.command,
          args: source.config.mcp.args,
          env: source.config.mcp.env,
        })
      } else {
        if (!source.config.mcp.url) {
          return { success: false, error: 'MCP source URL is required for HTTP/SSE transport' }
        }

        let accessToken: string | undefined
        if (source.config.mcp.authType === 'oauth' || source.config.mcp.authType === 'bearer') {
          const credentialManager = getCredentialManager()
          const credentialId = source.config.mcp.authType === 'oauth'
            ? { type: 'source_oauth' as const, workspaceId: source.workspaceId, sourceId: sourceSlug }
            : { type: 'source_bearer' as const, workspaceId: source.workspaceId, sourceId: sourceSlug }
          const credential = await credentialManager.get(credentialId)
          accessToken = credential?.value
        }

        log.info(`Fetching MCP tools from ${source.config.mcp.url}`)
        client = new CraftMcpClient({
          transport: 'http',
          url: source.config.mcp.url,
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        })
      }

      const tools = await client.listTools()
      await client.close()

      const { loadSourcePermissionsConfig, permissionsConfigCache } = await import('@craft-agent/shared/agent')
      const permissionsConfig = loadSourcePermissionsConfig(workspace.rootPath, sourceSlug)

      const mergedConfig = permissionsConfigCache.getMergedConfig({
        workspaceRootPath: workspace.rootPath,
        activeSourceSlugs: [sourceSlug],
      })

      const toolsWithPermission = tools.map(tool => {
        const allowed = mergedConfig.readOnlyMcpPatterns.some((pattern: RegExp) => pattern.test(tool.name))
        return {
          name: tool.name,
          description: tool.description,
          allowed,
        }
      })

      return { success: true, tools: toolsWithPermission }
    } catch (error) {
      log.error('Failed to get MCP tools:', error)
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch tools'
      if (errorMessage.includes('404')) {
        return { success: false, error: 'MCP server endpoint not found. The server may be offline or the URL may be incorrect.' }
      }
      if (errorMessage.includes('401') || errorMessage.includes('403')) {
        return { success: false, error: 'Authentication failed. Please re-authenticate with this source.' }
      }
      return { success: false, error: errorMessage }
    }
  })
}

function generateGuideTemplate(name: string, provider: string, template: string): string {
  const sections: string[] = [`# ${name} Source Guide\n`]

  switch (template) {
    case 'mcp':
      sections.push('## Scope\nThis source provides access via MCP (Model Context Protocol).\n')
      sections.push('## Guidelines\n- Use list/get operations for read access\n- Confirm with the user before write operations\n')
      sections.push(`## Context\nProvider: ${provider}\n`)
      break
    case 'api':
      sections.push('## Scope\nThis source provides access via REST API.\n')
      sections.push('## Guidelines\n- Prefer GET endpoints for data retrieval\n- Rate-limit awareness: space out requests\n')
      sections.push('## API Notes\n- Check authentication status before making requests\n')
      break
    case 'local':
      sections.push('## Scope\nThis source provides access to local filesystem data.\n')
      sections.push('## Guidelines\n- Treat data as read-only unless explicitly asked\n- Respect file permissions\n')
      break
    default:
      sections.push(`## Scope\nThis source connects to ${provider}.\n`)
      sections.push('## Guidelines\n- Follow the principle of least privilege\n- Confirm destructive operations with the user\n')
  }

  return sections.join('\n')
}
