/**
 * Permission commands — 10 subcommands
 *
 * Storage: Filesystem JSON (permissions.json)
 */

import { existsSync, unlinkSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ok, fail, warn } from '../envelope.ts'
import { strFlag, intFlag } from '../args.ts'
import { parseInput } from '../input.ts'
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

export function routePermission(
  ws: string,
  action: string | undefined,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  if (!action) ok({
    usage: 'datapilot permission <action> [args] [--flags]',
    actions: ['list', 'get', 'set', 'add-mcp-pattern', 'add-api-endpoint', 'add-bash-pattern', 'add-write-path', 'remove', 'validate', 'reset'],
  })

  const sourceSlug = strFlag(flags, 'source')

  switch (action) {
    case 'list': return cmdList(ws)
    case 'get': return cmdGet(ws, sourceSlug)
    case 'set': return cmdSet(ws, sourceSlug, flags)
    case 'add-mcp-pattern': return cmdAddPattern(ws, sourceSlug, positionals, flags, 'allowedMcpPatterns')
    case 'add-api-endpoint': return cmdAddApiEndpoint(ws, sourceSlug, flags)
    case 'add-bash-pattern': return cmdAddPattern(ws, sourceSlug, positionals, flags, 'allowedBashPatterns')
    case 'add-write-path': return cmdAddPattern(ws, sourceSlug, positionals, flags, 'allowedWritePaths')
    case 'remove': return cmdRemove(ws, sourceSlug, positionals, flags)
    case 'validate': return cmdValidate(ws, sourceSlug)
    case 'reset': return cmdReset(ws, sourceSlug)
    default:
      fail('USAGE_ERROR', `Unknown permission action: ${action}`)
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function loadPermissions(ws: string, sourceSlug?: string): PermissionsConfigFile {
  const raw = sourceSlug
    ? loadRawSourcePermissions(ws, sourceSlug)
    : loadRawWorkspacePermissions(ws)
  return raw ?? {}
}

function savePermissions(ws: string, sourceSlug: string | undefined, config: PermissionsConfigFile): void {
  if (sourceSlug) {
    saveSourcePermissions(ws, sourceSlug, config)
  } else {
    saveWorkspacePermissions(ws, config)
  }
}

function getPermissionsPath(ws: string, sourceSlug?: string): string {
  return sourceSlug
    ? getSourcePermissionsPath(ws, sourceSlug)
    : getWorkspacePermissionsPath(ws)
}

// ─── list ────────────────────────────────────────────────────────────────────

function cmdList(ws: string): void {
  const results: Array<{ scope: string; slug?: string; path: string; exists: boolean }> = []

  // Workspace-level
  const wsPath = getWorkspacePermissionsPath(ws)
  results.push({ scope: 'workspace', path: wsPath, exists: existsSync(wsPath) })

  // Per-source
  const sourcesDir = join(ws, 'sources')
  if (existsSync(sourcesDir)) {
    try {
      const entries = readdirSync(sourcesDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const srcPath = getSourcePermissionsPath(ws, entry.name)
        results.push({ scope: 'source', slug: entry.name, path: srcPath, exists: existsSync(srcPath) })
      }
    } catch {
      // Ignore errors reading sources directory
    }
  }

  ok(results)
}

// ─── get ─────────────────────────────────────────────────────────────────────

function cmdGet(ws: string, sourceSlug?: string): void {
  const config = loadPermissions(ws, sourceSlug)
  ok({ scope: sourceSlug ? 'source' : 'workspace', source: sourceSlug ?? null, config })
}

// ─── set ─────────────────────────────────────────────────────────────────────

function cmdSet(
  ws: string,
  sourceSlug: string | undefined,
  flags: Record<string, string | boolean | string[]>,
): void {
  const input = parseInput(flags)
  if (!input) fail('USAGE_ERROR', 'Missing --json or --stdin input', 'datapilot permission set --json \'{...}\'')

  const config = input as PermissionsConfigFile
  const errors = validatePermissionsConfig(config)
  if (errors.length > 0) {
    fail('VALIDATION_ERROR', `Invalid permissions config: ${errors.join(', ')}`)
  }

  savePermissions(ws, sourceSlug, config)
  ok({ scope: sourceSlug ? 'source' : 'workspace', source: sourceSlug ?? null, config })
}

// ─── add-mcp-pattern / add-bash-pattern / add-write-path ─────────────────────

function cmdAddPattern(
  ws: string,
  sourceSlug: string | undefined,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
  field: 'allowedMcpPatterns' | 'allowedBashPatterns' | 'allowedWritePaths',
): void {
  const pattern = positionals[0]
  if (!pattern) fail('USAGE_ERROR', `Missing pattern argument`, `datapilot permission ${field === 'allowedMcpPatterns' ? 'add-mcp-pattern' : field === 'allowedBashPatterns' ? 'add-bash-pattern' : 'add-write-path'} "<pattern>"`)

  const comment = strFlag(flags, 'comment')

  const config = loadPermissions(ws, sourceSlug)
  if (!config[field]) {
    (config as Record<string, unknown>)[field] = []
  }

  const entry = comment ? { pattern, comment } : pattern
  ;(config[field] as Array<string | { pattern: string; comment?: string }>).push(entry)

  savePermissions(ws, sourceSlug, config)
  ok({ added: entry, field, total: (config[field] as unknown[]).length })
}

// ─── add-api-endpoint ────────────────────────────────────────────────────────

function cmdAddApiEndpoint(
  ws: string,
  sourceSlug: string | undefined,
  flags: Record<string, string | boolean | string[]>,
): void {
  const method = strFlag(flags, 'method')
  if (!method) fail('USAGE_ERROR', 'Missing --method', 'datapilot permission add-api-endpoint --method GET --path ".*"')

  const path = strFlag(flags, 'path')
  if (!path) fail('USAGE_ERROR', 'Missing --path', 'datapilot permission add-api-endpoint --method GET --path ".*"')

  const comment = strFlag(flags, 'comment')

  const config = loadPermissions(ws, sourceSlug)
  if (!config.allowedApiEndpoints) {
    config.allowedApiEndpoints = []
  }

  const entry = { method: method.toUpperCase() as 'GET' | 'POST' | 'HEAD' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS', path, ...(comment ? { comment } : {}) }

  config.allowedApiEndpoints.push(entry)

  savePermissions(ws, sourceSlug, config)
  ok({ added: entry, total: config.allowedApiEndpoints.length })
}

// ─── remove ──────────────────────────────────────────────────────────────────

function cmdRemove(
  ws: string,
  sourceSlug: string | undefined,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const indexStr = positionals[0]
  if (indexStr === undefined) fail('USAGE_ERROR', 'Missing index', 'datapilot permission remove <index> --type <mcp|api|bash|write-path|blocked>')

  const index = parseInt(indexStr, 10)
  if (isNaN(index)) fail('USAGE_ERROR', 'Index must be a number')

  const type = strFlag(flags, 'type')
  if (!type) fail('USAGE_ERROR', 'Missing --type flag', 'datapilot permission remove <index> --type <mcp|api|bash|write-path|blocked>')

  const fieldMap: Record<string, keyof PermissionsConfigFile> = {
    'mcp': 'allowedMcpPatterns',
    'api': 'allowedApiEndpoints',
    'bash': 'allowedBashPatterns',
    'write-path': 'allowedWritePaths',
    'blocked': 'blockedTools',
  }

  const field = fieldMap[type]
  if (!field) fail('USAGE_ERROR', `Invalid --type: ${type}`, 'Valid types: mcp, api, bash, write-path, blocked')

  const config = loadPermissions(ws, sourceSlug)
  const arr = config[field] as unknown[] | undefined
  if (!arr || index < 0 || index >= arr.length) {
    fail('VALIDATION_ERROR', `Index ${index} out of range (${arr?.length ?? 0} entries in ${field})`)
  }

  const removed = arr.splice(index, 1)[0]

  savePermissions(ws, sourceSlug, config)
  ok({ removed, field, remaining: arr.length })
}

// ─── validate ────────────────────────────────────────────────────────────────

function cmdValidate(ws: string, sourceSlug?: string): void {
  if (sourceSlug) {
    // Validate single source
    const config = loadPermissions(ws, sourceSlug)
    const errors = validatePermissionsConfig(config)
    ok({ valid: errors.length === 0, scope: 'source', source: sourceSlug, errors })
    return
  }

  // Validate workspace + all sources
  const results: Array<{ scope: string; source?: string; valid: boolean; errors: string[] }> = []

  // Workspace
  const wsConfig = loadPermissions(ws)
  const wsErrors = validatePermissionsConfig(wsConfig)
  results.push({ scope: 'workspace', valid: wsErrors.length === 0, errors: wsErrors })

  // Sources
  const sourcesDir = join(ws, 'sources')
  if (existsSync(sourcesDir)) {
    try {
      const entries = readdirSync(sourcesDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const srcPermPath = getSourcePermissionsPath(ws, entry.name)
        if (!existsSync(srcPermPath)) continue
        const srcConfig = loadPermissions(ws, entry.name)
        const srcErrors = validatePermissionsConfig(srcConfig)
        results.push({ scope: 'source', source: entry.name, valid: srcErrors.length === 0, errors: srcErrors })
      }
    } catch {
      // Ignore errors
    }
  }

  const allValid = results.every(r => r.valid)
  ok({ valid: allValid, results })
}

// ─── reset ───────────────────────────────────────────────────────────────────

function cmdReset(ws: string, sourceSlug?: string): void {
  const filePath = getPermissionsPath(ws, sourceSlug)

  if (!existsSync(filePath)) {
    ok({ reset: false, note: 'No permissions file to reset' })
    return
  }

  unlinkSync(filePath)
  ok({ reset: true, path: filePath })
}
