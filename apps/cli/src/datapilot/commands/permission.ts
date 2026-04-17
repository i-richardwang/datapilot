/**
 * permission entity — wraps the permissions:* RPC channels.
 *
 * Permission documents are scoped to a workspace and optionally a source
 * inside it (positional 0 = scope; pass "workspace" or "source:<slug>").
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = [
  'list', 'get', 'set',
  'add-mcp-pattern', 'add-api-endpoint', 'add-bash-pattern', 'add-write-path',
  'remove', 'validate', 'reset', 'defaults',
] as const

type Scope = { kind: 'workspace' } | { kind: 'source'; slug: string }

function parseScope(arg: string | undefined): Scope {
  if (!arg || arg === 'workspace') return { kind: 'workspace' }
  if (arg.startsWith('source:')) return { kind: 'source', slug: arg.slice('source:'.length) }
  fail('USAGE_ERROR', `Unknown scope '${arg}' (expected "workspace" or "source:<slug>")`)
}

function scopeArgs(scope: Scope): unknown[] {
  return scope.kind === 'workspace' ? [] : ['source', scope.slug]
}

export async function routePermission(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'permission', actions: ACTIONS })
  if (!ACTIONS.includes(action as typeof ACTIONS[number])) {
    fail('USAGE_ERROR', `Unknown permission action: ${action}`)
  }

  const ws = await requireWorkspace(ctx)
  const client = await ctx.getClient()

  switch (action) {
    case 'defaults':
      ok(await client.invoke('permissions:getDefaults'))

    case 'list':
      ok(await client.invoke('permissions:list', ws))

    case 'get': {
      const scope = parseScope(positionals[0])
      ok(await client.invoke('permissions:get', ws, ...scopeArgs(scope)))
    }

    case 'set': {
      const scope = parseScope(positionals[0])
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('permissions:set', ws, ...scopeArgs(scope), input))
    }

    case 'add-mcp-pattern': {
      const scope = parseScope(positionals[0])
      const pattern = strFlag(flags, 'pattern')
      if (!pattern) fail('USAGE_ERROR', 'Missing --pattern')
      ok(await client.invoke('permissions:addMcpPattern', ws, ...scopeArgs(scope), pattern))
    }

    case 'add-api-endpoint': {
      const scope = parseScope(positionals[0])
      const method = strFlag(flags, 'method')
      const pathPattern = strFlag(flags, 'path')
      if (!method || !pathPattern) fail('USAGE_ERROR', 'Missing --method and/or --path')
      ok(await client.invoke('permissions:addApiEndpoint', ws, ...scopeArgs(scope), { method, pathPattern }))
    }

    case 'add-bash-pattern': {
      const scope = parseScope(positionals[0])
      const pattern = strFlag(flags, 'pattern')
      if (!pattern) fail('USAGE_ERROR', 'Missing --pattern')
      ok(await client.invoke('permissions:addBashPattern', ws, ...scopeArgs(scope), pattern))
    }

    case 'add-write-path': {
      const scope = parseScope(positionals[0])
      const path = strFlag(flags, 'path')
      if (!path) fail('USAGE_ERROR', 'Missing --path')
      ok(await client.invoke('permissions:addWritePath', ws, ...scopeArgs(scope), path))
    }

    case 'remove': {
      const scope = parseScope(positionals[0])
      const kind = strFlag(flags, 'kind')
      const value = strFlag(flags, 'value')
      if (!kind || !value) fail('USAGE_ERROR', 'Missing --kind and/or --value')
      ok(await client.invoke('permissions:remove', ws, ...scopeArgs(scope), kind, value))
    }

    case 'validate': {
      const scope = parseScope(positionals[0])
      ok(await client.invoke('permissions:validate', ws, ...scopeArgs(scope)))
    }

    case 'reset': {
      const scope = parseScope(positionals[0])
      ok(await client.invoke('permissions:reset', ws, ...scopeArgs(scope)))
    }
  }

  fail('USAGE_ERROR', `Unhandled permission action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id>')
  return ws
}
