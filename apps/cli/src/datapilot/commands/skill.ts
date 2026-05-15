/**
 * skill entity — wraps the skills:* RPC channels.
 *
 * Flag rule: `create` keeps only `--name` (identity). `--description`, `body`,
 * `globs`, `requiredSources`, etc. flow through `--input '<json>'`. The server
 * (packages/server-core/src/handlers/rpc/skills.ts:145) auto-generates the
 * slug from `input.name` when not supplied, so there's no `--slug` flat flag;
 * pass `slug` inside `--input` to override.
 */

import { ok, fail } from '../envelope.ts'
import { strFlag, parseInput, type Flags } from '../args.ts'
import type { RouteCtx } from '../router.ts'
import { rejectActionFlags, type ActionSpec, type EntitySpec } from '../help.ts'

export const SKILL_SPEC: EntitySpec = {
  name: 'skill',
  description: 'Workspace skills (reusable prompt + context bundles)',
  actions: [
    {
      name: 'list',
      description: 'List all skills in the workspace',
      flags: [],
      example: 'datapilot skill list',
    },
    {
      name: 'get',
      description: 'Show one skill',
      positionals: [{ name: 'slug', description: 'Skill slug' }],
      flags: [],
      example: 'datapilot skill get my-skill',
    },
    {
      name: 'create',
      description: 'Create a new skill (description, body, globs, requiredSources go in --input)',
      flags: [{ name: 'name', type: 'string', required: true, description: 'Skill display name (slug auto-generated)' }],
      takesInput: true,
      example: 'datapilot skill create --name "Triage" --input \'{"description":"Sort incoming items"}\'',
    },
    {
      name: 'update',
      description: 'Update skill fields',
      positionals: [{ name: 'slug', description: 'Skill slug' }],
      flags: [],
      takesInput: true,
      example: 'datapilot skill update my-skill --input \'{"body":"..."}\'',
    },
    {
      name: 'delete',
      description: 'Delete a skill',
      positionals: [{ name: 'slug', description: 'Skill slug' }],
      flags: [],
      example: 'datapilot skill delete my-skill',
    },
  ],
}

function specOf(action: string): ActionSpec {
  return SKILL_SPEC.actions.find((a) => a.name === action)!
}

export async function routeSkill(
  ctx: RouteCtx,
  action: string | undefined,
  positionals: string[],
  flags: Flags,
): Promise<never> {
  if (!action) ok({ entity: 'skill', actions: SKILL_SPEC.actions.map((a) => a.name) })
  if (!SKILL_SPEC.actions.some((a) => a.name === action)) {
    fail('USAGE_ERROR', `Unknown skill action: ${action}`, {
      suggestion: `Valid actions: ${SKILL_SPEC.actions.map((a) => a.name).join(', ')}`,
    })
  }

  const ws = await requireWorkspace(ctx)
  const client = await ctx.getClient()

  switch (action) {
    case 'list':
      rejectActionFlags(flags, specOf('list'))
      ok(await client.invoke('skills:get', ws))

    case 'get': {
      rejectActionFlags(flags, specOf('get'))
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing skill slug')
      const list = (await client.invoke('skills:get', ws)) as Array<{ slug: string }>
      const found = list.find((s) => s.slug === slug)
      if (!found) fail('NOT_FOUND', `Skill '${slug}' not found`)
      ok(found)
    }

    case 'create': {
      rejectActionFlags(flags, specOf('create'))
      const input = (await parseInput(flags)) ?? {}
      const name = strFlag(flags, 'name') ?? (input.name as string | undefined)
      if (!name) fail('USAGE_ERROR', 'Missing --name')
      ok(await client.invoke('skills:create', ws, { ...input, name }))
    }

    case 'update': {
      rejectActionFlags(flags, specOf('update'))
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing skill slug')
      const input = (await parseInput(flags)) ?? {}
      ok(await client.invoke('skills:update', ws, slug, input))
    }

    case 'delete': {
      rejectActionFlags(flags, specOf('delete'))
      const slug = positionals[0]
      if (!slug) fail('USAGE_ERROR', 'Missing skill slug')
      await client.invoke('skills:delete', ws, slug)
      ok({ deleted: slug })
    }
  }

  fail('USAGE_ERROR', `Unhandled skill action: ${action}`)
}

async function requireWorkspace(ctx: RouteCtx): Promise<string> {
  const ws = await ctx.getWorkspace()
  if (!ws) fail('VALIDATION_ERROR', 'No workspace available — pass --workspace <id>')
  return ws
}
