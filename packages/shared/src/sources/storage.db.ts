/**
 * Source Storage — SQLite Backend
 *
 * Drop-in replacement for storage.ts with identical exported function signatures.
 * Reads/writes source configuration and guides from workspace.db instead of
 * {workspace}/sources/{slug}/config.json and guide.md.
 *
 * Icon handling remains filesystem-based (sources/{slug}/icon.*).
 */

import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, basename } from 'path';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import type {
  FolderSourceConfig,
  SourceGuide,
  LoadedSource,
  CreateSourceInput,
} from './types.ts';
import { validateSourceConfig } from '../config/validators.ts';
import { debug } from '../utils/debug.ts';
import { getBuiltinSources, isBuiltinSource, getDocsSource } from './builtin-sources.ts';
import { expandPath, toPortablePath } from '../utils/paths.ts';
import { getWorkspaceSourcesPath } from '../workspaces/storage.ts';
import {
  validateIconValue,
  findIconFile,
  downloadIcon,
  needsIconDownload,
  isIconUrl,
} from '../utils/icon.ts';
import { sources as sourcesTable } from '../db/schema/sources.sql.ts';
import { getWorkspaceDb } from '../db/connection.ts';
import { dbEvents } from '../db/events.ts';

// Re-export icon utilities for convenience
export { isIconUrl } from '../utils/icon.ts';

// ============================================================
// Directory Utilities (unchanged — still needed for icon files)
// ============================================================

/**
 * Get path to a source folder within a workspace
 */
export function getSourcePath(workspaceRootPath: string, sourceSlug: string): string {
  return join(getWorkspaceSourcesPath(workspaceRootPath), sourceSlug);
}

/**
 * Ensure sources directory exists for a workspace
 */
