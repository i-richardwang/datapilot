/**
 * Statuses Schema
 *
 * Workspace-level customizable workflow states.
 * Replaces: {workspace}/statuses/config.json
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/** Individual status definitions */
export const statuses = sqliteTable('statuses', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  /** EntityColor stored as JSON (e.g., { hue: 200, saturation: 80, lightness: 50 }) */
  color: text('color', { mode: 'json' }),
  /** Emoji, SVG filename (relative to statuses/icons/), or URL */
  icon: text('icon'),
  /** Keyboard shortcut character */
  shortcut: text('shortcut'),
  /** 'open' or 'closed' — determines inbox vs completed classification */
  category: text('category').notNull(),
  /** Fixed statuses (todo, done, cancelled) cannot be deleted */
  isFixed: integer('is_fixed', { mode: 'boolean' }).notNull(),
  /** The default status assigned to new sessions */
  isDefault: integer('is_default', { mode: 'boolean' }).notNull(),
  /** Display order in status picker */
  order: integer('order').notNull(),
});

/** Status config metadata (single-row table) */
export const statusMeta = sqliteTable('status_meta', {
  id: integer('id').primaryKey().default(1),
  version: integer('version').notNull().default(1),
  defaultStatusId: text('default_status_id').notNull().default('todo'),
});
