/**
 * batch entity — wraps the batches:* RPC channels.
 *
 * Flag rule: `create` keeps only `--name` (identity). Everything else —
 * `source`, `idField`, `promptFile`, execution config — goes through
 * `--input '<json>'`. Read-side actions keep query-param flat flags
 * (`--offset`, `--limit`).
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, intFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'
import { rejectActionFlags, type ActionSpec, type EntitySpec } from '../help.ts'

/** Valid `BatchStatus` values (mirrors BatchStatus in @craft-agent/shared/batches). */
const BATCH_STATUSES = new Set(['pending', 'running', 'paused', 'completed', 'failed'])

export const BATCH_SPEC: EntitySpec = {
  name: 'batch',
  description: 'Batch processing jobs (CSV/JSON ingest, prompt fan-out, structured output)',
  actions: [
    {
      name: 'list',
      description: 'List batches (overview only — full config via `batch get`); paged, returns {total,returned,truncated}',
      flags: [
        {
          name: 'status',
          type: 'string',
          description: 'Filter by status (comma-separated: pending,running,paused,completed,failed)',
        },
        { name: 'offset', type: 'int', description: 'Pagination offset', default: 0 },
        { name: 'limit', type: 'int', description: 'Page size', default: 100 },
      ],
      example: 'datapilot batch list --status paused --limit 100',
    },
    {
      name: 'get',
      description: 'Show batch config + progress for one batch',
      positionals: [{ name: 'id', description: 'Batch id' }],
      flags: [],
      example: 'datapilot batch get my-batch-id',
    },
    {
      name: 'create',
      description: 'Create a new batch (full config goes in --input)',
      flags: [{ name: 'name', type: 'string', required: true, description: 'Batch name (identity)' }],
      takesInput: true,
      example: 'datapilot batch create --name "Onboarding" --input "$(cat config.json)"',
    },
    {
      name: 'update',
      description: 'Update a batch config',
      positionals: [{ name: 'id', description: 'Batch id' }],
      flags: [],
      takesInput: true,
      example: 'datapilot batch update my-batch-id --input \'{"execution":{"maxConcurrency":4}}\'',
    },
    {
      name: 'delete',
      description: 'Delete a batch (no cancelled state — delete to abort a running batch)',
      positionals: [{ name: 'id', description: 'Batch id' }],
      flags: [],
      example: 'datapilot batch delete my-batch-id',
    },
    {
      name: 'start',
      description: 'Start a pending or paused batch',
      positionals: [{ name: 'id', description: 'Batch id' }],
      flags: [],
      example: 'datapilot batch start my-batch-id',
    },
    {
      name: 'pause',
      description: 'Pause a running batch (paused is non-terminal)',
      positionals: [{ name: 'id', description: 'Batch id' }],
      flags: [],
      example: 'datapilot batch pause my-batch-id',
    },
    {
      name: 'resume',
      description: 'Resume a paused batch',
      positionals: [{ name: 'id', description: 'Batch id' }],
      flags: [],
      example: 'datapilot batch resume my-batch-id',
    },
    {
      name: 'items',
      description: 'List items in a batch with their per-item status',
      positionals: [{ name: 'id', description: 'Batch id' }],
      flags: [
        { name: 'offset', type: 'int', description: 'Pagination offset', default: 0 },
        { name: 'limit', type: 'int', description: 'Page size', default: 100 },
      ],
      example: 'datapilot batch items my-batch-id --offset 0 --limit 100',
    },
    {
      name: 'retry-item',
      description: 'Retry a single failed item',
      positionals: [
        { name: 'batch-id', description: 'Batch id' },
        { name: 'item-id', description: 'Item id (the value from source.idField)' },
      ],
      flags: [],
      example: 'datapilot batch retry-item my-batch-id item-42',
    },
  ],
}

function specOf(action: string): ActionSpec {
  return BATCH_SPEC.actions.find((a) => a.name === action)!
}

