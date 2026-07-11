/**
 * Project Storage — SQLite Backend
 *
 * Drop-in replacement for storage.ts with identical exported function
 * signatures. Project configs live in the workspace.db `projects` table so
 * id lookups are indexed (loadProjectById was an O(n) directory scan) and
 * project filters/joins against sessions.project_id stay in SQL.
 *
 * The project folder `{workspaceRootPath}/projects/{slug}/` remains the
 * on-disk home for assets/ and MEMORY.md — those are agent-facing artifacts
 * read and written through filesystem paths, so all path helpers and
 * asset/memory operations stay filesystem-based (re-exported from storage.ts).
 *
 * Pre-existing `config.json` files are imported once on first access (only
 * while the projects table is empty) and renamed to `config.json.migrated`
 * so a later empty table is never repopulated from stale files.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { basename, extname, join } from 'path';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { getWorkspaceDb } from '../db/connection.ts';
import { projects } from '../db/schema/projects.sql.ts';
import { readJsonFileSync, getMimeType } from '../utils/files.ts';
import { debug } from '../utils/debug.ts';
import { expandPath, toPortablePath } from '../utils/paths.ts';
import {
  getWorkspaceProjectsPath,
  getProjectPath,
  getProjectAssetsPath,
  ensureProjectAssetsDir,
  sanitizeAssetFilename,
  type UploadProjectAssetInput,
} from './storage.ts';
import type {
  ProjectConfig,
  ProjectAsset,
  LoadedProject,
  CreateProjectInput,
  KanbanColumnDef,
} from './types.ts';

// Filesystem-only operations are unchanged — the project folder keeps hosting
// assets/ and MEMORY.md, so the file-based implementations remain canonical.
export {
  getWorkspaceProjectsPath,
  getProjectPath,
  getProjectAssetsPath,
  getProjectMemoryPath,
  ensureProjectsDir,
  ensureProjectAssetsDir,
  MEMORY_FILENAME,
  loadProjectMemory,
  listProjectAssets,
  deleteProjectAsset,
  sanitizeAssetFilename,
} from './storage.ts';

export type { UploadProjectAssetInput } from './storage.ts';

// ============================================================
// Row Converters
// ============================================================

type ProjectRow = typeof projects.$inferSelect;

function rowToProjectConfig(row: ProjectRow): ProjectConfig {
  const config: ProjectConfig = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.description != null) config.description = row.description;
  // Expand portable paths on read so consumers always see absolute paths.
  if (row.workingDirectory != null) config.workingDirectory = expandPath(row.workingDirectory);
  if (row.details != null) config.details = row.details;
  if (row.colorTheme != null) config.colorTheme = row.colorTheme;
  if (row.color != null) config.color = row.color;
  if (row.archivedAt != null) config.archivedAt = row.archivedAt;
  if (row.kanbanColumns != null) config.kanbanColumns = row.kanbanColumns as KanbanColumnDef[];
  return config;
}

function projectConfigToRow(config: ProjectConfig): typeof projects.$inferInsert {
  return {
    id: config.id,
    slug: config.slug,
    name: config.name,
    description: config.description ?? null,
    workingDirectory: config.workingDirectory ? toPortablePath(config.workingDirectory) : null,
    details: config.details ?? null,
    colorTheme: config.colorTheme ?? null,
    color: config.color ?? null,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
    archivedAt: config.archivedAt ?? null,
    kanbanColumns: config.kanbanColumns ?? null,
  };
}

// ============================================================
// Legacy Import (config.json → projects table, once)
// ============================================================

/** Workspaces already checked for legacy configs this process. */
const legacyImportChecked = new Set<string>();

/**
 * Import pre-DB `config.json` files into the projects table.
 *
 * Runs at most once per workspace per process, and only inserts while the
 * table is empty — an empty table with only `.migrated` files (e.g. after the
 * user deleted every project) is never repopulated. Imported files are renamed
 * to `config.json.migrated` so they stay recoverable but inert.
 */
