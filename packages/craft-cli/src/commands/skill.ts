/**
 * Skill commands — 7 subcommands
 *
 * Storage: Filesystem (SKILL.md with YAML frontmatter)
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ok, fail, warn } from '../envelope.ts'
import { strFlag, boolFlag, listFlag } from '../args.ts'
import { parseInput } from '../input.ts'
import {
  loadAllSkills,
  loadSkillBySlug,
  deleteSkill,
  GLOBAL_AGENT_SKILLS_DIR,
  PROJECT_AGENT_SKILLS_DIR,
} from '@craft-agent/shared/skills'
import { getWorkspaceSkillsPath } from '@craft-agent/shared/workspaces'
import type { LoadedSkill } from '@craft-agent/shared/skills/types'

export function routeSkill(
  ws: string,
  action: string | undefined,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  if (!action) ok({
    usage: 'datapilot skill <action> [args] [--flags]',
    actions: ['list', 'get', 'where', 'create', 'update', 'delete', 'validate'],
  })

  const projectRoot = strFlag(flags, 'project-root') ?? process.cwd()

  switch (action) {
    case 'list': return cmdList(ws, projectRoot, flags)
    case 'get': return cmdGet(ws, projectRoot, positionals)
    case 'where': return cmdWhere(ws, projectRoot, positionals)
    case 'create': return cmdCreate(ws, flags)
    case 'update': return cmdUpdate(ws, projectRoot, positionals, flags)
    case 'delete': return cmdDelete(ws, positionals)
    case 'validate': return cmdValidate(ws, projectRoot, positionals, flags)
    default:
      fail('USAGE_ERROR', `Unknown skill action: ${action}`)
  }
}

// ─── list ────────────────────────────────────────────────────────────────────

function cmdList(
  ws: string,
  projectRoot: string,
  flags: Record<string, string | boolean | string[]>,
): void {
  const workspaceOnly = boolFlag(flags, 'workspace-only') ?? false
  const allSkills = loadAllSkills(ws, projectRoot)
  const skills = workspaceOnly
    ? allSkills.filter(s => s.source === 'workspace')
    : allSkills

  ok(skills.map((s: LoadedSkill) => ({
    slug: s.slug,
    name: s.metadata.name,
    description: s.metadata.description,
    source: s.source,
    path: s.path,
    globs: s.metadata.globs,
    alwaysAllow: s.metadata.alwaysAllow,
    requiredSources: s.metadata.requiredSources,
  })))
}

// ─── get ─────────────────────────────────────────────────────────────────────

function cmdGet(ws: string, projectRoot: string, positionals: string[]): void {
  const slug = positionals[0]
  if (!slug) fail('USAGE_ERROR', 'Missing skill slug', 'datapilot skill get <slug>')

  const skill = loadSkillBySlug(ws, slug, projectRoot)
  if (!skill) fail('NOT_FOUND', `Skill '${slug}' not found`)
  ok({
    slug: skill.slug,
    metadata: skill.metadata,
    content: skill.content,
    source: skill.source,
    path: skill.path,
  })
}

// ─── where ───────────────────────────────────────────────────────────────────

function cmdWhere(ws: string, projectRoot: string, positionals: string[]): void {
  const slug = positionals[0]
  if (!slug) fail('USAGE_ERROR', 'Missing skill slug', 'datapilot skill where <slug>')

  const locations: Array<{ source: string; path: string; exists: boolean }> = []

  // Check global
  const globalPath = join(GLOBAL_AGENT_SKILLS_DIR, slug)
  locations.push({ source: 'global', path: globalPath, exists: existsSync(join(globalPath, 'SKILL.md')) })

  // Check workspace
  const wsPath = join(getWorkspaceSkillsPath(ws), slug)
  locations.push({ source: 'workspace', path: wsPath, exists: existsSync(join(wsPath, 'SKILL.md')) })

  // Check project
  const projPath = join(projectRoot, PROJECT_AGENT_SKILLS_DIR, slug)
  locations.push({ source: 'project', path: projPath, exists: existsSync(join(projPath, 'SKILL.md')) })

  // Active = highest priority existing
  const active = locations.filter(l => l.exists).pop()

  ok({ slug, locations, active: active ?? null })
}

// ─── create ──────────────────────────────────────────────────────────────────

function cmdCreate(
  ws: string,
  flags: Record<string, string | boolean | string[]>,
): void {
  const input = parseInput(flags)

  const name = (input?.name as string) ?? strFlag(flags, 'name')
  if (!name) fail('USAGE_ERROR', 'Missing --name')

  const description = (input?.description as string) ?? strFlag(flags, 'description')
  if (!description) fail('USAGE_ERROR', 'Missing --description')

  // Generate slug from name or use explicit
  const slug = (input?.slug as string) ?? strFlag(flags, 'slug') ?? generateSlug(name)

  const skillsDir = getWorkspaceSkillsPath(ws)
  const skillDir = join(skillsDir, slug)

  if (existsSync(join(skillDir, 'SKILL.md'))) {
    fail('VALIDATION_ERROR', `Skill '${slug}' already exists`)
  }

  const body = (input?.body as string) ?? strFlag(flags, 'body') ?? ''
  const icon = (input?.icon as string) ?? strFlag(flags, 'icon')
  const globs = (input?.globs as string[]) ?? listFlag(flags, 'globs')
  const alwaysAllow = (input?.alwaysAllow as string[]) ?? listFlag(flags, 'always-allow')
  const requiredSources = (input?.requiredSources as string[]) ?? listFlag(flags, 'required-sources')

  // Build frontmatter
  const frontmatter: Record<string, unknown> = { name, description }
  if (icon) frontmatter.icon = icon
  if (globs && globs.length > 0) frontmatter.globs = globs
  if (alwaysAllow && alwaysAllow.length > 0) frontmatter.alwaysAllow = alwaysAllow
  if (requiredSources && requiredSources.length > 0) frontmatter.requiredSources = requiredSources

  const content = buildSkillMd(frontmatter, body)

  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8')

  ok({ slug, path: skillDir, metadata: frontmatter })
}

// ─── update ──────────────────────────────────────────────────────────────────

function cmdUpdate(
  ws: string,
  projectRoot: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const slug = positionals[0]
  if (!slug) fail('USAGE_ERROR', 'Missing skill slug', 'datapilot skill update <slug> --json \'{...}\'')

  const skill = loadSkillBySlug(ws, slug, projectRoot)
  if (!skill) fail('NOT_FOUND', `Skill '${slug}' not found`)

  const input = parseInput(flags)
  if (!input) fail('USAGE_ERROR', 'Missing --json or --stdin input for update')

  // Merge updates into metadata
  const metadata: Record<string, unknown> = {
    name: skill.metadata.name,
    description: skill.metadata.description,
  }
  if (skill.metadata.icon) metadata.icon = skill.metadata.icon
  if (skill.metadata.globs) metadata.globs = skill.metadata.globs
  if (skill.metadata.alwaysAllow) metadata.alwaysAllow = skill.metadata.alwaysAllow
  if (skill.metadata.requiredSources) metadata.requiredSources = skill.metadata.requiredSources

  // Apply updates from input
  if (input.name) metadata.name = input.name
  if (input.description) metadata.description = input.description
  if (input.icon) metadata.icon = input.icon
  if (input.globs) metadata.globs = input.globs
  if (input.alwaysAllow) metadata.alwaysAllow = input.alwaysAllow
  if (input.requiredSources) metadata.requiredSources = input.requiredSources

  const body = (input.body as string) ?? skill.content
  const content = buildSkillMd(metadata, body)

  writeFileSync(join(skill.path, 'SKILL.md'), content, 'utf-8')
  ok({ slug, path: skill.path, metadata })
}

// ─── delete ──────────────────────────────────────────────────────────────────

function cmdDelete(ws: string, positionals: string[]): void {
  const slug = positionals[0]
  if (!slug) fail('USAGE_ERROR', 'Missing skill slug', 'datapilot skill delete <slug>')

  const deleted = deleteSkill(ws, slug)
  if (!deleted) fail('NOT_FOUND', `Skill '${slug}' not found`)
  ok({ deleted: slug })
}

// ─── validate ────────────────────────────────────────────────────────────────

function cmdValidate(
  ws: string,
  projectRoot: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  const slug = positionals[0]
  if (!slug) fail('USAGE_ERROR', 'Missing skill slug', 'datapilot skill validate <slug>')

  const sourceFlag = strFlag(flags, 'source')

  // Load from specific source or auto-resolve
  let skill: LoadedSkill | null = null
  if (sourceFlag === 'global') {
    const globalPath = join(GLOBAL_AGENT_SKILLS_DIR, slug, 'SKILL.md')
    if (existsSync(globalPath)) {
      skill = loadSkillBySlug(ws, slug) // Will find it in resolution chain
    }
  } else {
    skill = loadSkillBySlug(ws, slug, projectRoot)
  }

  if (!skill) fail('NOT_FOUND', `Skill '${slug}' not found`)

  const errors: string[] = []

  // Required fields
  if (!skill.metadata.name) errors.push('Missing name in frontmatter')
  if (!skill.metadata.description) errors.push('Missing description in frontmatter')

  // Validate globs
  if (skill.metadata.globs) {
    for (const glob of skill.metadata.globs) {
      if (typeof glob !== 'string' || glob.trim().length === 0) {
        errors.push(`Invalid glob pattern: ${JSON.stringify(glob)}`)
      }
    }
  }

  // Validate icon
  if (skill.metadata.icon) {
    if (typeof skill.metadata.icon !== 'string') {
      errors.push('Icon must be a string (emoji or URL)')
    }
  }

  ok({ valid: errors.length === 0, slug, source: skill.source, errors })
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30)
}

function buildSkillMd(frontmatter: Record<string, unknown>, body: string): string {
  const yamlLines: string[] = ['---']
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      yamlLines.push(`${key}:`)
      for (const item of value) {
        yamlLines.push(`  - ${JSON.stringify(item)}`)
      }
    } else {
      yamlLines.push(`${key}: ${JSON.stringify(value)}`)
    }
  }
  yamlLines.push('---')
  yamlLines.push('')
  if (body) yamlLines.push(body)
  return yamlLines.join('\n')
}
