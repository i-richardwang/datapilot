/**
 * Status Storage — SQLite Backend
 *
 * Drop-in replacement for storage.ts with identical exported function signatures.
 * Reads/writes status configuration from workspace.db instead of statuses/config.json.
 *
 * Icon handling remains filesystem-based (statuses/icons/).
 */

import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, extname } from 'path';
import { eq } from 'drizzle-orm';
import type { WorkspaceStatusConfig, StatusConfig, StatusCategory } from './types.ts';
import { statuses as statusesTable, statusMeta } from '../db/schema/statuses.sql.ts';
import { getWorkspaceDb } from '../db/connection.ts';
import { dbEvents } from '../db/events.ts';
import { DEFAULT_ICON_SVGS } from './default-icons.ts';
import {
  downloadIcon,
  needsIconDownload,
  isIconUrl,
  ICON_EXTENSIONS,
} from '../utils/icon.ts';
import { migrateStatusColors } from '../colors/migrate.ts';
import { FEATURE_FLAGS } from '../feature-flags.ts';

export { isIconUrl } from '../utils/icon.ts';

const STATUS_ICONS_DIR = 'statuses/icons';

// ─── Defaults ───────────────────────────────────────────────────────────────

export function getDefaultStatusConfig(): WorkspaceStatusConfig {
  const lite = FEATURE_FLAGS.liteUi;
  const statusList: StatusConfig[] = [
    ...(!lite ? [{
      id: 'backlog',
      label: 'Backlog',
      category: 'open' as StatusCategory,
      isFixed: false,
      isDefault: true,
      order: 0,
    }] : []),
    {
      id: 'todo',
      label: 'Todo',
      category: 'open' as StatusCategory,
      isFixed: true,
      isDefault: false,
      order: lite ? 0 : 1,
    },
    ...(!lite ? [{
      id: 'needs-review',
      label: 'Needs Review',
      category: 'open' as StatusCategory,
      isFixed: false,
      isDefault: true,
      order: 2,
    }] : []),
    {
      id: 'done',
      label: 'Done',
      category: 'closed' as StatusCategory,
      isFixed: true,
      isDefault: false,
      order: lite ? 1 : 3,
    },
    {
      id: 'cancelled',
      label: 'Cancelled',
      category: 'closed' as StatusCategory,
      isFixed: true,
      isDefault: false,
      order: lite ? 2 : 4,
    },
  ];

  return {
    version: 1,
    statuses: statusList,
    defaultStatusId: 'todo',
  };
}

// ─── Icon Utilities (filesystem-based, unchanged) ───────────────────────────

export function ensureDefaultIconFiles(workspaceRootPath: string): void {
  const iconsDir = join(workspaceRootPath, STATUS_ICONS_DIR);
  if (!existsSync(iconsDir)) {
    mkdirSync(iconsDir, { recursive: true });
  }
  for (const [filename, svg] of Object.entries(DEFAULT_ICON_SVGS)) {
    const svgFilename = filename.endsWith('.svg') ? filename : `${filename}.svg`;
    const filePath = join(iconsDir, svgFilename);
    if (!existsSync(filePath)) {
      const { writeFileSync } = require('fs');
      writeFileSync(filePath, svg, 'utf-8');
    }
  }
}

export function findStatusIcon(workspaceRootPath: string, statusId: string): string | undefined {
  const iconsDir = join(workspaceRootPath, STATUS_ICONS_DIR);
  if (!existsSync(iconsDir)) return undefined;
  for (const ext of ICON_EXTENSIONS) {
    const filePath = join(iconsDir, `${statusId}.${ext}`);
    if (existsSync(filePath)) return filePath;
  }
  return undefined;
}

export async function downloadStatusIcon(
  workspaceRootPath: string,
  statusId: string,
  iconUrl: string,
): Promise<string | null> {
  const iconsDir = join(workspaceRootPath, STATUS_ICONS_DIR);
  if (!existsSync(iconsDir)) {
    mkdirSync(iconsDir, { recursive: true });
  }
  // Remove old icon files with different extensions
  for (const ext of ICON_EXTENSIONS) {
    const oldPath = join(iconsDir, `${statusId}.${ext}`);
    if (existsSync(oldPath)) {
      try { unlinkSync(oldPath); } catch { /* ignore */ }
    }
  }
  return downloadIcon(iconsDir, statusId, iconUrl);
}