export async function routeBatch(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'batch', actions: BATCH_SPEC.actions.map((a) => a.name) })
  if (!BATCH_SPEC.actions.some((a) => a.name === action)) {
    fail('USAGE_ERROR', `Unknown batch action: ${action}`, {
      suggestion: `Valid actions: ${BATCH_SPEC.actions.map((a) => a.name).join(', ')}`,
    })
  }

  const ws = await requireWorkspace(ctx)
  const client = await ctx.getClient()

  switch (action) {
    case 'list': {
      rejectActionFlags(flags, specOf('list'))
      // `batch list` returns an OVERVIEW projection only: identity + status +
      // per-item progress counts. The bulky per-batch config (`source`,
      // `execution`, `action`/prompt, `output`) is dropped — fetch it via
      // `batch get <id>`. Combined with the `{ total, returned, truncated }`
      // envelope and a default `--limit`, a consumer can always tell whether
      // it holds the full set instead of silently acting on a dump that some
      // downstream stdout cap truncated. Mirrors the bounded-list pattern in
      // `sessions.ts` (count + slice + truncated) and `BatchItemsPage`.
      const list = (await client.invoke('batches:list', ws)) as Array<Record<string, unknown>>
      const overview = list.map((b) => {
        const progress = b.progress as
          | {
              status?: string
              totalItems?: number
              completedItems?: number
              failedItems?: number
              runningItems?: number
              pendingItems?: number
              skippedItems?: number
            }
          | undefined
        const action = b.action as { prompt?: string } | undefined
        return {
          id: b.id,
          name: b.name,
          createdAt: b.createdAt,
          labels: b.labels,
          // A batch that never ran has no progress — its status is 'pending'.
          status: progress?.status ?? 'pending',
          // Signal a prompt exists (and how long) without shipping its body.
          promptChars: typeof action?.prompt === 'string' ? action.prompt.length : undefined,
          progress: progress
            ? {
                totalItems: progress.totalItems,
                completedItems: progress.completedItems,
                failedItems: progress.failedItems,
                runningItems: progress.runningItems,
                pendingItems: progress.pendingItems,
                skippedItems: progress.skippedItems,
              }
            : undefined,
        }
      })

      let filtered = overview
      const statusArg = strFlag(flags, 'status')
      if (statusArg) {
        const wanted = statusArg.split(',').map((s) => s.trim()).filter(Boolean)
        const invalid = wanted.filter((s) => !BATCH_STATUSES.has(s))
        if (invalid.length > 0) {
          fail('USAGE_ERROR', `Invalid status: ${invalid.join(', ')}`, {
            suggestion: `Valid statuses: ${[...BATCH_STATUSES].join(', ')}`,
          })
        }
        const want = new Set(wanted)
        filtered = overview.filter((b) => want.has(b.status))
      }

      const offset = Math.max(0, intFlag(flags, 'offset') ?? 0)
      const limit = Math.max(0, intFlag(flags, 'limit') ?? 100)
      const page = filtered.slice(offset, offset + limit)
      // `total` is the count AFTER `--status` filtering; `truncated` is true
      // when this page stops short of the end — narrow with `--status` or page
      // with `--offset`. Never read `batches` as complete without checking it.
      ok({
        total: filtered.length,
        returned: page.length,
        offset,
        limit,
        truncated: offset + page.length < filtered.length,
        batches: page,
      })
    }

    case 'get': {
      rejectActionFlags(flags, specOf('get'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      const [list, progress] = await Promise.all([
        client.invoke('batches:list', ws),
        client.invoke('batches:getStatus', ws, id),
      ])
      const found = (list as Array<{ id: string }>).find((b) => b.id === id)
      if (!found) fail('NOT_FOUND', `Batch '${id}' not found`)
      ok({ ...found, progress })
    }

    case 'create': {
      rejectActionFlags(flags, specOf('create'))
      const input = (await parseInput(flags)) ?? {}
      const name = strFlag(flags, 'name') ?? (input.name as string | undefined)
      if (!name) fail('USAGE_ERROR', 'Missing --name')
      ok(await client.invoke('batches:create', ws, { ...input, name }))
    }

    case 'update': {
      rejectActionFlags(flags, specOf('update'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('batches:update', ws, id, input))
    }

    case 'delete': {
      rejectActionFlags(flags, specOf('delete'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      await client.invoke('batches:delete', ws, id)
      ok({ deleted: id })
    }

    case 'start': {
      rejectActionFlags(flags, specOf('start'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      ok(await client.invoke('batches:start', ws, id))
    }

    case 'pause': {
      rejectActionFlags(flags, specOf('pause'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      ok(await client.invoke('batches:pause', ws, id))
    }

    case 'resume': {
      rejectActionFlags(flags, specOf('resume'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      ok(await client.invoke('batches:resume', ws, id))
    }

    case 'items': {
      rejectActionFlags(flags, specOf('items'))
      const id = positionals[0]
      if (!id) fail('USAGE_ERROR', 'Missing batch id')
      const offset = intFlag(flags, 'offset') ?? 0
      const limit = intFlag(flags, 'limit') ?? 100
      ok(await client.invoke('batches:getItems', ws, id, offset, limit))
    }

    case 'retry-item': {
      rejectActionFlags(flags, specOf('retry-item'))
      const batchId = positionals[0]
      const itemId = positionals[1]
      if (!batchId || !itemId) fail('USAGE_ERROR', 'Usage: batch retry-item <batch-id> <item-id>')
      ok(await client.invoke('batches:retryItem', ws, batchId, itemId))
    }
  }

  fail('USAGE_ERROR', `Unhandled batch action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id>')
  return ws
}
