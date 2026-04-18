import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'fs'
import { RPC_CHANNELS, type SkillFile } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { EntityHandlerDeps } from '../handler-deps'

interface SkillCreateInput {
  name: string
  description: string
  slug?: string
  body?: string
  icon?: string
  globs?: string[]
  alwaysAllow?: string[]
  requiredSources?: string[]
}

interface SkillUpdateInput {
  name?: string
  description?: string
  body?: string
  icon?: string
  globs?: string[]
  alwaysAllow?: string[]
  requiredSources?: string[]
}

function generateSkillSlug(name: string): string {
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

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skills.GET,
  RPC_CHANNELS.skills.GET_FILES,
  RPC_CHANNELS.skills.CREATE,
  RPC_CHANNELS.skills.UPDATE,
  RPC_CHANNELS.skills.DELETE,
  RPC_CHANNELS.skills.WHERE,
  RPC_CHANNELS.skills.VALIDATE,
  RPC_CHANNELS.skills.OPEN_EDITOR,
  RPC_CHANNELS.skills.OPEN_FINDER,
] as const

export function registerSkillsHandlers(server: RpcServer, deps: EntityHandlerDeps): void {
  // Get all skills for a workspace (and optionally project-level skills from workingDirectory)
  server.handle(RPC_CHANNELS.skills.GET, async (_ctx, workspaceId: string, workingDirectory?: string) => {
    deps.platform.logger?.info(`SKILLS_GET: Loading skills for workspace: ${workspaceId}${workingDirectory ? `, workingDirectory: ${workingDirectory}` : ''}`)
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    // Validate workingDirectory exists on this server — a thin client may pass
    // its local path which doesn't exist on the remote server's filesystem.
    const effectiveWorkingDir = workingDirectory && existsSync(workingDirectory)
      ? workingDirectory
      : undefined
    const { loadAllSkills } = await import('@craft-agent/shared/skills')
    const skills = loadAllSkills(workspace.rootPath, effectiveWorkingDir)
    deps.platform.logger?.info(`SKILLS_GET: Loaded ${skills.length} skills from ${workspace.rootPath}`)
    return skills
  })

  // Get files in a skill directory
  server.handle(RPC_CHANNELS.skills.GET_FILES, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET_FILES: Workspace not found: ${workspaceId}`)
      return []
    }

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillSlug)

    function scanDirectory(dirPath: string): SkillFile[] {
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true })
        return entries
          .filter(entry => !entry.name.startsWith('.')) // Skip hidden files
          .map(entry => {
            const fullPath = join(dirPath, entry.name)
            if (entry.isDirectory()) {
              return {
                name: entry.name,
                type: 'directory' as const,
                children: scanDirectory(fullPath),
              }
            } else {
              const stats = statSync(fullPath)
              return {
                name: entry.name,
                type: 'file' as const,
                size: stats.size,
              }
            }
          })
          .sort((a, b) => {
            // Directories first, then files
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
            return a.name.localeCompare(b.name)
          })
      } catch (err) {
        deps.platform.logger?.error(`SKILLS_GET_FILES: Error scanning ${dirPath}:`, err)
        return []
      }
    }

    return scanDirectory(skillDir)
  })

  // Create a workspace-scoped skill (writes SKILL.md under workspace skills dir)
  server.handle(RPC_CHANNELS.skills.CREATE, async (_ctx, workspaceId: string, input: SkillCreateInput) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    if (!input?.name) throw new Error('Missing name')
    if (!input?.description) throw new Error('Missing description')

    const slug = input.slug ?? generateSkillSlug(input.name)
    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')
    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, slug)

    if (existsSync(join(skillDir, 'SKILL.md'))) {
      throw new Error(`Skill '${slug}' already exists`)
    }

    const frontmatter: Record<string, unknown> = { name: input.name, description: input.description }
    if (input.icon) frontmatter.icon = input.icon
    if (input.globs && input.globs.length > 0) frontmatter.globs = input.globs
    if (input.alwaysAllow && input.alwaysAllow.length > 0) frontmatter.alwaysAllow = input.alwaysAllow
    if (input.requiredSources && input.requiredSources.length > 0) frontmatter.requiredSources = input.requiredSources

    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), buildSkillMd(frontmatter, input.body ?? ''), 'utf-8')

    const { invalidateSkillsCache, loadAllSkills } = await import('@craft-agent/shared/skills')
    invalidateSkillsCache()
    pushTyped(server, RPC_CHANNELS.skills.CHANGED, { to: 'workspace', workspaceId }, workspaceId, loadAllSkills(workspace.rootPath))
    return { slug, path: skillDir, metadata: frontmatter }
  })

  // Update an existing skill's frontmatter and/or body (resolves via workspace + project chain)
  server.handle(RPC_CHANNELS.skills.UPDATE, async (_ctx, workspaceId: string, skillSlug: string, input: SkillUpdateInput, projectRoot?: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const effectiveProjectRoot = projectRoot && existsSync(projectRoot) ? projectRoot : undefined
    const { loadSkillBySlug, invalidateSkillsCache } = await import('@craft-agent/shared/skills')
    const skill = loadSkillBySlug(workspace.rootPath, skillSlug, effectiveProjectRoot)
    if (!skill) throw new Error(`Skill '${skillSlug}' not found`)

    const metadata: Record<string, unknown> = {
      name: skill.metadata.name,
      description: skill.metadata.description,
    }
    if (skill.metadata.icon) metadata.icon = skill.metadata.icon
    if (skill.metadata.globs) metadata.globs = skill.metadata.globs
    if (skill.metadata.alwaysAllow) metadata.alwaysAllow = skill.metadata.alwaysAllow
    if (skill.metadata.requiredSources) metadata.requiredSources = skill.metadata.requiredSources

    if (input.name !== undefined) metadata.name = input.name
    if (input.description !== undefined) metadata.description = input.description
    if (input.icon !== undefined) metadata.icon = input.icon
    if (input.globs !== undefined) metadata.globs = input.globs
    if (input.alwaysAllow !== undefined) metadata.alwaysAllow = input.alwaysAllow
    if (input.requiredSources !== undefined) metadata.requiredSources = input.requiredSources

    const body = input.body ?? skill.content
    writeFileSync(join(skill.path, 'SKILL.md'), buildSkillMd(metadata, body), 'utf-8')

    invalidateSkillsCache()
    const { loadAllSkills } = await import('@craft-agent/shared/skills')
    pushTyped(server, RPC_CHANNELS.skills.CHANGED, { to: 'workspace', workspaceId }, workspaceId, loadAllSkills(workspace.rootPath))
    return { slug: skillSlug, path: skill.path, metadata }
  })

  // Delete a skill from a workspace
  server.handle(RPC_CHANNELS.skills.DELETE, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { deleteSkill, invalidateSkillsCache, loadAllSkills } = await import('@craft-agent/shared/skills')
    deleteSkill(workspace.rootPath, skillSlug)
    deps.platform.logger?.info(`Deleted skill: ${skillSlug}`)
    invalidateSkillsCache()
    pushTyped(server, RPC_CHANNELS.skills.CHANGED, { to: 'workspace', workspaceId }, workspaceId, loadAllSkills(workspace.rootPath))
  })

  // Locate a skill across global / workspace / project search paths
  server.handle(RPC_CHANNELS.skills.WHERE, async (_ctx, workspaceId: string, skillSlug: string, projectRoot?: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const { GLOBAL_AGENT_SKILLS_DIR, PROJECT_AGENT_SKILLS_DIR } = await import('@craft-agent/shared/skills')
    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const locations: Array<{ source: string; path: string; exists: boolean }> = []
    const globalPath = join(GLOBAL_AGENT_SKILLS_DIR, skillSlug)
    locations.push({ source: 'global', path: globalPath, exists: existsSync(join(globalPath, 'SKILL.md')) })

    const wsPath = join(getWorkspaceSkillsPath(workspace.rootPath), skillSlug)
    locations.push({ source: 'workspace', path: wsPath, exists: existsSync(join(wsPath, 'SKILL.md')) })

    if (projectRoot && existsSync(projectRoot)) {
      const projPath = join(projectRoot, PROJECT_AGENT_SKILLS_DIR, skillSlug)
      locations.push({ source: 'project', path: projPath, exists: existsSync(join(projPath, 'SKILL.md')) })
    }

    const active = locations.filter(l => l.exists).pop()
    return { slug: skillSlug, locations, active: active ?? null }
  })

  // Validate a skill's frontmatter (required fields, globs, icon)
  server.handle(RPC_CHANNELS.skills.VALIDATE, async (_ctx, workspaceId: string, skillSlug: string, projectRoot?: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const effectiveProjectRoot = projectRoot && existsSync(projectRoot) ? projectRoot : undefined
    const { loadSkillBySlug } = await import('@craft-agent/shared/skills')
    const skill = loadSkillBySlug(workspace.rootPath, skillSlug, effectiveProjectRoot)
    if (!skill) throw new Error(`Skill '${skillSlug}' not found`)

    const errors: string[] = []
    if (!skill.metadata.name) errors.push('Missing name in frontmatter')
    if (!skill.metadata.description) errors.push('Missing description in frontmatter')
    if (skill.metadata.globs) {
      for (const glob of skill.metadata.globs) {
        if (typeof glob !== 'string' || glob.trim().length === 0) {
          errors.push(`Invalid glob pattern: ${JSON.stringify(glob)}`)
        }
      }
    }
    if (skill.metadata.icon && typeof skill.metadata.icon !== 'string') {
      errors.push('Icon must be a string (emoji or URL)')
    }

    return { valid: errors.length === 0, slug: skillSlug, source: skill.source, errors }
  })

  // Open skill SKILL.md in editor
  server.handle(RPC_CHANNELS.skills.OPEN_EDITOR, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Open in editor is not available for remote workspaces')

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillFile = join(skillsDir, skillSlug, 'SKILL.md')
    await deps.platform.openPath?.(skillFile)
  })

  // Open skill folder in Finder/Explorer
  server.handle(RPC_CHANNELS.skills.OPEN_FINDER, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Show in Finder is not available for remote workspaces')

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillSlug)
    await deps.platform.showItemInFolder?.(skillDir)
  })
}
