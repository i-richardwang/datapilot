/**
 * session entity — wraps the sessions:* RPC channels for non-interactive use.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ok, fail } from '../envelope.ts'
import { strFlag, listFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = [
  'list', 'get', 'create', 'delete',
  'messages', 'send', 'cancel',
  'set-model',
  'get-files',
  'share', 'share-html',
] as const

export async function routeSession(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'session', actions: ACTIONS })
  if (!ACTIONS.includes(action as typeof ACTIONS[number])) {
    fail('USAGE_ERROR', `Unknown session action: ${action}`)
  }

  const client = await ctx.getClient()

  switch (action) {
    case 'list': {
      const ws = await requireWorkspace(ctx)
      ok(await client.invoke('sessions:get', ws))
    }

    case 'get': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing session id')
      const ws = await requireWorkspace(ctx)
      const list = (await client.invoke('sessions:get', ws)) as Array<{ id: string }>
      const found = list.find((s) => s.id === id)
      if (!found) fail('NOT_FOUND', `Session '${id}' not found`)
      ok(found)
    }

    case 'create': {
      const ws = await requireWorkspace(ctx)
      const input = (await parseInput(flags)) ?? {}
      const name = (input.name as string) ?? strFlag(flags, 'name')
      const mode = (input.permissionMode as string) ?? strFlag(flags, 'mode') ?? 'allow-all'
      const sources = (input.enabledSourceSlugs as string[] | undefined) ?? listFlag(flags, 'source')
      const opts: Record<string, unknown> = { ...input }
      if (name) opts.name = name
      if (mode) opts.permissionMode = mode
      if (sources?.length) opts.enabledSourceSlugs = sources
      ok(await client.invoke('sessions:create', ws, opts))
    }

    case 'delete': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing session id')
      await client.invoke('sessions:delete', id)
      ok({ deleted: id })
    }

    case 'messages': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing session id')
      ok(await client.invoke('sessions:getMessages', id))
    }

    case 'send': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing session id')
      const message = positionals.slice(1).join(' ')
      if (!message) fail('USAGE_ERROR', 'Missing message text')
      ok(await client.invoke('sessions:sendMessage', id, message))
    }

    case 'cancel': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing session id')
      await client.invoke('sessions:cancel', id)
      ok({ cancelled: id })
    }

    case 'set-model': {
      const id = positionals[0]
      const model = positionals[1]
      if (!id || !model) fail('USAGE_ERROR', 'Usage: session set-model <id> <model>')
      const ws = await requireWorkspace(ctx)
      const connectionSlug = strFlag(flags, 'connection')
      ok(await client.invoke('session:setModel', id, ws, model, connectionSlug))
    }

    case 'get-files': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing session id')
      ok(await client.invoke('sessions:getFiles', id))
    }

    case 'share': {
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing session id')
      const ws = await requireWorkspace(ctx)
      ok(await client.invoke('sessions:share', ws, id))
    }

    case 'share-html': {
      const filePath = positionals[0]
      if (!filePath) {
        fail('USAGE_ERROR', 'Missing HTML file path', {
          suggestion: 'datapilot session share-html <file> [--session <id>]',
        })
      }
      const id = strFlag(flags, 'session') ?? process.env.CRAFT_SESSION_ID
      if (!id) {
        fail('USAGE_ERROR', 'Session ID required', {
          suggestion: 'pass --session <id> or run inside a session where $CRAFT_SESSION_ID is set',
        })
      }
      let html: string
      try {
        html = await readFile(resolve(filePath), 'utf8')
      } catch (e) {
        fail('NOT_FOUND', `Cannot read ${filePath}: ${(e as Error).message}`)
      }
      if (html.length === 0) fail('VALIDATION_ERROR', 'HTML file is empty')
      const ws = await requireWorkspace(ctx)
      ok(await client.invoke('sessions:shareHtml', ws, id, html))
    }
  }

  fail('USAGE_ERROR', `Unhandled session action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id>')
  return ws
}
