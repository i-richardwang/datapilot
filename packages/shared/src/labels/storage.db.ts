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
        color: { hue: 220, saturation: 80, lightness: 55 },
        children: [
          { id: 'code', name: 'Code', color: { hue: 230, saturation: 75, lightness: 55 } },
          { id: 'bug', name: 'Bug', color: { hue: 0, saturation: 80, lightness: 55 } },
          { id: 'automation', name: 'Automation', color: { hue: 280, saturation: 70, lightness: 55 } },
        ],
      },
      {
        id: 'content',
        name: 'Content',
        color: { hue: 280, saturation: 70, lightness: 55 },
        children: [
          { id: 'writing', name: 'Writing', color: { hue: 290, saturation: 65, lightness: 55 } },
          { id: 'research', name: 'Research', color: { hue: 170, saturation: 70, lightness: 45 } },
          { id: 'design', name: 'Design', color: { hue: 320, saturation: 70, lightness: 55 } },
        ],
      },
      {
        id: 'priority',
        name: 'Priority',
        color: { hue: 35, saturation: 90, lightness: 50 },
        valueType: 'number',
      },
      {
        id: 'project',
        name: 'Project',
        color: { hue: 200, saturation: 75, lightness: 50 },
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