export function ensureSourcesDir(workspaceRootPath: string): void {
  const dir = getWorkspaceSourcesPath(workspaceRootPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ============================================================
// Config Operations (SQLite)
// ============================================================

/**
 * Load source config from DB
 */
export function loadSourceConfig(
  workspaceRootPath: string,
  sourceSlug: string
): FolderSourceConfig | null {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select().from(sourcesTable).where(eq(sourcesTable.slug, sourceSlug)).get();
  if (!row) return null;

  const config = row.config as FolderSourceConfig;

  // Expand path variables in local source paths for portability
  if (config.type === 'local' && config.local?.path) {
    config.local.path = expandPath(config.local.path);
  }

  return config;
}

/**
 * Mark a source as authenticated and connected.
 * Updates isAuthenticated, connectionStatus, and clears any connection error.
 *
 * @returns true if the source was found and updated, false otherwise
 */
export function markSourceAuthenticated(
  workspaceRootPath: string,
  sourceSlug: string
): boolean {
  const config = loadSourceConfig(workspaceRootPath, sourceSlug);
  if (!config) {
    debug(`[markSourceAuthenticated] Source ${sourceSlug} not found`);
    return false;
  }

  config.isAuthenticated = true;
  config.connectionStatus = 'connected';
  config.connectionError = undefined;

  saveSourceConfig(workspaceRootPath, config);
  debug(`[markSourceAuthenticated] Marked ${sourceSlug} as authenticated`);
  return true;
}

/**
 * Save source config to DB
 * @throws Error if config is invalid
 */
export function saveSourceConfig(
  workspaceRootPath: string,
  config: FolderSourceConfig
): void {
  // Validate config before writing
  const validation = validateSourceConfig(config);
  if (!validation.valid) {
    const errorMessages = validation.errors.map((e) => `${e.path}: ${e.message}`).join(', ');
    debug('[saveSourceConfig] Validation failed:', errorMessages);
    throw new Error(`Invalid source config: ${errorMessages}`);
  }

  // Convert local source paths to portable form
  const storageConfig: FolderSourceConfig = { ...config, updatedAt: Date.now() };
  if (storageConfig.type === 'local' && storageConfig.local?.path) {
    storageConfig.local = {
      ...storageConfig.local,
      path: toPortablePath(storageConfig.local.path),
    };
  }

  const db = getWorkspaceDb(workspaceRootPath);
  const existing = db.select().from(sourcesTable).where(eq(sourcesTable.slug, config.slug)).get();

  if (existing) {
    db.update(sourcesTable)
      .set({
        name: storageConfig.name,
        type: storageConfig.type,
        config: storageConfig,
        updatedAt: storageConfig.updatedAt,
      })
      .where(eq(sourcesTable.slug, config.slug))
      .run();
  } else {
    db.insert(sourcesTable)
      .values({
        slug: storageConfig.slug,
        name: storageConfig.name,
        type: storageConfig.type,
        config: storageConfig,
        createdAt: storageConfig.createdAt ?? Date.now(),
        updatedAt: storageConfig.updatedAt,
      })
      .run();
  }

  dbEvents.emit('source:saved', config.slug);
}

// ============================================================
// Guide Operations (SQLite)
// ============================================================

/**
 * Parse guide markdown.
 * Extracts sections (Scope, Guidelines, Context, API Notes) and Cache (JSON in code block).
 */
export function parseGuideMarkdown(raw: string): SourceGuide {
  const guide: SourceGuide = { raw };

  // Extract sections by headers (including Cache)
  const sectionRegex = /^## (Scope|Guidelines|Context|API Notes|Cache)\n([\s\S]*?)(?=\n## |\Z)/gim;
  let match;
  while ((match = sectionRegex.exec(raw)) !== null) {
    const sectionName = (match[1] ?? '').toLowerCase().replace(/\s+/g, '');
    const content = (match[2] ?? '').trim();

    switch (sectionName) {
      case 'scope':
        guide.scope = content;
        break;
      case 'guidelines':
        guide.guidelines = content;
        break;
      case 'context':
        guide.context = content;
        break;
      case 'apinotes':
        guide.apiNotes = content;
        break;
      case 'cache':
        // Parse JSON from code block: ```json ... ```
        const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
        if (jsonMatch && jsonMatch[1]) {
          try {
            guide.cache = JSON.parse(jsonMatch[1]);
          } catch {
            // Invalid JSON, ignore
          }
        }
        break;
    }
  }

  return guide;
}

/**
 * Load and parse guide from DB
 */
export function loadSourceGuide(workspaceRootPath: string, sourceSlug: string): SourceGuide | null {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select().from(sourcesTable).where(eq(sourcesTable.slug, sourceSlug)).get();
  if (!row) return null;

  // Return parsed guide from JSON column if available
  if (row.guide) return row.guide as SourceGuide;

  // Fall back to raw markdown if guide JSON is missing but guideRaw exists
  if (row.guideRaw) return parseGuideMarkdown(row.guideRaw);

  return null;
}

/**
 * Extract a short tagline from guide.md content
 * Looks for the first non-empty paragraph after the title, or falls back to scope section
 * @returns Tagline string (max 100 chars) or null if not found
 */
export function extractTagline(guide: SourceGuide | null): string | null {
  if (!guide?.raw) return null;

  const content = guide.raw;

  // Try to get first paragraph after the title (# Title)
  const titleMatch = content.match(/^#[^\n]+\n+([^\n#][^\n]*)/);
  if (titleMatch?.[1]?.trim()) {
    const tagline = titleMatch[1].trim();
    if (!tagline.startsWith('##') && !tagline.startsWith('(')) {
      return tagline.slice(0, 100);
    }
  }

  // Fallback to first line of scope section
  if (guide.scope) {
    const firstLine = guide.scope.split('\n')[0]?.trim();
    if (firstLine && !firstLine.startsWith('(')) {
      return firstLine.slice(0, 100);
    }
  }

  return null;
}

/**
 * Save guide to DB (both parsed JSON and raw markdown)
 */
export function saveSourceGuide(
  workspaceRootPath: string,
  sourceSlug: string,
  guide: SourceGuide
): void {
  const db = getWorkspaceDb(workspaceRootPath);
  const existing = db.select().from(sourcesTable).where(eq(sourcesTable.slug, sourceSlug)).get();

  if (existing) {
    db.update(sourcesTable)
      .set({
        guide: guide,
        guideRaw: guide.raw,
        updatedAt: Date.now(),
      })
      .where(eq(sourcesTable.slug, sourceSlug))
      .run();
  }

  dbEvents.emit('source:saved', sourceSlug);
}

// ============================================================
// Icon Operations (filesystem-based, unchanged)
// ============================================================

/**
 * Find icon file for a source
 * Returns absolute path to icon file or undefined
 */
export function findSourceIcon(workspaceRootPath: string, sourceSlug: string): string | undefined {
  return findIconFile(getSourcePath(workspaceRootPath, sourceSlug));
}

/**
 * Download an icon from a URL and save it to the source directory.
 * Returns the path to the downloaded icon, or null on failure.
 */
export async function downloadSourceIcon(
  workspaceRootPath: string,
  sourceSlug: string,
  iconUrl: string
): Promise<string | null> {
  const sourceDir = getSourcePath(workspaceRootPath, sourceSlug);
  return downloadIcon(sourceDir, iconUrl, 'Sources');
}

/**
 * Check if a source needs its icon downloaded.
 * Returns true if config has a URL icon and no local icon file exists.
 */
export function sourceNeedsIconDownload(
  workspaceRootPath: string,
  sourceSlug: string,
  config: FolderSourceConfig
): boolean {
  const iconPath = findSourceIcon(workspaceRootPath, sourceSlug);
  return needsIconDownload(config.icon, iconPath);
}

// ============================================================
// Load Operations (SQLite)
// ============================================================

/**
 * Load complete source with all files
 * @param workspaceRootPath - Absolute path to workspace folder
 * @param sourceSlug - Source slug
 */
export function loadSource(workspaceRootPath: string, sourceSlug: string): LoadedSource | null {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select().from(sourcesTable).where(eq(sourcesTable.slug, sourceSlug)).get();
  if (!row) return null;

  const config = row.config as FolderSourceConfig;

  // Expand path variables in local source paths
  if (config.type === 'local' && config.local?.path) {
    config.local.path = expandPath(config.local.path);
  }

  const folderPath = getSourcePath(workspaceRootPath, sourceSlug);
  const workspaceId = basename(workspaceRootPath);
  const iconPath = findIconFile(folderPath);
  const guide = row.guide as SourceGuide | null;

  return {
    config,
    guide: guide ?? (row.guideRaw ? parseGuideMarkdown(row.guideRaw) : null),
    folderPath,
    workspaceRootPath,
    workspaceId,
    iconPath,
  };
}

/**
 * Load all sources for a workspace from DB
 */
export function loadWorkspaceSources(workspaceRootPath: string): LoadedSource[] {
  ensureSourcesDir(workspaceRootPath);

  const db = getWorkspaceDb(workspaceRootPath);
  const rows = db.select().from(sourcesTable).all();
  const workspaceId = basename(workspaceRootPath);

  return rows.map(row => {
    const config = row.config as FolderSourceConfig;

    // Expand path variables in local source paths
    if (config.type === 'local' && config.local?.path) {
      config.local.path = expandPath(config.local.path);
    }

    const folderPath = getSourcePath(workspaceRootPath, config.slug);
    const iconPath = findIconFile(folderPath);
    const guide = row.guide as SourceGuide | null;

    return {
      config,
      guide: guide ?? (row.guideRaw ? parseGuideMarkdown(row.guideRaw) : null),
      folderPath,
      workspaceRootPath,
      workspaceId,
      iconPath,
    };
  });
}

/**
 * Get enabled sources for a workspace
 */
export function getEnabledSources(workspaceRootPath: string): LoadedSource[] {
  return loadWorkspaceSources(workspaceRootPath).filter((s) => s.config.enabled);
}

/**
 * Check if a source is ready for use (enabled and authenticated).
 * Sources with authType: 'none' or undefined are considered authenticated.
 */
export function isSourceUsable(source: LoadedSource): boolean {
  if (!source.config.enabled) return false;

  const authType = source.config.mcp?.authType || source.config.api?.authType;

  if (authType === 'none' || authType === undefined) return true;

  return source.config.isAuthenticated === true;
}

/**
 * Get sources by slugs for a workspace.
 * Includes both user-configured sources from DB and builtin sources.
 */
export function getSourcesBySlugs(workspaceRootPath: string, slugs: string[]): LoadedSource[] {
  const workspaceId = basename(workspaceRootPath);
  const sources: LoadedSource[] = [];
  for (const slug of slugs) {
    if (isBuiltinSource(slug)) {
      if (slug === 'craft-agents-docs') {
        sources.push(getDocsSource(workspaceId, workspaceRootPath));
      }
      continue;
    }
    const source = loadSource(workspaceRootPath, slug);
    if (source) {
      sources.push(source);
    }
  }
  return sources;
}

/**
 * Load all sources for a workspace INCLUDING built-in sources.
 */
export function loadAllSources(workspaceRootPath: string): LoadedSource[] {
  const workspaceId = basename(workspaceRootPath);
  const userSources = loadWorkspaceSources(workspaceRootPath);
  const builtinSources = getBuiltinSources(workspaceId, workspaceRootPath);
  return [...userSources, ...builtinSources];
}

// ============================================================
// Create/Delete Operations
// ============================================================

/**
 * Generate URL-safe slug from name, checking DB for conflicts
 */
export function generateSourceSlug(workspaceRootPath: string, name: string): string {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);

  if (!slug) {
    slug = 'source';
  }

  // Check DB for existing slugs
  const db = getWorkspaceDb(workspaceRootPath);
  const rows = db.select().from(sourcesTable).all();
  const existingSlugs = new Set(rows.map(r => r.slug));

  if (!existingSlugs.has(slug)) {
    return slug;
  }

  let counter = 2;
  while (existingSlugs.has(`${slug}-${counter}`)) {
    counter++;
  }

  return `${slug}-${counter}`;
}

/**
 * Create a new source in a workspace
 */
export async function createSource(
  workspaceRootPath: string,
  input: CreateSourceInput
): Promise<FolderSourceConfig> {
  const slug = generateSourceSlug(workspaceRootPath, input.name);
  const now = Date.now();

  const config: FolderSourceConfig = {
    id: `${slug}_${randomUUID().slice(0, 8)}`,
    name: input.name,
    slug,
    enabled: input.enabled ?? true,
    provider: input.provider,
    type: input.type,
    createdAt: now,
    updatedAt: now,
  };

  // Add type-specific config
  switch (input.type) {
    case 'mcp':
      if (input.mcp) config.mcp = input.mcp;
      break;
    case 'api':
      if (input.api) config.api = input.api;
      break;
    case 'local':
      if (input.local) config.local = input.local;
      break;
  }

  // Validate and store icon
  if (input.icon) {
    const validatedIcon = validateIconValue(input.icon, 'Sources');
    if (validatedIcon) {
      config.icon = validatedIcon;
    }
  }

  // Save config to DB (creates DB row)
  saveSourceConfig(workspaceRootPath, config);

  // Create source directory for icon files
  const sourcePath = getSourcePath(workspaceRootPath, slug);
  if (!existsSync(sourcePath)) {
    mkdirSync(sourcePath, { recursive: true });
  }

  // If icon is a URL, download it immediately
  if (config.icon && isIconUrl(config.icon)) {
    const iconPath = await downloadIcon(sourcePath, config.icon, 'Sources');
    if (iconPath) {
      debug(`[createSource] Icon downloaded for ${slug}: ${iconPath}`);
    }
  } else if (!config.icon) {
    // No icon provided - try to auto-fetch from service URL
    const { deriveServiceUrl, getHighQualityLogoUrl } = await import('../utils/logo.ts');
    const { downloadIcon } = await import('../utils/icon.ts');
    const serviceUrl = deriveServiceUrl(input);
    if (serviceUrl) {
      const logoUrl = await getHighQualityLogoUrl(serviceUrl, input.provider);
      if (logoUrl) {
        const iconPath = await downloadIcon(sourcePath, logoUrl, `createSource:${slug}`);
        if (iconPath) {
          config.icon = logoUrl;
          saveSourceConfig(workspaceRootPath, config);
        }
      }
    }
  }

  // Create guide.md with skeleton template and save to DB
  const guideContent = `# ${input.name}

## Guidelines

(Add usage guidelines here)

## Context

(Add context about this source)
`;
  const guide = parseGuideMarkdown(guideContent);
  saveSourceGuide(workspaceRootPath, slug, guide);

  return config;
}

/**
 * Delete a source from a workspace (DB row + icon directory)
 */
export function deleteSource(workspaceRootPath: string, sourceSlug: string): void {
  const db = getWorkspaceDb(workspaceRootPath);
  db.delete(sourcesTable).where(eq(sourcesTable.slug, sourceSlug)).run();

  // Remove source directory (icon files etc.)
  const dir = getSourcePath(workspaceRootPath, sourceSlug);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true });
  }

  dbEvents.emit('source:deleted', sourceSlug);
}

/**
 * Check if a source exists in a workspace (DB check)
 */
export function sourceExists(workspaceRootPath: string, sourceSlug: string): boolean {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select()
    .from(sourcesTable)
    .where(eq(sourcesTable.slug, sourceSlug))
    .get();
  return !!row;
}
