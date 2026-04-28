/**
 * Label Storage
 *
 * Filesystem-based storage for workspace label configurations.
 * Labels are stored at {workspaceRootPath}/labels/config.json
 *
 * Hierarchy: Labels form a nested JSON tree. IDs are simple slugs.
 * New workspaces are seeded with default labels — three flat categorical
 * labels (Cleaning / Analysis / Report) plus two valued labels (Priority,
 * Project). See `getDefaultLabelConfig()` below for rationale.
 * Labels are visual by color only (colored circles in the UI).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { WorkspaceLabelConfig, LabelConfig } from './types.ts';
import { flattenLabels, findLabelById } from './tree.ts';
import { readJsonFileSync } from '../utils/files.ts';
import { migrateLabelColors } from '../colors/migrate.ts';
import { debug } from '../utils/debug.ts';

const LABEL_CONFIG_DIR = 'labels';
const LABEL_CONFIG_FILE = 'labels/config.json';

/**
 * Get default label configuration.
 *
 * Picked for DataPilot's data-analysis positioning. Three flat categorical
 * labels mark workflow stage / output type:
 *   Cleaning  — data prep / transformation (most analyst data work)
 *   Analysis  — exploration / modeling / investigation
 *   Report    — deliverables (writeups, dashboards, visualizations)
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
        id: 'cleaning',
        name: 'Cleaning',
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

/**
 * Load workspace label configuration.
 * Returns empty config if no file exists or parsing fails.
 * Auto-migrates old Tailwind color format to EntityColor on first load.
 */
export function loadLabelConfig(workspaceRootPath: string): WorkspaceLabelConfig {
  const configPath = join(workspaceRootPath, LABEL_CONFIG_FILE);

  // If no config file exists, seed with defaults and persist to disk.
  // This ensures existing workspaces (created before default labels existed) get populated.
  if (!existsSync(configPath)) {
    const defaults = getDefaultLabelConfig();
    debug('[loadLabelConfig] No config found, seeding with default labels');
    saveLabelConfig(workspaceRootPath, defaults);
    return defaults;
  }

  try {
    const config = readJsonFileSync<WorkspaceLabelConfig>(configPath);

    // Auto-migrate old Tailwind class colors (e.g., "text-accent") to new EntityColor format.
    // If migration occurs, write the updated config back to disk.
    const migrated = migrateLabelColors(config);
    if (migrated) {
      debug('[loadLabelConfig] Migrated old color format, writing back');
      saveLabelConfig(workspaceRootPath, config);
    }

    return config;
  } catch (error) {
    debug('[loadLabelConfig] Failed to parse config:', error);
    return getDefaultLabelConfig();
  }
}

/**
 * Save workspace label configuration to disk.
 * Creates the labels directory if missing.
 */
export function saveLabelConfig(
  workspaceRootPath: string,
  config: WorkspaceLabelConfig
): void {
  const labelDir = join(workspaceRootPath, LABEL_CONFIG_DIR);
  const configPath = join(workspaceRootPath, LABEL_CONFIG_FILE);

  if (!existsSync(labelDir)) {
    mkdirSync(labelDir, { recursive: true });
  }

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    debug('[saveLabelConfig] Failed to save config:', error);
    throw error;
  }
}

/**
 * Get the label tree (root-level labels with nested children).
 * Primary accessor for the UI — returns the tree structure as-is from config.
 */
export function listLabels(workspaceRootPath: string): LabelConfig[] {
  const config = loadLabelConfig(workspaceRootPath);
  return config.labels;
}

/**
 * Get all labels as a flat list (tree flattened depth-first).
 * Useful for lookups, session label validation, and non-hierarchical display.
 */
export function listLabelsFlat(workspaceRootPath: string): LabelConfig[] {
  const config = loadLabelConfig(workspaceRootPath);
  return flattenLabels(config.labels);
}

/**
 * Get a single label by ID (searches the entire tree).
 * Returns null if not found.
 */
export function getLabel(
  workspaceRootPath: string,
  labelId: string
): LabelConfig | null {
  const config = loadLabelConfig(workspaceRootPath);
  return findLabelById(config.labels, labelId) || null;
}

/**
 * Check if a label ID exists in this workspace (searches entire tree)
 */
export function isValidLabelId(
  workspaceRootPath: string,
  labelId: string
): boolean {
  const config = loadLabelConfig(workspaceRootPath);
  return !!findLabelById(config.labels, labelId);
}

/**
 * Validate label ID format.
 * Simple slug: lowercase alphanumeric + hyphens, no leading/trailing hyphens.
 * Examples: "bug", "frontend", "my-label"
 */
export function isValidLabelIdFormat(labelId: string): boolean {
  if (!labelId) return false;
  const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  return SLUG_PATTERN.test(labelId);
}


