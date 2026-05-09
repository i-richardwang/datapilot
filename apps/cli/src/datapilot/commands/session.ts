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
import { strFlag, intFlag, listFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'
import { rejectActionFlags, type ActionSpec, type EntitySpec } from '../help.ts'

export const SESSION_SPEC: EntitySpec = {
  name: 'session',
  description: 'Sessions (conversational threads inside a workspace)',
  actions: [
    {
      name: 'list',
      description: 'List sessions in the workspace with optional filters',
      flags: [
        { name: 'status', type: 'string', description: 'Filter by status id' },
        { name: 'label', type: 'list', description: 'Filter by label id (first one wins)' },
        { name: 'search', type: 'string', description: 'Full-text search filter' },
        { name: 'sort', type: 'string', description: 'Sort by: recent | name | status', default: 'recent' },
        { name: 'limit', type: 'int', description: 'Page size' },
        { name: 'offset', type: 'int', description: 'Pagination offset' },
      ],
      example: 'dtpilot session list --sort recent --limit 20',
    },
    {
      name: 'get',
      description: 'Show one session info',
      positionals: [{ name: 'id', description: 'Session id' }],
      flags: [],
      example: 'dtpilot session get my-session-id',
    },
    {
      name: 'create',
      description: 'Create a new session (permissionMode/enabledSourceSlugs/etc go in --input)',
      flags: [{ name: 'name', type: 'string', description: 'Session name (optional)' }],
      renames: { mode: 'permissionMode', source: 'enabledSourceSlugs' },
      takesInput: true,
      example: 'dtpilot session create --name "Triage" --input \'{"permissionMode":"safe"}\'',
    },
    {
      name: 'delete',
      description: 'Delete a session',
      positionals: [{ name: 'id', description: 'Session id' }],
      flags: [],
      example: 'dtpilot session delete my-session-id',
    },
    {
      name: 'messages',
      description: 'List messages in a session',
      positionals: [{ name: 'id', description: 'Session id' }],
      flags: [],
      example: 'dtpilot session messages my-session-id',
    },
    {
      name: 'send',
      description: 'Send a message to an existing session',
      positionals: [
        { name: 'id', description: 'Session id' },
        { name: 'message', required: false, variadic: true, description: 'Message text (or pass via --input \'{"message":"..."}\')' },
      ],
      flags: [],
      takesInput: true,
      example: 'dtpilot session send my-session-id "Summarize the latest"',
    },
    {
      name: 'cancel',
      description: 'Cancel an in-flight assistant turn',
      positionals: [{ name: 'id', description: 'Session id' }],
      flags: [],
      example: 'dtpilot session cancel my-session-id',
    },
    {
      name: 'share',
      description: 'Generate a shareable URL for the session (optionally upload a pre-rendered HTML)',
      positionals: [{ name: 'id', required: false, description: 'Session id (defaults to $CRAFT_SESSION_ID)' }],
      flags: [
        { name: 'html', type: 'string', description: 'Path to a pre-rendered HTML file to upload' },
        { name: 'password', type: 'string', description: 'Optional password to protect the share' },
      ],
      example: 'dtpilot session share my-session-id --html ./out.html --password secret',
    },
  ],
}

function specOf(action: string): ActionSpec {
  return SESSION_SPEC.actions.find((a) => a.name === action)!
}

export async function routeSession(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'session', actions: SESSION_SPEC.actions.map((a) => a.name) })
  if (!SESSION_SPEC.actions.some((a) => a.name === action)) {
    fail('USAGE_ERROR', `Unknown session action: ${action}`, {
      suggestion: `Valid actions: ${SESSION_SPEC.actions.map((a) => a.name).join(', ')}`,
    })
  }

  const client = await ctx.getClient()

  switch (action) {
    case 'list': {
      rejectActionFlags(flags, specOf('list'))
      const ws = await requireWorkspace(ctx)
      const sortBy = strFlag(flags, 'sort')
      if (sortBy && sortBy !== 'recent' && sortBy !== 'name' && sortBy !== 'status') {
        fail('USAGE_ERROR', `Invalid --sort '${sortBy}' (expected: recent | name | status)`)
      }
      const options: Record<string, unknown> = {}
      const status = strFlag(flags, 'status'); if (status) options.status = status
      const labels = listFlag(flags, 'label'); if (labels?.length) options.label = labels[0]
      const search = strFlag(flags, 'search'); if (search) options.search = search
      if (sortBy) options.sortBy = sortBy
      const limit = intFlag(flags, 'limit'); if (limit !== undefined) options.limit = limit
      const offset = intFlag(flags, 'offset'); if (offset !== undefined) options.offset = offset
      ok(await client.invoke('sessions:list', ws, options))
    }

    case 'get': {
      rejectActionFlags(flags, specOf('get'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing session id')
      const ws = await requireWorkspace(ctx)
      const info = await client.invoke('sessions:getInfo', ws, id)
      if (!info) fail('NOT_FOUND', `Session '${id}' not found`)
      ok(info)
    }

    case 'create': {
      rejectActionFlags(flags, specOf('create'))
      const ws = await requireWorkspace(ctx)
      const input = (await parseInput(flags)) ?? {}
      const name = strFlag(flags, 'name') ?? (input.name as string | undefined)
      const opts: Record<string, unknown> = { ...input }
      if (name) opts.name = name
      if (opts.permissionMode === undefined) opts.permissionMode = 'allow-all'
      ok(await client.invoke('sessions:create', ws, opts))
    }

    case 'delete': {
      rejectActionFlags(flags, specOf('delete'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing session id')
      await client.invoke('sessions:delete', id)
      ok({ deleted: id })
    }

    case 'messages': {
      rejectActionFlags(flags, specOf('messages'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing session id')
      ok(await client.invoke('sessions:getMessages', id))
    }

    case 'send': {
      rejectActionFlags(flags, specOf('send'))
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
      rejectActionFlags(flags, specOf('cancel'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing session id')
      await client.invoke('sessions:cancel', id)
      ok({ cancelled: id })
    }

    case 'share': {
      rejectActionFlags(flags, specOf('share'))
      const id = positionals[0] ?? process.env.CRAFT_SESSION_ID
      if (!id) fail('USAGE_ERROR', 'Missing session id')
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
