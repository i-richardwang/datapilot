/**
 * Label Storage — SQLite Backend
 *
 * Drop-in replacement for storage.ts with identical exported function signatures.
 * Stores the label tree as a JSON document in workspace.db.
 */

import type { WorkspaceLabelConfig, LabelConfig } from './types.ts';
import { labelConfig } from '../db/schema/labels.sql.ts';
import { getWorkspaceDb } from '../db/connection.ts';
import { dbEvents } from '../db/events.ts';
import { flattenLabels, findLabelById } from './tree.ts';
import { migrateLabelColors } from '../colors/migrate.ts';

// ─── Defaults ───────────────────────────────────────────────────────────────

export function getDefaultLabelConfig(): WorkspaceLabelConfig {
  return {
    version: 1,
    labels: [
      {
        id: 'development',
        name: 'Development',
        color: { light: '#3B82F6', dark: '#60A5FA' },
        children: [
          { id: 'code', name: 'Code', color: { light: '#4F46E5', dark: '#818CF8' } },
          { id: 'bug', name: 'Bug', color: { light: '#0EA5E9', dark: '#38BDF8' } },
          { id: 'automation', name: 'Automation', color: { light: '#06B6D4', dark: '#22D3EE' } },
        ],
      },
      {
        id: 'content',
        name: 'Content',
        color: { light: '#8B5CF6', dark: '#A78BFA' },
        children: [
          { id: 'writing', name: 'Writing', color: { light: '#7C3AED', dark: '#C4B5FD' } },
          { id: 'research', name: 'Research', color: { light: '#A855F7', dark: '#C084FC' } },
          { id: 'design', name: 'Design', color: { light: '#D946EF', dark: '#E879F9' } },
        ],
      },
      {
        id: 'priority',
        name: 'Priority',
        color: { light: '#F59E0B', dark: '#FBBF24' },
        valueType: 'number',
      },
      {
        id: 'project',
        name: 'Project',
        color: 'foreground/50',
        valueType: 'string',
      },
    ],
  };
}

// ─── Core CRUD (SQLite) ─────────────────────────────────────────────────────

export function loadLabelConfig(workspaceRootPath: string): WorkspaceLabelConfig {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select().from(labelConfig).get();

  if (!row) {
    const defaults = getDefaultLabelConfig();
    saveLabelConfig(workspaceRootPath, defaults);
    return defaults;
  }

  const config: WorkspaceLabelConfig = {
    version: row.version,
    labels: row.labels as LabelConfig[],
  };

  const didMigrate = migrateLabelColors(config);
  if (didMigrate) {
    saveLabelConfig(workspaceRootPath, config);
  }

  return config;
}

export function saveLabelConfig(workspaceRootPath: string, config: WorkspaceLabelConfig): void {
  const db = getWorkspaceDb(workspaceRootPath);

  db.delete(labelConfig).run();
  db.insert(labelConfig).values({
    id: 1,
    version: config.version,
    labels: config.labels,
  }).run();

  dbEvents.emit('label:config');
}

export function listLabels(workspaceRootPath: string): LabelConfig[] {
  const config = loadLabelConfig(workspaceRootPath);
  return config.labels;
}

export function listLabelsFlat(workspaceRootPath: string): LabelConfig[] {
  const config = loadLabelConfig(workspaceRootPath);
  return flattenLabels(config.labels);
}

export function getLabel(workspaceRootPath: string, labelId: string): LabelConfig | null {
  const config = loadLabelConfig(workspaceRootPath);
  return findLabelById(config.labels, labelId) ?? null;
}

export function isValidLabelId(workspaceRootPath: string, labelId: string): boolean {
  const label = getLabel(workspaceRootPath, labelId);
  return label !== null;
}

export function isValidLabelIdFormat(labelId: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(labelId);
}