function ensureLegacyImport(workspaceRootPath: string): void {
  if (legacyImportChecked.has(workspaceRootPath)) return;
  legacyImportChecked.add(workspaceRootPath);

  const db = getWorkspaceDb(workspaceRootPath);
  const hasRows = db.select({ id: projects.id }).from(projects).limit(1).get();
  if (hasRows) return;

  const projectsDir = getWorkspaceProjectsPath(workspaceRootPath);
  if (!existsSync(projectsDir)) return;

  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const configPath = join(projectsDir, entry.name, 'config.json');
    if (!existsSync(configPath)) continue;

    try {
      // Raw read, no expandPath: legacy files store workingDirectory in
      // portable form, which is exactly the DB storage format — and
      // toPortablePath is a no-op on already-portable values.
      const config = readJsonFileSync<ProjectConfig>(configPath);
      if (!config?.id || !config?.name) {
        debug('[projects.db] Skipping legacy config without id/name:', entry.name);
        continue;
      }
      db.insert(projects)
        // The directory name is the on-disk key for assets/ and MEMORY.md,
        // so it wins over a diverged config.slug.
        .values(projectConfigToRow({ ...config, slug: entry.name }))
        .onConflictDoNothing()
        .run();
      renameSync(configPath, `${configPath}.migrated`);
    } catch (error) {
      debug('[projects.db] Failed to import legacy project config:', entry.name, error);
    }
  }
}

// ============================================================
// Config Operations
// ============================================================

/**
 * Load a project config by slug.
 * Returns null if the project does not exist.
 */
export function loadProjectConfig(
  workspaceRootPath: string,
  projectSlug: string,
): ProjectConfig | null {
  ensureLegacyImport(workspaceRootPath);
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select().from(projects).where(eq(projects.slug, projectSlug)).get();
  return row ? rowToProjectConfig(row) : null;
}

/**
 * Save a project config (bumps updatedAt, upserts by id).
 * Also ensures the project folder exists — it hosts assets/ and MEMORY.md.
 */
export function saveProjectConfig(workspaceRootPath: string, config: ProjectConfig): void {
  ensureLegacyImport(workspaceRootPath);

  const dir = getProjectPath(workspaceRootPath, config.slug);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const row = projectConfigToRow({ ...config, updatedAt: Date.now() });
  const db = getWorkspaceDb(workspaceRootPath);
  db.insert(projects)
    .values(row)
    .onConflictDoUpdate({ target: projects.id, set: row })
    .run();
}

// ============================================================
// Load Operations
// ============================================================

/**
 * Load a single project by slug.
 */
export function loadProject(
  workspaceRootPath: string,
  projectSlug: string,
): LoadedProject | null {
  const config = loadProjectConfig(workspaceRootPath, projectSlug);
  if (!config) return null;
  return toLoadedProject(workspaceRootPath, config);
}

/**
 * Load a project by id (indexed primary-key lookup).
 * Slugs are unique within a workspace, but callers may persist the project id
 * on a session (more stable across renames).
 */
export function loadProjectById(
  workspaceRootPath: string,
  projectId: string,
): LoadedProject | null {
  ensureLegacyImport(workspaceRootPath);
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select().from(projects).where(eq(projects.id, projectId)).get();
  return row ? toLoadedProject(workspaceRootPath, rowToProjectConfig(row)) : null;
}

/**
 * Load all projects for a workspace (sorted by slug, matching the legacy
 * directory-enumeration order).
 */
export function loadWorkspaceProjects(workspaceRootPath: string): LoadedProject[] {
  ensureLegacyImport(workspaceRootPath);
  const db = getWorkspaceDb(workspaceRootPath);
  const rows = db.select().from(projects).orderBy(projects.slug).all();
  return rows.map((row) => toLoadedProject(workspaceRootPath, rowToProjectConfig(row)));
}

function toLoadedProject(workspaceRootPath: string, config: ProjectConfig): LoadedProject {
  return {
    config,
    folderPath: getProjectPath(workspaceRootPath, config.slug),
    assetsPath: getProjectAssetsPath(workspaceRootPath, config.slug),
    workspaceRootPath,
    workspaceId: basename(workspaceRootPath),
  };
}

// ============================================================
// Create / Update / Delete
// ============================================================

/**
 * Generate a URL-safe, workspace-unique project slug.
 * Checks both the projects table and leftover folders — the slug doubles as
 * the on-disk directory name, so a folder restored from backup blocks it too.
 */
export function generateProjectSlug(workspaceRootPath: string, name: string): string {
  ensureLegacyImport(workspaceRootPath);

  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  if (!slug) slug = 'project';

  const db = getWorkspaceDb(workspaceRootPath);
  const existingSlugs = new Set<string>(
    db.select({ slug: projects.slug }).from(projects).all().map((r) => r.slug),
  );
  const projectsDir = getWorkspaceProjectsPath(workspaceRootPath);
  if (existsSync(projectsDir)) {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) existingSlugs.add(entry.name);
    }
  }

  if (!existingSlugs.has(slug)) return slug;

  let counter = 2;
  while (existingSlugs.has(`${slug}-${counter}`)) counter++;
  return `${slug}-${counter}`;
}

/**
 * Create a new project in a workspace.
 */
