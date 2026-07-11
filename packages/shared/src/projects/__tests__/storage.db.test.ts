/**
 * Tests for Project Storage — SQLite backend.
 *
 * Uses real temp workspaces (fresh workspace.db per test) to exercise the
 * config CRUD paths, the one-time legacy config.json import, and the
 * filesystem-backed asset operations gated by DB existence checks.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { autoRegisterDriver } from '../../db/driver.ts';
import { closeWorkspaceDb } from '../../db/connection.ts';
import { createProject as createProjectOnDisk } from '../storage.ts';
import {
  createProject,
  updateProject,
  deleteProject,
  projectExists,
  generateProjectSlug,
  loadProjectConfig,
  loadProject,
  loadProjectById,
  loadWorkspaceProjects,
  getProjectPath,
  getProjectAssetsPath,
  uploadProjectAsset,
  listProjectAssets,
  deleteProjectAsset,
} from '../storage.db.ts';

beforeAll(async () => {
  await autoRegisterDriver();
});

let tempDir: string;
let workspaceRoot: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'projects-db-test-'));
  workspaceRoot = join(tempDir, 'workspace');
  mkdirSync(workspaceRoot, { recursive: true });
});

afterEach(() => {
  closeWorkspaceDb(workspaceRoot);
  rmSync(tempDir, { recursive: true, force: true });
});

describe('config CRUD', () => {
  it('round-trips a full config through create/load', () => {
    const wd = join(homedir(), 'dp-projects-db-test-wd');
    const created = createProject(workspaceRoot, {
      name: 'Quarterly Report',
      description: 'Q3 numbers',
      workingDirectory: wd,
      details: 'Use the finance style guide',
      colorTheme: 'ocean',
    });

    expect(created.id).toMatch(/^proj_[0-9a-f]{8}$/);
    expect(created.slug).toBe('quarterly-report');

    const loaded = loadProjectConfig(workspaceRoot, created.slug);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(created.id);
    expect(loaded!.name).toBe('Quarterly Report');
    expect(loaded!.description).toBe('Q3 numbers');
    // Stored portable (~/...), expanded back to absolute on read.
    expect(loaded!.workingDirectory).toBe(wd);
    expect(loaded!.details).toBe('Use the finance style guide');
    expect(loaded!.colorTheme).toBe('ocean');
  });

  it('creates the project folder and assets dir on disk', () => {
    const created = createProject(workspaceRoot, { name: 'Disk Home' });
    expect(existsSync(getProjectPath(workspaceRoot, created.slug))).toBe(true);
    expect(existsSync(getProjectAssetsPath(workspaceRoot, created.slug))).toBe(true);
    // Config lives in the DB — no config.json is written.
    expect(existsSync(join(getProjectPath(workspaceRoot, created.slug), 'config.json'))).toBe(false);
  });

  it('loads by id via loadProjectById and synthesizes LoadedProject paths', () => {
    const created = createProject(workspaceRoot, { name: 'By Id' });
    const loaded = loadProjectById(workspaceRoot, created.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.config.slug).toBe(created.slug);
    expect(loaded!.folderPath).toBe(getProjectPath(workspaceRoot, created.slug));
    expect(loaded!.assetsPath).toBe(getProjectAssetsPath(workspaceRoot, created.slug));
    expect(loaded!.workspaceRootPath).toBe(workspaceRoot);
    expect(loadProjectById(workspaceRoot, 'proj_missing0')).toBeNull();
  });

  it('lists projects sorted by slug', () => {
    createProject(workspaceRoot, { name: 'Zebra' });
    createProject(workspaceRoot, { name: 'Alpha' });
    const slugs = loadWorkspaceProjects(workspaceRoot).map((p) => p.config.slug);
    expect(slugs).toEqual(['alpha', 'zebra']);
  });

  it('updateProject applies a patch but keeps id/slug/createdAt immutable', () => {
    const created = createProject(workspaceRoot, { name: 'Patch Me' });
    const updated = updateProject(workspaceRoot, created.slug, {
      name: 'Patched',
      color: '#6366f1',
      kanbanColumns: [{ id: 'todo', name: 'Backlog' }],
      // @ts-expect-error — immutable fields are stripped by the implementation
      id: 'proj_hacked00',
    });

    expect(updated.id).toBe(created.id);
    expect(updated.slug).toBe(created.slug);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

    const reloaded = loadProjectConfig(workspaceRoot, created.slug);
    expect(reloaded!.name).toBe('Patched');
    expect(reloaded!.color).toBe('#6366f1');
    expect(reloaded!.kanbanColumns).toEqual([{ id: 'todo', name: 'Backlog' }]);
  });

  it('updateProject throws for a missing project', () => {
    expect(() => updateProject(workspaceRoot, 'nope', { name: 'x' })).toThrow('Project not found');
  });

  it('deleteProject removes the row and the folder', () => {
    const created = createProject(workspaceRoot, { name: 'Doomed' });
    const dir = getProjectPath(workspaceRoot, created.slug);
    expect(existsSync(dir)).toBe(true);

    deleteProject(workspaceRoot, created.slug);
    expect(projectExists(workspaceRoot, created.slug)).toBe(false);
    expect(loadProjectById(workspaceRoot, created.id)).toBeNull();
    expect(existsSync(dir)).toBe(false);
  });
});

describe('slug generation', () => {
  it('suffixes -2, -3 on name collisions', () => {
    expect(createProject(workspaceRoot, { name: 'Same Name' }).slug).toBe('same-name');
    expect(createProject(workspaceRoot, { name: 'Same Name' }).slug).toBe('same-name-2');
    expect(createProject(workspaceRoot, { name: 'Same Name' }).slug).toBe('same-name-3');
  });

  it('treats a leftover folder without a DB row as taken', () => {
    // e.g. a project folder restored from backup — it still owns assets/MEMORY.md.
    // Seed one real project first so the empty-table legacy import has already run.
    createProject(workspaceRoot, { name: 'Seed' });
    mkdirSync(join(workspaceRoot, 'projects', 'ghost'), { recursive: true });
    expect(generateProjectSlug(workspaceRoot, 'Ghost')).toBe('ghost-2');
  });

  it('falls back to "project" for names that reduce to empty', () => {
    expect(generateProjectSlug(workspaceRoot, '!!!')).toBe('project');
  });
});

describe('legacy config.json import', () => {
  it('imports file-based projects on first read and renames configs to .migrated', () => {
    // Author projects through the upstream file-based implementation.
    const legacyA = createProjectOnDisk(workspaceRoot, { name: 'Legacy A', details: 'from json' });
    const legacyB = createProjectOnDisk(workspaceRoot, { name: 'Legacy B' });

    const projects = loadWorkspaceProjects(workspaceRoot);
    expect(projects.map((p) => p.config.id).sort()).toEqual([legacyA.id, legacyB.id].sort());
    expect(projects.find((p) => p.config.slug === 'legacy-a')!.config.details).toBe('from json');

    for (const slug of ['legacy-a', 'legacy-b']) {
      const dir = getProjectPath(workspaceRoot, slug);
      expect(existsSync(join(dir, 'config.json'))).toBe(false);
      expect(existsSync(join(dir, 'config.json.migrated'))).toBe(true);
    }
  });

  it('does not re-import .migrated files after all projects are deleted', () => {
    createProjectOnDisk(workspaceRoot, { name: 'Once' });
    expect(loadWorkspaceProjects(workspaceRoot)).toHaveLength(1);

    deleteProject(workspaceRoot, 'once');
    expect(loadWorkspaceProjects(workspaceRoot)).toHaveLength(0);
  });

  it('skips malformed legacy configs without failing the import', () => {
    createProjectOnDisk(workspaceRoot, { name: 'Good' });
    const badDir = join(workspaceRoot, 'projects', 'bad');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, 'config.json'), '{ not json');

    const projects = loadWorkspaceProjects(workspaceRoot);
    expect(projects.map((p) => p.config.slug)).toEqual(['good']);
    // The unparseable file is left in place for manual recovery.
    expect(readFileSync(join(badDir, 'config.json'), 'utf-8')).toBe('{ not json');
  });
});

describe('asset operations against DB-backed projects', () => {
  it('uploadProjectAsset accepts a DB-created project (no config.json on disk)', () => {
    const created = createProject(workspaceRoot, { name: 'Assets' });
    const asset = uploadProjectAsset(workspaceRoot, created.slug, {
      filename: 'notes.txt',
      text: 'hello',
    });
    expect(asset.filename).toBe('notes.txt');
    expect(readFileSync(asset.absolutePath, 'utf-8')).toBe('hello');
    expect(listProjectAssets(workspaceRoot, created.slug).map((a) => a.filename)).toEqual(['notes.txt']);
  });

  it('resolves filename collisions with -2 suffix before the extension', () => {
    const created = createProject(workspaceRoot, { name: 'Collide' });
    uploadProjectAsset(workspaceRoot, created.slug, { filename: 'a.txt', text: '1' });
    const second = uploadProjectAsset(workspaceRoot, created.slug, { filename: 'a.txt', text: '2' });
    expect(second.filename).toBe('a-2.txt');
  });

  it('rejects uploads to a missing project', () => {
    expect(() =>
      uploadProjectAsset(workspaceRoot, 'missing', { filename: 'x.txt', text: 'x' }),
    ).toThrow('Project not found');
  });

  it('deleteProjectAsset removes the file', () => {
    const created = createProject(workspaceRoot, { name: 'Remove Asset' });
    uploadProjectAsset(workspaceRoot, created.slug, { filename: 'gone.txt', text: 'x' });
    deleteProjectAsset(workspaceRoot, created.slug, 'gone.txt');
    expect(listProjectAssets(workspaceRoot, created.slug)).toHaveLength(0);
  });
});
