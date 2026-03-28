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

const VERSION = '0.7.2'

const DISCOVER = {
  name: 'datapilot',
  version: VERSION,
  entities: ['label', 'source', 'automation', 'skill', 'permission', 'theme'],
  outputFormat: 'json-envelope',
}

async function main(): Promise<void> {
  const { entity, action, positionals, flags } = parseArgs(process.argv.slice(2))

  // Global flags
  if (flags['version']) {
    ok(VERSION)
  }
  if (flags['discover']) {
    ok(DISCOVER)
  }
  if (flags['help'] || !entity) {
    ok({
      usage: 'datapilot <entity> <action> [args] [--flags]',
      entities: ['label', 'source', 'automation', 'skill', 'permission', 'theme'],
      globalFlags: ['--help', '--version', '--discover', '--workspace-root <path>', '--json', '--stdin'],
    })
  }

  // Initialize DB
  await ensureDb()

  // Resolve workspace
  const workspaceRoot = resolveWorkspaceRoot(strFlag(flags, 'workspace-root'))

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
    default:
      fail('USAGE_ERROR', `Unknown entity: ${entity}`, 'Valid entities: label, source, automation, skill, permission, theme')
  }
}

main().catch(e => {
  fail('INTERNAL_ERROR', (e as Error).message)
})
