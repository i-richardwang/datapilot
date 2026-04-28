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

/**
 * Default label set for new workspaces.
 *
 * Picked for DataPilot's data-analysis positioning. Three flat categorical
 * labels mark workflow stage / output type:
 *   Preparation — data prep / cleaning / transformation
 *   Analysis    — exploration / modeling / investigation
 *   Report      — deliverables (writeups, dashboards, visualizations)
 * Plus two valued labels carrying typed metadata per session:
 *   Priority  — number, for ordering / triage
 *   Project   — string, for grouping sessions under a named project
 *
 * Sub-categories were intentionally dropped after evaluating overlap
 * (e.g. "exploration vs visualization" blur inside Analysis); the flat shape
 * keeps classification fast for non-DS users while leaving room for
 * per-workspace customization.
 */
export function getDefaultLabelConfig(): WorkspaceLabelConfig {
  return {
    version: 1,
    labels: [
      {
        id: 'preparation',
        name: 'Preparation',
        color: { light: '#3B82F6', dark: '#60A5FA' }, // blue — data prep
      },
      {
        id: 'analysis',
        name: 'Analysis',
        color: { light: '#8B5CF6', dark: '#A78BFA' }, // purple — analytical work
      },
      {
        id: 'report',
        name: 'Report',
        color: { light: '#10B981', dark: '#34D399' }, // green — deliverable
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
