#!/usr/bin/env bun
/**
 * datapilot CLI
 *
 * Standalone binary for managing workspace configuration:
 * labels, sources, skills, automations, permissions, and themes.
 *
 * All output uses JSON envelope format:
 *   { "ok": true, "data": ..., "warnings": [] }
 *   { "ok": false, "error": { "code": "...", "message": "..." }, "warnings": [] }
 */

import { parseArgs, strFlag } from './args.ts'
import { ok, fail } from './envelope.ts'
import { ensureDb } from './db-init.ts'
import { resolveWorkspaceRoot } from './workspace.ts'
import { routeLabel } from './commands/label.ts'
import { routeSource } from './commands/source.ts'
import { routeAutomation } from './commands/automation.ts'
import { routeSkill } from './commands/skill.ts'
import { routePermission } from './commands/permission.ts'
import { routeTheme } from './commands/theme.ts'
import { routeBatch } from './commands/batch.ts'

const VERSION = '0.7.2'

async function main(): Promise<void> {
  const { entity, action, positionals, flags } = parseArgs(process.argv.slice(2))

  // Global flags
  if (flags['version']) {
    ok(VERSION)
  }
  if (!entity) {
    ok({
      usage: 'datapilot <entity> <action> [args] [--flags]',
      entities: ['label', 'source', 'automation', 'skill', 'permission', 'theme', 'batch'],
      globalFlags: ['--help', '--version', '--workspace-root <path>', '--json', '--stdin'],
    })
  }

  // Resolve workspace
  const workspaceRoot = resolveWorkspaceRoot(strFlag(flags, 'workspace-root'))

  // Initialize DB-backed storage used by CLI domains.
  // Batch config lives in batches.json, but batch state/status live in workspace.db.
  await ensureDb()

  switch (entity) {
    case 'label':
      routeLabel(workspaceRoot, action, positionals, flags)
      break
    case 'source':
      await routeSource(workspaceRoot, action, positionals, flags)
      break
    case 'automation':
      routeAutomation(workspaceRoot, action, positionals, flags)
      break
    case 'skill':
      routeSkill(workspaceRoot, action, positionals, flags)
      break
    case 'permission':
      routePermission(workspaceRoot, action, positionals, flags)
      break
    case 'theme':
      routeTheme(workspaceRoot, action, positionals, flags)
      break
    case 'batch':
      routeBatch(workspaceRoot, action, positionals, flags)
      break
    default:
      fail('USAGE_ERROR', `Unknown entity: ${entity}`, 'Valid entities: label, source, automation, skill, permission, theme, batch')
  }
}

main().catch(e => {
  fail('INTERNAL_ERROR', (e as Error).message)
})
