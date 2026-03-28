/**
 * Views Storage — SQLite Backend
 *
 * Drop-in replacement for storage.ts with identical exported function signatures.
 * Stores the views array as a JSON document in workspace.db.
 */

import type { ViewConfig } from './types.ts';
import { viewsConfig } from '../db/schema/views.sql.ts';
import { getWorkspaceDb } from '../db/connection.ts';
import { dbEvents } from '../db/events.ts';
import { getDefaultViews } from './defaults.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ViewsConfig {
  version: number;
  views: ViewConfig[];
}

// ─── Core CRUD (SQLite) ─────────────────────────────────────────────────────

export function loadViewsConfig(workspaceRootPath: string): ViewsConfig {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select().from(viewsConfig).get();

  if (!row) {
    const defaults: ViewsConfig = {
      version: 1,
      views: getDefaultViews(),
    };
    saveViewsConfig(workspaceRootPath, defaults);
    return defaults;
  }

  return {
    version: row.version,
    views: (row.views as ViewConfig[]) ?? [],
  };
}

export function saveViewsConfig(workspaceRootPath: string, config: ViewsConfig): void {
  const db = getWorkspaceDb(workspaceRootPath);

  db.delete(viewsConfig).run();
  db.insert(viewsConfig).values({
    id: 1,
    version: config.version,
    views: config.views,
  }).run();

  dbEvents.emit('view:config');
}

export function listViews(workspaceRootPath: string): ViewConfig[] {
  const config = loadViewsConfig(workspaceRootPath);
  return config.views ?? [];
}

export function saveViews(workspaceRootPath: string, views: ViewConfig[]): void {
  const config = loadViewsConfig(workspaceRootPath);
  config.views = views;
  saveViewsConfig(workspaceRootPath, config);
}
