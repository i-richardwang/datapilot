/**
 * session entity — wraps the sessions:* RPC channels for non-interactive use.
 *
 * Flag rule: `create` keeps only `--name` (identity). `permissionMode` and
 * `enabledSourceSlugs` — previously `--mode` / `--source` flat flags — flow
 * through `--input '<json>'`. `send` accepts the message as a positional for
 * the common case; `skillSlugs` (and an alternate `message` field) flow
 * through `--input '<json>'`. `share` keeps `--html <file>` as a query-param
 * flat flag (it's a file path, not entity data) to switch upload mode.
 *
 * The CLI still defaults `permissionMode` to `allow-all` when neither the
 * flat nor the JSON path supplies one, because agents running without a human
 * can't satisfy `ask` prompts.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ok, fail } from '../envelope.ts'
import { strFlag, intFlag, listFlag, parseInput, rejectUnknownFlags, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'

const ACTIONS = [
  'list', 'get', 'create', 'delete',
  'messages', 'send', 'cancel',
  'share',
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
      rejectUnknownFlags(flags, ['status', 'label', 'search', 'sort', 'limit', 'offset'])
      const ws = await requireWorkspace(ctx)
      const sortBy = strFlag(flags, 'sort')
      if (sortBy && sortBy !== 'recent' && sortBy !== 'name' && sortBy !== 'status') {
        fail('USAGE_ERROR', `Invalid --sort '${sortBy}' (expected: recent | name | status)`)
      }
      const options: Record<string, unknown> = {}
      const status = strFlag(flags, 'status'); if (status) options.status = status
      // `label` is REPEATABLE (args.ts) so the parser always returns string[];
      // server-side filter accepts a single label, so we take the first.
      const labels = listFlag(flags, 'label'); if (labels?.length) options.label = labels[0]
      const search = strFlag(flags, 'search'); if (search) options.search = search
      if (sortBy) options.sortBy = sortBy
      const limit = intFlag(flags, 'limit'); if (limit !== undefined) options.limit = limit
      const offset = intFlag(flags, 'offset'); if (offset !== undefined) options.offset = offset
      ok(await client.invoke('sessions:list', ws, options))
    }

    case 'get': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing session id')
      const ws = await requireWorkspace(ctx)
      const info = await client.invoke('sessions:getInfo', ws, id)
      if (!info) fail('NOT_FOUND', `Session '${id}' not found`)
      ok(info)
    }

    case 'create': {
      rejectUnknownFlags(flags, ['name'], { mode: 'permissionMode', source: 'enabledSourceSlugs' })
      const ws = await requireWorkspace(ctx)
      const input = (await parseInput(flags)) ?? {}
      const name = strFlag(flags, 'name') ?? (input.name as string | undefined)
      const opts: Record<string, unknown> = { ...input }
      if (name) opts.name = name
      if (opts.permissionMode === undefined) opts.permissionMode = 'allow-all'
      ok(await client.invoke('sessions:create', ws, opts))
    }

    case 'delete': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing session id')
      await client.invoke('sessions:delete', id)
      ok({ deleted: id })
    }

    case 'messages': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing session id')
      ok(await client.invoke('sessions:getMessages', id))
    }

    case 'send': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing session id')
      const positionalMessage = positionals.slice(1).join(' ')
      const input = (await parseInput(flags)) ?? {}
      const message = (input.message as string | undefined) ?? positionalMessage
      if (!message) fail('USAGE_ERROR', 'Missing message text — pass as positional or --input \'{"message":"..."}\'')
      const skillSlugs = input.skillSlugs as string[] | undefined
      const options = skillSlugs ? { skillSlugs } : undefined
      ok(await client.invoke('sessions:sendMessage', id, message, undefined, undefined, options))
    }

    case 'cancel': {
      rejectUnknownFlags(flags, [])
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing session id')
      await client.invoke('sessions:cancel', id)
      ok({ cancelled: id })
    }

    case 'share': {
      rejectUnknownFlags(flags, ['html', 'password'])
      const id = positionals[0] ?? process.env.CRAFT_SESSION_ID
      if (!id) {
        fail('USAGE_ERROR', 'Missing session id', {
          suggestion: 'dtpilot session share <id> [--html <file>] [--password <pw>]',
        })
      }
      const htmlPath = strFlag(flags, 'html')
      const password = strFlag(flags, 'password') ?? null
      const ws = await requireWorkspace(ctx)
      if (htmlPath) {
        let html: string
        try {
          html = await readFile(resolve(htmlPath), 'utf8')
        } catch (e) {
          fail('NOT_FOUND', `Cannot read ${htmlPath}: ${(e as Error).message}`)
        }
        if (html.length === 0) fail('VALIDATION_ERROR', 'HTML file is empty')
        ok(await client.invoke('sessions:shareHtml', ws, id, html, password))
      }
      ok(await client.invoke('sessions:share', ws, id, password))
    }
  }

  fail('USAGE_ERROR', `Unhandled session action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id>')
  return ws
}
