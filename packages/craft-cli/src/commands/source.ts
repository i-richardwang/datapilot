/**
 * Source commands — 10 subcommands
 *
 * Storage: SQLite via @craft-agent/shared/sources
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ok, fail } from '../envelope.ts'
import { strFlag, boolFlag } from '../args.ts'
import { parseInput } from '../input.ts'
import {
  loadWorkspaceSources,
  loadSource,
  loadSourceConfig,
  saveSourceConfig,
  createSource,
  deleteSource,
  sourceExists,
  loadSourceGuide,
  saveSourceGuide,
  parseGuideMarkdown,
} from '@craft-agent/shared/sources/storage.db'
import type { CreateSourceInput, SourceType, McpSourceConfig, ApiSourceConfig, LocalSourceConfig, FolderSourceConfig } from '@craft-agent/shared/sources/types'

export async function routeSource(
  ws: string,
  action: string | undefined,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): Promise<void> {
  if (!action) fail('USAGE_ERROR', 'Missing action', 'craft-agent source <list|get|create|update|delete|validate|test|init-guide|init-permissions|auth-help>')

  switch (action) {
    case 'list': return cmdList(ws, flags)
    case 'get': return cmdGet(ws, positionals)
    case 'create': return await cmdCreate(ws, flags)
    case 'update': return cmdUpdate(ws, positionals, flags)
    case 'delete': return cmdDelete(ws, positionals)
    case 'validate': return cmdValidate(ws, positionals)
    case 'test': return cmdTest(ws, positionals)
    case 'init-guide': return cmdInitGuide(ws, positionals, flags)
    case 'init-permissions': return cmdInitPermissions(ws, positionals, flags)
    case 'auth-help': return cmdAuthHelp(ws, positionals)
    default:
      fail('USAGE_ERROR', `Unknown source action: ${action}`)
  }
}

// ─── list ────────────────────────────────────────────────────────────────────

function cmdList(ws: string, flags: Record<string, string | boolean | string[]>): void {
  const sources = loadWorkspaceSources(ws)
  const includeBuiltins = boolFlag(flags, 'include-builtins') ?? false
  const filtered = includeBuiltins ? sources : sources.filter(s => !s.isBuiltin)
  ok(filtered.map(s => s.config))
}

// ─── get ─────────────────────────────────────────────────────────────────────

function cmdGet(ws: string, positionals: string[]): void {
  const slug = positionals[0]
  if (!slug) fail('USAGE_ERROR', 'Missing source slug', 'craft-agent source get <slug>')

  const source = loadSource(ws, slug)
  if (!source) fail('NOT_FOUND', `Source '${slug}' not found`)
  ok({ config: source.config, guide: source.guide })
}

// ─── create ──────────────────────────────────────────────────────────────────

async function cmdCreate(
  ws: string,
  flags: Record<string, string | boolean | string[]>,
): Promise<void> {
  const input = parseInput(flags)

  const name = (input?.name as string) ?? strFlag(flags, 'name')
  if (!name) fail('USAGE_ERROR', 'Missing --name')

  const provider = (input?.provider as string) ?? strFlag(flags, 'provider')
  if (!provider) fail('USAGE_ERROR', 'Missing --provider')

  const type = ((input?.type as string) ?? strFlag(flags, 'type')) as SourceType | undefined
  if (!type || !['mcp', 'api', 'local'].includes(type)) {
    fail('USAGE_ERROR', 'Missing or invalid --type (mcp|api|local)')
  }

  const enabled = boolFlag(flags, 'enabled') ?? (input?.enabled as boolean | undefined)
  const icon = (input?.icon as string) ?? strFlag(flags, 'icon')

  const createInput: CreateSourceInput = { name, provider, type, enabled, icon }

  // Type-specific config from --json or flat flags
  if (type === 'mcp') {
    const mcp: McpSourceConfig = (input?.mcp as McpSourceConfig) ?? {}
    const url = strFlag(flags, 'url')
    if (url) mcp.url = url
    const transport = strFlag(flags, 'transport')
    if (transport) mcp.transport = transport as McpSourceConfig['transport']
    const authType = strFlag(flags, 'auth-type')
    if (authType) mcp.authType = authType as McpSourceConfig['authType']
    if (Object.keys(mcp).length > 0) createInput.mcp = mcp
  } else if (type === 'api') {
    const api: ApiSourceConfig = (input?.api as ApiSourceConfig) ?? {} as ApiSourceConfig
    const baseUrl = strFlag(flags, 'base-url')
    if (baseUrl) api.baseUrl = baseUrl
    const authType = strFlag(flags, 'auth-type')
    if (authType) api.authType = authType as ApiSourceConfig['authType']
    if (Object.keys(api).length > 0) createInput.api = api
  } else if (type === 'local') {
    const local: LocalSourceConfig = (input?.local as LocalSourceConfig) ?? {} as LocalSourceConfig
    const path = strFlag(flags, 'path')
    if (path) local.path = path
    if (Object.keys(local).length > 0) createInput.local = local
  }

  try {
    const config = await createSource(ws, createInput)
    ok(config)
  } catch (e) {
    fail('VALIDATION_ERROR', (e as Error).message)
  }
}

// ─── update ──────────────────────────────────────────────────────────────────

function cmdUpdate(
  ws: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const slug = positionals[0]
  if (!slug) fail('USAGE_ERROR', 'Missing source slug', 'craft-agent source update <slug> --json \'{...}\'')

  const config = loadSourceConfig(ws, slug)
  if (!config) fail('NOT_FOUND', `Source '${slug}' not found`)

  const input = parseInput(flags)
  if (!input) fail('USAGE_ERROR', 'Missing --json or --stdin input for update')

  // Merge input into config
  const updated = { ...config, ...input, updatedAt: Date.now() } as FolderSourceConfig
  // Preserve identity fields
  updated.id = config.id
  updated.slug = config.slug

  saveSourceConfig(ws, updated)
  ok(updated)
}

// ─── delete ──────────────────────────────────────────────────────────────────

function cmdDelete(ws: string, positionals: string[]): void {
  const slug = positionals[0]
  if (!slug) fail('USAGE_ERROR', 'Missing source slug', 'craft-agent source delete <slug>')

  if (!sourceExists(ws, slug)) fail('NOT_FOUND', `Source '${slug}' not found`)

  deleteSource(ws, slug)
  ok({ deleted: slug })
}

// ─── validate ────────────────────────────────────────────────────────────────

function cmdValidate(ws: string, positionals: string[]): void {
  const slug = positionals[0]
  if (!slug) fail('USAGE_ERROR', 'Missing source slug', 'craft-agent source validate <slug>')

  const config = loadSourceConfig(ws, slug)
  if (!config) fail('NOT_FOUND', `Source '${slug}' not found`)

  const errors: string[] = []

  // Required fields
  if (!config.name) errors.push('Missing name')
  if (!config.type) errors.push('Missing type')
  if (!config.provider) errors.push('Missing provider')

  // Type-specific validation
  if (config.type === 'mcp') {
    if (!config.mcp?.url && !config.mcp?.command) {
      errors.push('MCP source requires either url or command')
    }
  } else if (config.type === 'api') {
    if (!config.api?.baseUrl) errors.push('API source requires base-url')
    if (!config.api?.authType) errors.push('API source requires auth-type')
  } else if (config.type === 'local') {
    if (!config.local?.path) errors.push('Local source requires path')
  }

  ok({ valid: errors.length === 0, errors })
}

// ─── test ────────────────────────────────────────────────────────────────────

function cmdTest(ws: string, positionals: string[]): void {
  const slug = positionals[0]
  if (!slug) fail('USAGE_ERROR', 'Missing source slug', 'craft-agent source test <slug>')

  const config = loadSourceConfig(ws, slug)
  if (!config) fail('NOT_FOUND', `Source '${slug}' not found`)

  // Lightweight CLI validation (not runtime auth test)
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
      checks.push({ check: 'local_path_exists', passed: existsSync(config.local.path) })
    }
  }

  const allPassed = checks.every(c => c.passed)
  ok({ slug, passed: allPassed, checks })
}

// ─── init-guide ──────────────────────────────────────────────────────────────

function cmdInitGuide(
  ws: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const slug = positionals[0]
  if (!slug) fail('USAGE_ERROR', 'Missing source slug', 'craft-agent source init-guide <slug>')

  const config = loadSourceConfig(ws, slug)
  if (!config) fail('NOT_FOUND', `Source '${slug}' not found`)

  const template = strFlag(flags, 'template') ?? config.type ?? 'generic'

  const guideContent = generateGuideTemplate(config.name, config.provider, template)
  const guide = parseGuideMarkdown(guideContent)
  saveSourceGuide(ws, slug, guide)

  ok({ slug, template, guide })
}

// ─── init-permissions ────────────────────────────────────────────────────────

function cmdInitPermissions(
  ws: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const slug = positionals[0]
  if (!slug) fail('USAGE_ERROR', 'Missing source slug', 'craft-agent source init-permissions <slug>')

  if (!sourceExists(ws, slug)) fail('NOT_FOUND', `Source '${slug}' not found`)

  const mode = strFlag(flags, 'mode') ?? 'read-only'

  // Import and use permissions-config
  const {
    saveSourcePermissions,
    getSourcePermissionsPath,
  } = require('@craft-agent/shared/agent/permissions-config') as typeof import('@craft-agent/shared/agent/permissions-config')

  const permissions = mode === 'read-only'
    ? {
        allowedMcpPatterns: [
          { pattern: 'list', comment: 'List operations' },
          { pattern: 'get', comment: 'Get operations' },
          { pattern: 'search', comment: 'Search operations' },
          { pattern: 'read', comment: 'Read operations' },
        ],
      }
    : {}

  saveSourcePermissions(ws, slug, permissions)
  ok({ slug, mode, path: getSourcePermissionsPath(ws, slug) })
}

// ─── auth-help ───────────────────────────────────────────────────────────────

function cmdAuthHelp(ws: string, positionals: string[]): void {
  const slug = positionals[0]
  if (!slug) fail('USAGE_ERROR', 'Missing source slug', 'craft-agent source auth-help <slug>')

  const config = loadSourceConfig(ws, slug)
  if (!config) fail('NOT_FOUND', `Source '${slug}' not found`)

  let recommendation: Record<string, unknown>

  if (config.type === 'mcp') {
    if (config.mcp?.authType === 'oauth') {
      recommendation = {
        method: 'oauth',
        tool: 'source_oauth_trigger',
        steps: [
          `Use the source_oauth_trigger tool with slug "${slug}"`,
          'Complete the OAuth flow in the browser',
          'The source will be marked as authenticated automatically',
        ],
      }
    } else if (config.mcp?.authType === 'bearer') {
      recommendation = {
        method: 'bearer',
        tool: 'source_credential_prompt',
        steps: [
          `Use the source_credential_prompt tool with slug "${slug}"`,
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
          `Use the source_credential_prompt tool with slug "${slug}"`,
          `Provide the ${config.api.authType === 'bearer' ? 'bearer token' : 'API key'} when prompted`,
        ],
      }
    } else if (config.api?.authType === 'oauth') {
      recommendation = {
        method: 'oauth',
        tool: 'source_oauth_trigger',
        steps: [
          `Use the source_oauth_trigger or source_google_oauth_trigger tool with slug "${slug}"`,
          'Complete the OAuth flow in the browser',
        ],
      }
    } else {
      recommendation = { method: config.api?.authType ?? 'none', note: 'No additional auth setup needed' }
    }
  } else {
    recommendation = { method: 'none', note: 'Local sources do not require authentication' }
  }

  ok({ slug, type: config.type, ...recommendation })
}

// ─── helpers ─────────────────────────────────────────────────────────────────

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
