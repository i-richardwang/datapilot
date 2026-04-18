/**
 * Phase 1 Integration Tests
 *
 * Tests for statuses, labels, views, and workspace config DB storage modules.
 * Verifies that each storage.db.ts module correctly reads/writes to SQLite
 * and maintains the same behavior as the original file-based storage.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { autoRegisterDriver } from '../driver.ts';
import { closeWorkspaceDb } from '../connection.ts';

// Statuses
import {
  getDefaultStatusConfig,
  loadStatusConfig,
  saveStatusConfig,
  getStatus,
  listStatuses,
  isValidStatusId,
  getStatusCategory,
} from '../../statuses/storage.db.ts';

// Labels
import {
  getDefaultLabelConfig,
  loadLabelConfig,
  saveLabelConfig,
  listLabels,
  listLabelsFlat,
  getLabel,
  isValidLabelId,
  isValidLabelIdFormat,
} from '../../labels/storage.db.ts';

// Views
import {
  loadViewsConfig,
  saveViewsConfig,
  listViews,
  saveViews,
} from '../../views/storage.db.ts';
import type { ViewsConfig } from '../../views/storage.db.ts';

// Workspace Config
import {
  loadWorkspaceConfig,
  saveWorkspaceConfig,
} from '../../workspaces/storage.db.ts';

beforeAll(async () => {
  await autoRegisterDriver();
});

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'datapilot-phase1-test-'));
});

afterEach(() => {
  closeWorkspaceDb(testDir);
  rmSync(testDir, { recursive: true, force: true });
});

// ─── Statuses ───────────────────────────────────────────────────────────────

describe('Statuses DB Storage', () => {
  test('getDefaultStatusConfig returns valid config', () => {
    const config = getDefaultStatusConfig();
    expect(config.version).toBe(1);
    expect(config.defaultStatusId).toBe('todo');
    expect(config.statuses.length).toBeGreaterThanOrEqual(3);
    expect(config.statuses.find(s => s.id === 'todo')).toBeTruthy();
    expect(config.statuses.find(s => s.id === 'done')).toBeTruthy();
    expect(config.statuses.find(s => s.id === 'cancelled')).toBeTruthy();
  });

  test('loadStatusConfig seeds defaults on first load', () => {
    const config = loadStatusConfig(testDir);
    expect(config.version).toBe(1);
    expect(config.defaultStatusId).toBe('todo');
    expect(config.statuses.length).toBeGreaterThanOrEqual(3);
  });

  test('loadStatusConfig returns same data on second load', () => {
    const first = loadStatusConfig(testDir);
    const second = loadStatusConfig(testDir);
    expect(first.statuses.length).toBe(second.statuses.length);
    expect(first.defaultStatusId).toBe(second.defaultStatusId);
  });

  test('saveStatusConfig persists custom config', () => {
    const custom = {
      version: 1,
      defaultStatusId: 'open',
      statuses: [
        { id: 'open', label: 'Open', category: 'open' as const, isFixed: true, isDefault: true, order: 0 },
        { id: 'closed', label: 'Closed', category: 'closed' as const, isFixed: true, isDefault: false, order: 1 },
      ],
    };

    saveStatusConfig(testDir, custom);
    const loaded = loadStatusConfig(testDir);

    expect(loaded.defaultStatusId).toBe('open');
    expect(loaded.statuses.find(s => s.id === 'open')).toBeTruthy();
    expect(loaded.statuses.find(s => s.id === 'closed')).toBeTruthy();
  });

  test('getStatus returns single status', () => {
    loadStatusConfig(testDir); // seed
    const status = getStatus(testDir, 'todo');
    expect(status).not.toBeNull();
    expect(status!.id).toBe('todo');
    expect(status!.label).toBe('Todo');
  });

  test('getStatus returns null for nonexistent', () => {
    loadStatusConfig(testDir);
    const status = getStatus(testDir, 'nonexistent');
    expect(status).toBeNull();
  });

  test('listStatuses returns sorted by order', () => {
    loadStatusConfig(testDir);
    const list = listStatuses(testDir);
    expect(list.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < list.length; i++) {
      expect(list[i]!.order).toBeGreaterThanOrEqual(list[i - 1]!.order);
    }
  });

  test('isValidStatusId checks existence', () => {
    loadStatusConfig(testDir);
    expect(isValidStatusId(testDir, 'todo')).toBe(true);
    expect(isValidStatusId(testDir, 'nonexistent')).toBe(false);
  });

  test('getStatusCategory returns correct category', () => {
    loadStatusConfig(testDir);
    expect(getStatusCategory(testDir, 'todo')).toBe('open');
    expect(getStatusCategory(testDir, 'done')).toBe('closed');
    expect(getStatusCategory(testDir, 'nonexistent')).toBeNull();
  });
});

// ─── Labels ─────────────────────────────────────────────────────────────────

describe('Labels DB Storage', () => {
  test('getDefaultLabelConfig returns valid tree', () => {
    const config = getDefaultLabelConfig();
    expect(config.version).toBe(1);
    expect(config.labels.length).toBeGreaterThanOrEqual(2);
    const dev = config.labels.find(l => l.id === 'development');
    expect(dev).toBeTruthy();
    expect(dev!.children).toBeTruthy();
    expect(dev!.children!.length).toBeGreaterThan(0);
  });

  test('loadLabelConfig seeds defaults on first load', () => {
    const config = loadLabelConfig(testDir);
    expect(config.version).toBe(1);
    expect(config.labels.length).toBeGreaterThan(0);
  });

  test('saveLabelConfig persists custom tree', () => {
    const custom = {
      version: 1,
      labels: [
        { id: 'test', name: 'Test', color: 'accent' as const },
        { id: 'parent', name: 'Parent', color: 'info' as const, children: [
          { id: 'child', name: 'Child', color: 'success' as const },
        ]},
      ],
    };

    saveLabelConfig(testDir, custom);
    const loaded = loadLabelConfig(testDir);
    expect(loaded.labels).toHaveLength(2);
    expect(loaded.labels[1]!.children).toHaveLength(1);
    expect(loaded.labels[1]!.children![0]!.id).toBe('child');
  });

  test('listLabels returns root-level labels', () => {
    loadLabelConfig(testDir);
    const labels = listLabels(testDir);
    expect(labels.length).toBeGreaterThan(0);
  });

  test('listLabelsFlat flattens tree', () => {
    loadLabelConfig(testDir);
    const flat = listLabelsFlat(testDir);
    const tree = listLabels(testDir);
    expect(flat.length).toBeGreaterThanOrEqual(tree.length);
  });

  test('getLabel finds label in tree', () => {
    loadLabelConfig(testDir);
    const label = getLabel(testDir, 'code');
    expect(label).not.toBeNull();
    expect(label!.name).toBe('Code');
  });

  test('getLabel returns null for nonexistent', () => {
    loadLabelConfig(testDir);
    const label = getLabel(testDir, 'nonexistent');
    expect(label).toBeNull();
  });

  test('isValidLabelId checks existence', () => {
    loadLabelConfig(testDir);
    expect(isValidLabelId(testDir, 'development')).toBe(true);
    expect(isValidLabelId(testDir, 'nonexistent')).toBe(false);
  });

  test('isValidLabelIdFormat validates slug format', () => {
    expect(isValidLabelIdFormat('valid-id')).toBe(true);
    expect(isValidLabelIdFormat('simple')).toBe(true);
    expect(isValidLabelIdFormat('a1b2')).toBe(true);
    expect(isValidLabelIdFormat('-invalid')).toBe(false);
    expect(isValidLabelIdFormat('Invalid')).toBe(false);
    expect(isValidLabelIdFormat('')).toBe(false);
  });
});

// ─── Views ──────────────────────────────────────────────────────────────────

describe('Views DB Storage', () => {
  test('loadViewsConfig seeds defaults on first load', () => {
    const config = loadViewsConfig(testDir);
    expect(config.version).toBe(1);
    expect(config.views).toBeDefined();
    expect(Array.isArray(config.views)).toBe(true);
  });

  test('saveViewsConfig persists custom views', () => {
    const custom: ViewsConfig = {
      version: 1,
      views: [
        { id: 'flagged', name: 'Flagged', expression: 'isFlagged == true' },
        { id: 'expensive', name: 'Expensive', expression: 'tokenUsage.costUsd > 1' },
      ],
    };

    saveViewsConfig(testDir, custom);
    const loaded = loadViewsConfig(testDir);
    expect(loaded.views).toHaveLength(2);
    expect(loaded.views[0]!.id).toBe('flagged');
    expect(loaded.views[1]!.expression).toBe('tokenUsage.costUsd > 1');
  });

  test('listViews returns views array', () => {
    loadViewsConfig(testDir); // seed
    const views = listViews(testDir);
    expect(Array.isArray(views)).toBe(true);
  });

  test('saveViews replaces entire views array', () => {
    loadViewsConfig(testDir); // seed

    const newViews = [
      { id: 'new-view', name: 'New', expression: 'true', description: 'Always matches' },
    ];

    saveViews(testDir, newViews);
    const loaded = listViews(testDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe('new-view');
  });
});

// ─── Workspace Config ───────────────────────────────────────────────────────

describe('Workspace Config DB Storage', () => {
  test('loadWorkspaceConfig returns null when empty', () => {
    const config = loadWorkspaceConfig(testDir);
    expect(config).toBeNull();
  });

  test('saveWorkspaceConfig and loadWorkspaceConfig round-trip', () => {
    const config = {
      id: 'ws_test123',
      name: 'Test Workspace',
      slug: 'test-workspace',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      defaults: {
        model: 'claude-sonnet-4-6',
        permissionMode: 'ask' as const,
      },
    };

    saveWorkspaceConfig(testDir, config);
    const loaded = loadWorkspaceConfig(testDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('ws_test123');
    expect(loaded!.name).toBe('Test Workspace');
    expect(loaded!.slug).toBe('test-workspace');
    expect(loaded!.defaults?.model).toBe('claude-sonnet-4-6');
    expect(loaded!.defaults?.permissionMode).toBe('ask');
  });

  test('saveWorkspaceConfig updates updatedAt', () => {
    const config = {
      id: 'ws_test',
      name: 'Test',
      slug: 'test',
      createdAt: 1000,
      updatedAt: 1000,
    };

    saveWorkspaceConfig(testDir, config);
    const loaded = loadWorkspaceConfig(testDir);
    expect(loaded!.updatedAt).toBeGreaterThan(1000);
  });

  test('saveWorkspaceConfig overwrites previous config', () => {
    saveWorkspaceConfig(testDir, {
      id: 'ws_1',
      name: 'First',
      slug: 'first',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    saveWorkspaceConfig(testDir, {
      id: 'ws_2',
      name: 'Second',
      slug: 'second',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const loaded = loadWorkspaceConfig(testDir);
    expect(loaded!.id).toBe('ws_2');
    expect(loaded!.name).toBe('Second');
  });
});
