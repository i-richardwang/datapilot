#!/usr/bin/env node
/**
 * datapilot — unified thin CLI client for the DataPilot server.
 *
 * Usage:
 *   datapilot [global-flags] <entity> <action> [args...] [flags...]
 *
 * Connection model:
 *   All operations talk to a running server over WebSocket. Default target
 *   is `ws://127.0.0.1:9100`; override with `--url` or set
 *   $DATAPILOT_SERVER_URL. Token comes from `--token` /
 *   $DATAPILOT_SERVER_TOKEN, or from the discovery file at
 *   `~/.datapilot/.server.endpoint`.
 *
 * Output contract:
 *   - Non-TTY stdout: JSON envelope `{ok, data|error, warnings}`
 *   - TTY stdout: human-readable rendering
 *   Force either with `--json` or `--human`.
 */

import { parseArgs, UsageError } from './datapilot/args.ts'
import { ok, fail, setOutputMode } from './datapilot/envelope.ts'
import { connect, resolveWorkspaceId, ConnectionError } from './datapilot/transport.ts'
import { isEntity, type RouteCtx, ENTITIES } from './datapilot/router.ts'
import type { CliRpcClient } from './client.ts'

import { routeLabel } from './datapilot/commands/label.ts'
import { routeSource } from './datapilot/commands/source.ts'
import { routeAutomation } from './datapilot/commands/automation.ts'
import { routeSkill } from './datapilot/commands/skill.ts'
import { routeBatch } from './datapilot/commands/batch.ts'
import { routeSession } from './datapilot/commands/session.ts'
import { routeWorkspace } from './datapilot/commands/workspace.ts'

const VERSION = '0.1.0-phase3'

export async function main(argv: string[] = process.argv): Promise<void> {
  const args = parseArgs(argv.slice(2))

  if (args.global.json) setOutputMode('json')
  else if (args.global.human) setOutputMode('human')

  if (args.global.help && !args.entity) {
    printHelp()
    process.exit(0)
  }
  if (args.global.version && !args.entity) {
    ok(VERSION, { human: () => VERSION })
  }

  if (!args.entity) {
    if (args.global.json) {
      ok({ usage: 'datapilot <entity> <action> [args]', entities: ENTITIES })
    }
    printHelp()
    process.exit(0)
  }

  if (!isEntity(args.entity)) {
    fail('USAGE_ERROR', `Unknown entity: ${args.entity}`, {
      suggestion: `Valid entities: ${ENTITIES.join(', ')}`,
    })
  }

  // Per-action help: `datapilot <entity> --help`
  if (args.global.help) {
    ok({
      entity: args.entity,
      hint: `Run 'datapilot ${args.entity}' (no action) to list available actions`,
    })
  }

  const ctx = createCtx(args)
  try {
    switch (args.entity) {
      case 'label': await routeLabel(ctx, args.action, args.positionals, args.flags); break
      case 'source': await routeSource(ctx, args.action, args.positionals, args.flags); break
      case 'automation': await routeAutomation(ctx, args.action, args.positionals, args.flags); break
      case 'skill': await routeSkill(ctx, args.action, args.positionals, args.flags); break
      case 'batch': await routeBatch(ctx, args.action, args.positionals, args.flags); break
      case 'session': await routeSession(ctx, args.action, args.positionals, args.flags); break
      case 'workspace': await routeWorkspace(ctx, args.action, args.positionals, args.flags); break
    }
  } catch (e) {
    if (e instanceof ConnectionError) {
      fail('CONNECTION_ERROR', e.message)
    }
    if (e instanceof UsageError) {
      fail('USAGE_ERROR', e.message)
    }
    const msg = e instanceof Error ? e.message : String(e)
    fail('INTERNAL_ERROR', msg)
  } finally {
    ctx.destroyClient()
  }
}

function createCtx(args: ReturnType<typeof parseArgs>): RouteCtx {
  let cachedClient: CliRpcClient | null = null
  let workspacePromise: Promise<string | undefined> | null = null

  const getClient = async (): Promise<CliRpcClient> => {
    if (cachedClient) return cachedClient
    const { client } = await connect({
      url: args.global.url,
      token: args.global.token,
      workspace: args.global.workspace,
      timeout: args.global.timeout,
      tlsCa: args.global.tlsCa,
    })
    cachedClient = client
    return client
  }

  const getWorkspace = async (): Promise<string | undefined> => {
    if (workspacePromise) return workspacePromise
    workspacePromise = (async () => {
      const client = await getClient()
      return resolveWorkspaceId(client, args.global.workspace)
    })()
    return workspacePromise
  }

  const destroyClient = (): void => {
    cachedClient?.destroy()
    cachedClient = null
  }

  return {
    getClient,
    getWorkspace,
    destroyClient,
    global: args.global,
  }
}

function printHelp(): void {
  process.stdout.write(`datapilot — unified CLI for the DataPilot server

Usage:
  datapilot [global-flags] <entity> <action> [positionals...] [flags...]

Global flags:
  --url <ws-url>         Server URL (default: ws://127.0.0.1:9100, env: DATAPILOT_SERVER_URL)
  --token <secret>       Auth token (env: DATAPILOT_SERVER_TOKEN, or discovery file)
  --workspace <id>       Workspace ID (auto-detected if omitted)
  --timeout <ms>         Per-request timeout (default: 30000)
  --tls-ca <path>        Custom CA cert for self-signed TLS (env: DATAPILOT_TLS_CA)
  --json                 Force JSON envelope output (default for non-TTY stdout)
  --human                Force human-readable output (default for TTY stdout)
  --help, -h             Show this help
  --version, -v          Show version

Entities:
  label                  Workspace labels and auto-rules
  source                 Workspace sources (MCP / API / local)
  automation             Workspace automations
  skill                  Workspace skills
  batch                  Batch processing jobs
  session                Sessions inside a workspace
  workspace              Workspaces themselves

Run 'datapilot <entity>' with no action to list that entity's actions.

Examples:
  datapilot label list
  datapilot label create --name TODO --color blue
  datapilot --url wss://remote source list
`)
}

// This file is an executable entry point — never imported. Running it (via
// `node dist/datapilot.js`, `bun run src/datapilot.ts`, or the installed
// `datapilot` bin) always invokes `main()`. The `export` above is purely for
// type-checking tools that may need to reference it.
main()
