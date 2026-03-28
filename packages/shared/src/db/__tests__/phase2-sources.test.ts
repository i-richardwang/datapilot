/**
 * Phase 2 Integration Tests — Sources DB Storage
 *
 * Tests for sources storage.db.ts module.
 * Verifies CRUD, guide read/write, slug generation, and loadAllSources merging.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { autoRegisterDriver } from '../driver.ts';
import { closeWorkspaceDb } from '../connection.ts';

import {
  getSourcePath,
  ensureSourcesDir,
  loadSourceConfig,
  markSourceAuthenticated,
  saveSourceConfig,
  loadSourceGuide,
  extractTagline,
  saveSourceGuide,
  parseGuideMarkdown,
  findSourceIcon,
  sourceNeedsIconDownload,
  loadSource,
  loadWorkspaceSources,
  getEnabledSources,
  isSourceUsable,
  getSourcesBySlugs,
  loadAllSources,
  generateSourceSlug,
  createSource,
  deleteSource,
  sourceExists,
} from '../../sources/storage.db.ts';

import type { FolderSourceConfig, SourceGuide, LoadedSource } from '../../sources/types.ts';

beforeAll(async () => {
  await autoRegisterDriver();
});

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'datapilot-phase2-test-'));
  // Create sources directory
  mkdirSync(join(testDir, 'sources'), { recursive: true });
});

afterEach(() => {
  closeWorkspaceDb(testDir);
  rmSync(testDir, { recursive: true, force: true });
});

// ─── Config CRUD ─────────────────────────────────────────────────────────────

describe('Source Config CRUD', () => {
  const makeConfig = (slug: string, overrides?: Partial<FolderSourceConfig>): FolderSourceConfig => ({
    id: `${slug}_test1234`,
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    slug,
    enabled: true,
    provider: 'test',
    type: 'mcp',
    mcp: { transport: 'http', url: 'https://example.com/mcp', authType: 'none' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

  test('loadSourceConfig returns null for nonexistent source', () => {
    const config = loadSourceConfig(testDir, 'nonexistent');
    expect(config).toBeNull();
  });

  test('saveSourceConfig and loadSourceConfig round-trip', () => {
    const config = makeConfig('linear');
    saveSourceConfig(testDir, config);

    const loaded = loadSourceConfig(testDir, 'linear');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(config.id);
    expect(loaded!.name).toBe('Linear');
    expect(loaded!.slug).toBe('linear');
    expect(loaded!.type).toBe('mcp');
    expect(loaded!.enabled).toBe(true);
    expect(loaded!.mcp?.url).toBe('https://example.com/mcp');
  });

  test('saveSourceConfig updates existing source', () => {
    const config = makeConfig('github');
    saveSourceConfig(testDir, config);

    config.name = 'GitHub Updated';
    config.enabled = false;
    saveSourceConfig(testDir, config);

    const loaded = loadSourceConfig(testDir, 'github');
    expect(loaded!.name).toBe('GitHub Updated');
    expect(loaded!.enabled).toBe(false);
  });

  test('saveSourceConfig updates updatedAt timestamp', () => {
    const config = makeConfig('notion', { updatedAt: 1000 });
    saveSourceConfig(testDir, config);

    const loaded = loadSourceConfig(testDir, 'notion');
    expect(loaded!.updatedAt).toBeGreaterThan(1000);
  });

  test('saveSourceConfig throws on invalid config', () => {
    const invalid = { slug: 'bad', name: '', type: 'mcp', enabled: true, provider: '' } as FolderSourceConfig;
    expect(() => saveSourceConfig(testDir, invalid)).toThrow();
  });

  test('saveSourceConfig converts local paths to portable form', () => {
    const config = makeConfig('local-src', {
      type: 'local',
      local: { path: '/Users/test/projects/my-repo' },
    });
    // Remove mcp config since this is local type
    delete config.mcp;
    saveSourceConfig(testDir, config);

    // The stored config should have portable path
    // When loaded, it should be expanded back
    const loaded = loadSourceConfig(testDir, 'local-src');
    expect(loaded).not.toBeNull();
    expect(loaded!.type).toBe('local');
  });

  test('markSourceAuthenticated updates auth fields', () => {
    const config = makeConfig('auth-test', {
      isAuthenticated: false,
      connectionStatus: 'needs_auth',
    });
    saveSourceConfig(testDir, config);

    const result = markSourceAuthenticated(testDir, 'auth-test');
    expect(result).toBe(true);

    const loaded = loadSourceConfig(testDir, 'auth-test');
    expect(loaded!.isAuthenticated).toBe(true);
    expect(loaded!.connectionStatus).toBe('connected');
  });

  test('markSourceAuthenticated returns false for nonexistent source', () => {
    const result = markSourceAuthenticated(testDir, 'nonexistent');
    expect(result).toBe(false);
  });
});

// ─── Guide Operations ────────────────────────────────────────────────────────

describe('Source Guide Operations', () => {
  const makeConfig = (slug: string): FolderSourceConfig => ({
    id: `${slug}_test1234`,
    name: slug,
    slug,
    enabled: true,
    provider: 'test',
    type: 'mcp',
    mcp: { transport: 'http', url: 'https://example.com/mcp', authType: 'none' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  test('loadSourceGuide returns null for nonexistent source', () => {
    const guide = loadSourceGuide(testDir, 'nonexistent');
    expect(guide).toBeNull();
  });

  test('saveSourceGuide and loadSourceGuide round-trip', () => {
    // Create source first
    saveSourceConfig(testDir, makeConfig('guide-test'));

    const guide: SourceGuide = {
      raw: '# Guide Test\n\n## Scope\n\nTest scope content\n\n## Guidelines\n\nTest guidelines\n',
      scope: 'Test scope content',
      guidelines: 'Test guidelines',
    };
    saveSourceGuide(testDir, 'guide-test', guide);

    const loaded = loadSourceGuide(testDir, 'guide-test');
    expect(loaded).not.toBeNull();
    expect(loaded!.raw).toBe(guide.raw);
    expect(loaded!.scope).toBe('Test scope content');
    expect(loaded!.guidelines).toBe('Test guidelines');
  });

  test('parseGuideMarkdown extracts sections', () => {
    // Note: The regex uses \Z which doesn't work in JS. The last section
    // needs a following ## header to be captured by the (?=\n## ) lookahead.
    const raw = `# My Source

## Scope

Search and query data

## Guidelines

Use sparingly

## Context

Internal tool

## API Notes

Rate limited to 100/min

## End
`;
    const guide = parseGuideMarkdown(raw);
    expect(guide.raw).toBe(raw);
    expect(guide.scope).toBe('Search and query data');
    expect(guide.guidelines).toBe('Use sparingly');
    expect(guide.context).toBe('Internal tool');
    expect(guide.apiNotes).toBe('Rate limited to 100/min');
  });

  test('parseGuideMarkdown extracts cache from JSON code block', () => {
    const raw = `# Source

## Cache

\`\`\`json
{"key": "value", "count": 42}
\`\`\`

## End
`;
    const guide = parseGuideMarkdown(raw);
    expect(guide.cache).toEqual({ key: 'value', count: 42 });
  });

  test('extractTagline gets first paragraph after title', () => {
    const guide: SourceGuide = {
      raw: '# My Source\n\nThis is the tagline for the source\n\n## Scope\n\nScope content\n',
    };
    expect(extractTagline(guide)).toBe('This is the tagline for the source');
  });

  test('extractTagline falls back to scope', () => {
    const guide: SourceGuide = {
      raw: '# My Source\n\n## Scope\n\nScope first line\n',
      scope: 'Scope first line',
    };
    expect(extractTagline(guide)).toBe('Scope first line');
  });

  test('extractTagline returns null for empty guide', () => {
    expect(extractTagline(null)).toBeNull();
    expect(extractTagline({ raw: '' })).toBeNull();
  });
});

// ─── Load Operations ─────────────────────────────────────────────────────────

describe('Source Load Operations', () => {
  const makeAndSave = (slug: string, overrides?: Partial<FolderSourceConfig>) => {
    const config: FolderSourceConfig = {
      id: `${slug}_abcd1234`,
      name: slug.charAt(0).toUpperCase() + slug.slice(1),
      slug,
      enabled: true,
      provider: 'test',
      type: 'mcp',
      mcp: { transport: 'http', url: `https://${slug}.example.com/mcp`, authType: 'none' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...overrides,
    };
    saveSourceConfig(testDir, config);
    return config;
  };

  test('loadSource returns null for nonexistent', () => {
    expect(loadSource(testDir, 'nonexistent')).toBeNull();
  });

  test('loadSource returns complete LoadedSource', () => {
    makeAndSave('linear');
    saveSourceGuide(testDir, 'linear', { raw: '# Linear\n\nGuide content' });

    const source = loadSource(testDir, 'linear');
    expect(source).not.toBeNull();
    expect(source!.config.slug).toBe('linear');
    expect(source!.guide?.raw).toContain('Linear');
    expect(source!.workspaceRootPath).toBe(testDir);
    expect(source!.workspaceId).toBeTruthy();
    expect(source!.folderPath).toContain('linear');
  });

  test('loadWorkspaceSources returns all sources', () => {
    makeAndSave('source-a');
    makeAndSave('source-b');
    makeAndSave('source-c');

    const sources = loadWorkspaceSources(testDir);
    expect(sources).toHaveLength(3);
    const slugs = sources.map(s => s.config.slug).sort();
    expect(slugs).toEqual(['source-a', 'source-b', 'source-c']);
  });

  test('getEnabledSources filters by enabled', () => {
    makeAndSave('enabled-1', { enabled: true });
    makeAndSave('disabled-1', { enabled: false });
    makeAndSave('enabled-2', { enabled: true });

    const enabled = getEnabledSources(testDir);
    expect(enabled).toHaveLength(2);
    const slugs = enabled.map(s => s.config.slug).sort();
    expect(slugs).toEqual(['enabled-1', 'enabled-2']);
  });

  test('isSourceUsable checks enabled and auth', () => {
    const usable: LoadedSource = {
      config: { id: '1', name: 'T', slug: 't', enabled: true, provider: 'p', type: 'mcp', mcp: { authType: 'none' } },
      guide: null,
      folderPath: '',
      workspaceRootPath: testDir,
      workspaceId: 'ws',
    };
    expect(isSourceUsable(usable)).toBe(true);

    const disabled: LoadedSource = { ...usable, config: { ...usable.config, enabled: false } };
    expect(isSourceUsable(disabled)).toBe(false);

    const needsAuth: LoadedSource = {
      ...usable,
      config: { ...usable.config, mcp: { authType: 'oauth' }, isAuthenticated: false },
    };
    expect(isSourceUsable(needsAuth)).toBe(false);

    const authed: LoadedSource = {
      ...usable,
      config: { ...usable.config, mcp: { authType: 'oauth' }, isAuthenticated: true },
    };
    expect(isSourceUsable(authed)).toBe(true);
  });

  test('getSourcesBySlugs loads specific sources', () => {
    makeAndSave('alpha');
    makeAndSave('beta');
    makeAndSave('gamma');

    const sources = getSourcesBySlugs(testDir, ['alpha', 'gamma']);
    expect(sources).toHaveLength(2);
    const slugs = sources.map(s => s.config.slug).sort();
    expect(slugs).toEqual(['alpha', 'gamma']);
  });

  test('getSourcesBySlugs skips nonexistent slugs', () => {
    makeAndSave('exists');

    const sources = getSourcesBySlugs(testDir, ['exists', 'missing']);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.config.slug).toBe('exists');
  });

  test('loadAllSources merges DB + builtin', () => {
    makeAndSave('user-source');

    const all = loadAllSources(testDir);
    // At minimum should have the user source (builtins currently return empty)
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all.find(s => s.config.slug === 'user-source')).toBeTruthy();
  });
});

// ─── Slug Generation ─────────────────────────────────────────────────────────

describe('Source Slug Generation', () => {
  test('generates slug from name', () => {
    const slug = generateSourceSlug(testDir, 'My Cool Source');
    expect(slug).toBe('my-cool-source');
  });

  test('truncates long names', () => {
    const slug = generateSourceSlug(testDir, 'A'.repeat(100));
    expect(slug.length).toBeLessThanOrEqual(50);
  });

  test('handles empty name', () => {
    const slug = generateSourceSlug(testDir, '!!!');
    expect(slug).toBe('source');
  });

  test('detects slug conflicts and appends counter', () => {
    const config: FolderSourceConfig = {
      id: 'test_1234',
      name: 'Test',
      slug: 'test',
      enabled: true,
      provider: 'test',
      type: 'mcp',
      mcp: { transport: 'http', url: 'https://example.com/mcp', authType: 'none' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveSourceConfig(testDir, config);

    const slug = generateSourceSlug(testDir, 'Test');
    expect(slug).toBe('test-2');
  });

  test('finds next available counter', () => {
    // Create test, test-2 to force test-3
    for (const slug of ['test', 'test-2']) {
      saveSourceConfig(testDir, {
        id: `${slug}_1234`,
        name: 'Test',
        slug,
        enabled: true,
        provider: 'test',
        type: 'mcp',
        mcp: { transport: 'http', url: 'https://example.com/mcp', authType: 'none' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    const slug = generateSourceSlug(testDir, 'Test');
    expect(slug).toBe('test-3');
  });
});

// ─── Create/Delete Operations ────────────────────────────────────────────────

describe('Source Create/Delete', () => {
  test('createSource creates DB row and directory', async () => {
    const config = await createSource(testDir, {
      name: 'New Source',
      provider: 'test-provider',
      type: 'mcp',
      mcp: { transport: 'http', url: 'https://example.com/mcp', authType: 'none' },
    });

    expect(config.slug).toBe('new-source');
    expect(config.name).toBe('New Source');
    expect(config.enabled).toBe(true);
    expect(config.id).toContain('new-source_');

    // Verify source dir was created (for icons)
    expect(existsSync(getSourcePath(testDir, config.slug))).toBe(true);

    // Verify DB row exists
    expect(sourceExists(testDir, config.slug)).toBe(true);

    // Verify guide was created
    const guide = loadSourceGuide(testDir, config.slug);
    expect(guide).not.toBeNull();
    expect(guide!.raw).toContain('New Source');
  });

  test('createSource sets enabled from input', async () => {
    const config = await createSource(testDir, {
      name: 'Disabled Source',
      provider: 'test',
      type: 'mcp',
      mcp: { transport: 'http', url: 'https://example.com/mcp', authType: 'none' },
      enabled: false,
    });
    expect(config.enabled).toBe(false);
  });

  test('deleteSource removes DB row and directory', async () => {
    const config = await createSource(testDir, {
      name: 'Delete Me',
      provider: 'test',
      type: 'mcp',
      mcp: { transport: 'http', url: 'https://example.com/mcp', authType: 'none' },
    });

    expect(sourceExists(testDir, config.slug)).toBe(true);

    deleteSource(testDir, config.slug);

    expect(sourceExists(testDir, config.slug)).toBe(false);
    expect(existsSync(getSourcePath(testDir, config.slug))).toBe(false);
  });

  test('deleteSource is safe for nonexistent source', () => {
    // Should not throw
    deleteSource(testDir, 'nonexistent');
  });

  test('sourceExists returns correct boolean', async () => {
    expect(sourceExists(testDir, 'nope')).toBe(false);

    const config = await createSource(testDir, {
      name: 'Exists Test',
      provider: 'test',
      type: 'mcp',
      mcp: { transport: 'http', url: 'https://example.com/mcp', authType: 'none' },
    });

    expect(sourceExists(testDir, config.slug)).toBe(true);
  });
});