export function createProject(
  workspaceRootPath: string,
  input: CreateProjectInput,
): ProjectConfig {
  const slug = generateProjectSlug(workspaceRootPath, input.name);
  const now = Date.now();

  const config: ProjectConfig = {
    id: `proj_${randomUUID().slice(0, 8)}`,
    slug,
    name: input.name,
    description: input.description,
    workingDirectory: input.workingDirectory,
    details: input.details,
    colorTheme: input.colorTheme,
    createdAt: now,
    updatedAt: now,
  };

  saveProjectConfig(workspaceRootPath, config);
  ensureProjectAssetsDir(workspaceRootPath, slug);

  return config;
}

/**
 * Update a project's config with a partial patch.
 * `id` and `slug` cannot be changed.
 */
export function updateProject(
  workspaceRootPath: string,
  projectSlug: string,
  patch: Partial<Omit<ProjectConfig, 'id' | 'slug' | 'createdAt'>>,
): ProjectConfig {
  const existing = loadProjectConfig(workspaceRootPath, projectSlug);
  if (!existing) {
    throw new Error(`Project not found: ${projectSlug}`);
  }

  const updated: ProjectConfig = {
    ...existing,
    ...patch,
    id: existing.id,
    slug: existing.slug,
    createdAt: existing.createdAt,
    updatedAt: Date.now(),
  };

  saveProjectConfig(workspaceRootPath, updated);
  return updated;
}

/**
 * Delete a project (removes the DB row, then the folder with all assets).
 * Caller is responsible for unsetting `projectId` on sessions that referenced it.
 */
export function deleteProject(workspaceRootPath: string, projectSlug: string): void {
  ensureLegacyImport(workspaceRootPath);
  const db = getWorkspaceDb(workspaceRootPath);
  db.delete(projects).where(eq(projects.slug, projectSlug)).run();

  const dir = getProjectPath(workspaceRootPath, projectSlug);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
  }
}

/**
 * Check if a project exists in a workspace.
 */
export function projectExists(workspaceRootPath: string, projectSlug: string): boolean {
  return loadProjectConfig(workspaceRootPath, projectSlug) !== null;
}

// ============================================================
// Asset Operations
// ============================================================
// Only uploadProjectAsset is reimplemented: the file-based version gates on a
// config.json existence check, which is now a DB lookup. The write path is
// unchanged — assets are plain files under the project folder.

/**
 * Upload (write) an asset into the project's assets directory.
 * Accepts base64, text, or a sourcePath to copy from.
 * Resolves filename collisions by appending `-{n}` before the extension.
 */
export function uploadProjectAsset(
  workspaceRootPath: string,
  projectSlug: string,
  input: UploadProjectAssetInput,
): ProjectAsset {
  if (!projectExists(workspaceRootPath, projectSlug)) {
    throw new Error(`Project not found: ${projectSlug}`);
  }

  ensureProjectAssetsDir(workspaceRootPath, projectSlug);

  const safeName = sanitizeAssetFilename(input.filename);
  const assetsDir = getProjectAssetsPath(workspaceRootPath, projectSlug);
  const targetPath = resolveUniqueAssetPath(assetsDir, safeName);

  if (input.base64 !== undefined) {
    writeFileSync(targetPath, Buffer.from(input.base64, 'base64'));
  } else if (input.text !== undefined) {
    writeFileSync(targetPath, input.text, 'utf-8');
  } else if (input.sourcePath) {
    if (!existsSync(input.sourcePath)) {
      throw new Error(`Source file does not exist: ${input.sourcePath}`);
    }
    const data = readFileSync(input.sourcePath);
    writeFileSync(targetPath, data);
  } else {
    throw new Error('uploadProjectAsset requires one of: base64, text, sourcePath');
  }

  const stats = statSync(targetPath);
  return {
    filename: basename(targetPath),
    sizeBytes: stats.size,
    mimeType: getMimeType(targetPath),
    uploadedAt: stats.mtimeMs,
    absolutePath: targetPath,
  };
}

/**
 * Resolve a target path inside `assetsDir` that does not collide with existing files.
 * Returns the original name if free; otherwise appends `-2`, `-3`, ... before the extension.
 */
function resolveUniqueAssetPath(assetsDir: string, filename: string): string {
  const candidate = join(assetsDir, filename);
  if (!existsSync(candidate)) return candidate;

  const ext = extname(filename);
  const stem = ext ? filename.slice(0, -ext.length) : filename;

  let counter = 2;
  while (existsSync(join(assetsDir, `${stem}-${counter}${ext}`))) counter++;
  return join(assetsDir, `${stem}-${counter}${ext}`);
}
