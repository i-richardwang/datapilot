/**
 * Projects Schema
 *
 * Workspace-scoped project configs (name, working directory, prompt details,
 * Kanban columns).
 * Replaces: {workspace}/projects/{slug}/config.json
 * Project folders still exist on disk for: assets/, MEMORY.md
 */

import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  /** URL-safe folder name — remains the on-disk key for assets/ and MEMORY.md */
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  /** Short description shown in lists/detail header */
  description: text('description'),
  /** Path bound to this project — stored as portable path, expanded on read */
  workingDirectory: text('working_directory'),
  /** Free-form text injected into the system prompt as project context */
  details: text('details'),
  /** Color theme ID for project-branded UI */
  colorTheme: text('color_theme'),
  /** Accent color (hex) shown on bound sessions in the SessionList */
  color: text('color'),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
  /** Set when project is archived (hidden from sidebar but kept in DB) */
  archivedAt: integer('archived_at', { mode: 'number' }),
  /** Per-project Kanban columns as JSON array (KanbanColumnDef[]); NULL → default 3 columns */
  kanbanColumns: text('kanban_columns', { mode: 'json' }),
}, (table) => [
  uniqueIndex('idx_projects_slug').on(table.slug),
]);
