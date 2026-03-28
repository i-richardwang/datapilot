/**
 * Sources Schema
 *
 * External data connections (MCP servers, APIs, local filesystems).
 * Stores config, guide, and permissions in DB. Icon files remain on filesystem.
 * Replaces: {workspace}/sources/{slug}/config.json, guide.md, permissions.json
 */

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const sources = sqliteTable('sources', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  /** 'mcp' | 'api' | 'local' | 'gmail' */
  type: text('type').notNull(),
  /** Full FolderSourceConfig object as JSON */
  config: text('config', { mode: 'json' }).notNull(),
  /** Parsed SourceGuide object as JSON (from guide.md) */
  guide: text('guide', { mode: 'json' }),
  /** Raw guide.md Markdown content */
  guideRaw: text('guide_raw'),
  /** Source-specific permissions rules as JSON (from permissions.json) */
  permissions: text('permissions', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'number' }),
  updatedAt: integer('updated_at', { mode: 'number' }),
});
