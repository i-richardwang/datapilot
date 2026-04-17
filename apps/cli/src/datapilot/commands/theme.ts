/**
 * theme entity — wraps the theme:* RPC channels.
 *
 * Theme settings are app-level; many actions don't take a workspace.
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = [
  'get', 'list-presets', 'load-preset',
  'get-color', 'set-color',
  'get-workspace-color', 'set-workspace-color',
  'list-workspace-themes',
  'set-override', 'reset-override', 'validate',
] as const

export async function routeTheme(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'theme', actions: ACTIONS })
  if (!ACTIONS.includes(action as typeof ACTIONS[number])) {
    fail('USAGE_ERROR', `Unknown theme action: ${action}`)
  }

  const client = await ctx.getClient()

  switch (action) {
    case 'get':
      ok(await client.invoke('theme:getApp'))

    case 'list-presets':
      ok(await client.invoke('theme:getPresets'))

    case 'load-preset': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing preset id')
      ok(await client.invoke('theme:loadPreset', id))
    }

    case 'get-color':
      ok(await client.invoke('theme:getColorTheme'))

    case 'set-color': {
      const themeId = positionals[0]
      if (!themeId) fail('USAGE_ERROR', 'Missing theme id')
      ok(await client.invoke('theme:setColorTheme', themeId))
    }

    case 'get-workspace-color': {
      const ws = await requireWorkspace(ctx)
      ok(await client.invoke('theme:getWorkspaceColorTheme', ws))
    }

    case 'set-workspace-color': {
      const ws = await requireWorkspace(ctx)
      const themeId = positionals[0]
      ok(await client.invoke('theme:setWorkspaceColorTheme', ws, themeId ?? null))
    }

    case 'list-workspace-themes':
      ok(await client.invoke('theme:getAllWorkspaceThemes'))

    case 'set-override': {
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('theme:setOverride', input))
    }

    case 'reset-override':
      ok(await client.invoke('theme:resetOverride'))

    case 'validate': {
      const input = (await parseInput(flags))
      const target = input ?? strFlag(flags, 'theme')
      if (!target) fail('USAGE_ERROR', 'Pass --input <json> or --theme <id>')
      ok(await client.invoke('theme:validate', target))
    }
  }

  fail('USAGE_ERROR', `Unhandled theme action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id>')
  return ws
}
