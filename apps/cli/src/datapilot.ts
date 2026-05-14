#!/usr/bin/env node
/**
 * dtpilot — unified thin CLI client for the DataPilot server.
 *
 * Usage:
 *   dtpilot [global-flags] <entity> <action> [args...] [flags...]
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
import { ok, fail, setOutputMode, warn } from './datapilot/envelope.ts'
import { connect, resolveEndpoint, resolveWorkspaceId, ConnectionError } from './datapilot/transport.ts'
import { isEntity, type RouteCtx, ENTITIES } from './datapilot/router.ts'
import { printTopHelp, printEntityHelp, printActionHelp } from './datapilot/help.ts'
import type { CliRpcClient } from './client.ts'

import { routeLabel } from './datapilot/commands/label.ts'
import { routeSource } from './datapilot/commands/source.ts'
import { routeAutomation } from './datapilot/commands/automation.ts'
import { routeSkill } from './datapilot/commands/skill.ts'
import { routeBatch } from './datapilot/commands/batch.ts'
import { routeSession } from './datapilot/commands/session.ts'
import { routeWorkspace } from './datapilot/commands/workspace.ts'
import { routeStatus } from './datapilot/commands/status.ts'
import { routePreference } from './datapilot/commands/preference.ts'
import pkg from '../package.json' with { type: 'json' }

const VERSION = pkg.version

export async function main(argv: string[] = process.argv): Promise<void> {
  const args = parseArgs(argv.slice(2))

  if (args.global.json) setOutputMode('json')
  else if (args.global.human) setOutputMode('human')

  // Top-level help: `dtpilot --help` or just `dtpilot`
  if (args.global.help && !args.entity) printTopHelp()
  if (args.global.version && !args.entity) {
    ok(VERSION, { human: () => VERSION })
  }
  if (!args.entity) printTopHelp()

  if (!isEntity(args.entity)) {
    fail('USAGE_ERROR', `Unknown entity: ${args.entity}`, {
      suggestion: `Valid entities: ${ENTITIES.join(', ')}`,
    })
  }

  // Action-level help: `dtpilot <entity> <action> --help`
  if (args.global.help && args.action) printActionHelp(args.entity, args.action)
  // Entity-level help: `dtpilot <entity> --help`
  if (args.global.help) printEntityHelp(args.entity)

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
      case 'status': await routeStatus(ctx, args.action, args.positionals, args.flags); break
      case 'preference': await routePreference(ctx, args.action, args.positionals, args.flags); break
    }
  } catch (e) {
    if (e instanceof ConnectionError) {
      fail('CONNECTION_ERROR', e.message)
    }
    if (e instanceof UsageError) {
      fail('USAGE_ERROR', e.message)
    }
    // RPC errors from the server carry a `.code` property — surface
    // `VALIDATION_ERROR` / `NOT_FOUND` directly instead of collapsing into
    // `INTERNAL_ERROR`, so schema failures are actionable to callers.
    const rpcCode = (e as { code?: unknown })?.code
    const msg = e instanceof Error ? e.message : String(e)
    if (rpcCode === 'VALIDATION_ERROR') fail('VALIDATION_ERROR', msg)
    if (rpcCode === 'NOT_FOUND') fail('NOT_FOUND', msg)
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
      const resolution = await resolveWorkspaceId(client, args.global.workspace)
      if (resolution?.ambiguous) {
        // Only warn when the server has multiple workspaces and the caller
        // didn't pick one. Single-workspace setups have no ambiguity, so
        // staying silent there avoids per-command noise.
        warn(
          `workspace not specified; defaulted to "${resolution.id}" — ` +
          `pass --workspace or set $DATAPILOT_WORKSPACE to silence`,
        )
      }
      return resolution?.id
    })()
    return workspacePromise
  }

  const destroyClient = (): void => {
    cachedClient?.destroy()
    cachedClient = null
  }

  const getEndpoint = () => resolveEndpoint({
    url: args.global.url,
    token: args.global.token,
    workspace: args.global.workspace,
    timeout: args.global.timeout,
    tlsCa: args.global.tlsCa,
  })

  return {
    getClient,
    getEndpoint,
    getWorkspace,
    destroyClient,
    global: args.global,
  }
}

// This file is an executable entry point — never imported. Running it (via
// `node dist/datapilot.js`, `bun run src/datapilot.ts`, or the installed
// `dtpilot` bin) always invokes `main()`. The `export` above is purely for
// type-checking tools that may need to reference it.
main()