export function statusNeedsIconDownload(workspaceRootPath: string, status: StatusConfig): boolean {
  if (!status.icon || !isIconUrl(status.icon)) return false;
  return !findStatusIcon(workspaceRootPath, status.id);
}

// ─── Core CRUD (SQLite) ─────────────────────────────────────────────────────

export function loadStatusConfig(workspaceRootPath: string): WorkspaceStatusConfig {
  const db = getWorkspaceDb(workspaceRootPath);

  const meta = db.select().from(statusMeta).get();
  const rows = db.select().from(statusesTable).orderBy(statusesTable.order).all();

  if (!meta || rows.length === 0) {
    // First load: seed with defaults
    const defaults = getDefaultStatusConfig();
    saveStatusConfig(workspaceRootPath, defaults);
    ensureDefaultIconFiles(workspaceRootPath);
    return defaults;
  }

  const config: WorkspaceStatusConfig = {
    version: meta.version,
    defaultStatusId: meta.defaultStatusId,
    statuses: rows.map(rowToStatusConfig),
  };

  // Validate required fixed statuses
  const requiredIds = ['todo', 'done', 'cancelled'];
  const existingIds = new Set(config.statuses.map(s => s.id));
  const defaults = getDefaultStatusConfig();
  for (const id of requiredIds) {
    if (!existingIds.has(id)) {
      const defaultStatus = defaults.statuses.find(s => s.id === id);
      if (defaultStatus) {
        config.statuses.push(defaultStatus);
      }
    }
  }

  // Auto-migrate old Tailwind colors (mutates in-place, returns boolean)
  const didMigrate = migrateStatusColors(config);
  if (didMigrate) {
    saveStatusConfig(workspaceRootPath, config);
  }

  ensureDefaultIconFiles(workspaceRootPath);
  return config;
}

export function saveStatusConfig(workspaceRootPath: string, config: WorkspaceStatusConfig): void {
  const db = getWorkspaceDb(workspaceRootPath);

  db.transaction((tx) => {
    // Upsert meta
    tx.delete(statusMeta).run();
    tx.insert(statusMeta).values({
      id: 1,
      version: config.version,
      defaultStatusId: config.defaultStatusId,
    }).run();

    // Replace all statuses
    tx.delete(statusesTable).run();
    if (config.statuses.length > 0) {
      tx.insert(statusesTable).values(
        config.statuses.map(statusConfigToRow)
      ).run();
    }
  });

  dbEvents.emit('status:config');
}

export function getStatus(workspaceRootPath: string, statusId: string): StatusConfig | null {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select().from(statusesTable).where(eq(statusesTable.id, statusId)).get();
  return row ? rowToStatusConfig(row) : null;
}

export function listStatuses(workspaceRootPath: string): StatusConfig[] {
  const db = getWorkspaceDb(workspaceRootPath);
  const rows = db.select().from(statusesTable).orderBy(statusesTable.order).all();
  return rows.map(rowToStatusConfig);
}

export function isValidStatusId(workspaceRootPath: string, statusId: string): boolean {
  const status = getStatus(workspaceRootPath, statusId);
  return status !== null;
}

export function getStatusCategory(workspaceRootPath: string, statusId: string): StatusCategory | null {
  const status = getStatus(workspaceRootPath, statusId);
  return status ? status.category as StatusCategory : null;
}

// ─── Row Converters ─────────────────────────────────────────────────────────

function rowToStatusConfig(row: typeof statusesTable.$inferSelect): StatusConfig {
  return {
    id: row.id,
    label: row.label,
    color: row.color as StatusConfig['color'],
    icon: row.icon ?? undefined,
    category: row.category as StatusCategory,
    isFixed: row.isFixed,
    isDefault: row.isDefault,
    order: row.order,
  };
}

function statusConfigToRow(s: StatusConfig): typeof statusesTable.$inferInsert {
  return {
    id: s.id,
    label: s.label,
    color: s.color ? s.color : null,
    icon: s.icon ?? null,
    shortcut: (s as { shortcut?: string }).shortcut ?? null,
    category: s.category,
    isFixed: s.isFixed,
    isDefault: s.isDefault,
    order: s.order,
  };
}
