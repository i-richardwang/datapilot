/**
 * Migration System
 *
 * Applies SQL migrations to workspace databases at startup.
 * Migrations are embedded as string constants to avoid filesystem dependencies
 * in bundled environments (Electron, Bun single-file builds).
 *
 * Migration tracking uses a simple `_migrations` table to record which
 * migrations have been applied.
 */

import { sql } from 'drizzle-orm';
import type { DrizzleDatabase } from './driver.ts';

interface Migration {
  name: string;
  sql: string;
}

/**
 * All workspace migrations in order.
 * Each migration runs inside a transaction.
 *
 * To add a new migration:
 * 1. Add a new entry at the end of this array
 * 2. Use a sequential number prefix (0001, 0002, etc.)
 * 3. Write idempotent SQL (use IF NOT EXISTS where possible)
 */
const WORKSPACE_MIGRATIONS: Migration[] = [
  {
    name: '0000_initial',
    sql: `
      -- Workspace config (single-row)
      CREATE TABLE IF NOT EXISTS workspace_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        config TEXT NOT NULL
      );

      -- Status meta (single-row)
      CREATE TABLE IF NOT EXISTS status_meta (
        id INTEGER PRIMARY KEY DEFAULT 1,
        version INTEGER NOT NULL DEFAULT 1,
        default_status_id TEXT NOT NULL DEFAULT 'todo'
      );

      -- Statuses
      CREATE TABLE IF NOT EXISTS statuses (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        color TEXT,
        icon TEXT,
        shortcut TEXT,
        category TEXT NOT NULL,
        is_fixed INTEGER NOT NULL,
        is_default INTEGER NOT NULL,
        "order" INTEGER NOT NULL
      );

      -- Label config (single-row, tree stored as JSON)
      CREATE TABLE IF NOT EXISTS label_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        version INTEGER NOT NULL DEFAULT 1,
        labels TEXT NOT NULL
      );

      -- Views config (single-row, array stored as JSON)
      CREATE TABLE IF NOT EXISTS views_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        version INTEGER NOT NULL DEFAULT 1,
        views TEXT NOT NULL
      );

      -- Sources
      CREATE TABLE IF NOT EXISTS sources (
        slug TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        config TEXT NOT NULL,
        guide TEXT,
        guide_raw TEXT,
        permissions TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );

      -- Sessions
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        sdk_session_id TEXT,
        sdk_cwd TEXT,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        last_message_at INTEGER,
        name TEXT,
        is_flagged INTEGER DEFAULT 0,
        session_status TEXT DEFAULT 'todo',
        labels TEXT,
        hidden INTEGER DEFAULT 0,
        is_batch INTEGER DEFAULT 0,
        last_read_message_id TEXT,
        has_unread INTEGER DEFAULT 0,
        enabled_source_slugs TEXT,
        permission_mode TEXT,
        previous_permission_mode TEXT,
        working_directory TEXT,
        model TEXT,
        llm_connection TEXT,
        connection_locked INTEGER,
        thinking_level TEXT,
        shared_url TEXT,
        shared_id TEXT,
        pending_plan_execution TEXT,
        is_archived INTEGER DEFAULT 0,
        archived_at INTEGER,
        branch_from_message_id TEXT,
        branch_from_sdk_session_id TEXT,
        branch_from_session_path TEXT,
        branch_from_sdk_cwd TEXT,
        branch_from_sdk_turn_id TEXT,
        transferred_session_summary TEXT,
        transferred_session_summary_applied INTEGER,
        triggered_by TEXT,
        message_count INTEGER DEFAULT 0,
        last_message_role TEXT,
        preview TEXT,
        last_final_message_id TEXT,
        token_usage TEXT NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0,"totalTokens":0,"contextTokens":0,"costUsd":0}'
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_last_used ON sessions(last_used_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(session_status);
      CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(is_archived);
      CREATE INDEX IF NOT EXISTS idx_sessions_flagged ON sessions(is_flagged);
      CREATE INDEX IF NOT EXISTS idx_sessions_hidden ON sessions(hidden);

      -- Messages
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        content TEXT NOT NULL,
        PRIMARY KEY(session_id, id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session_pos ON messages(session_id, position);

      -- Automation history
      CREATE TABLE IF NOT EXISTS automation_history (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        automation_id TEXT NOT NULL,
        entry TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_history_automation ON automation_history(automation_id);
      CREATE INDEX IF NOT EXISTS idx_history_created ON automation_history(created_at);

      -- Batch state
      CREATE TABLE IF NOT EXISTS batch_state (
        batch_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Batch test results
      CREATE TABLE IF NOT EXISTS batch_test_results (
        batch_id TEXT PRIMARY KEY,
        result TEXT NOT NULL,
        config_hash TEXT NOT NULL,
        persisted_at INTEGER NOT NULL
      );
    `,
  },
  {
    name: '0001_turn_usage',
    sql: `
      -- Per-turn token usage (one row per API call, append-only, permanent)
      -- No foreign key to sessions — records survive session deletion
      CREATE TABLE IF NOT EXISTS turn_usage (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        message_id TEXT,
        model TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_turn_usage_session ON turn_usage(session_id);
      CREATE INDEX IF NOT EXISTS idx_turn_usage_timestamp ON turn_usage(timestamp);
    `,
  },
];

/**
 * Run all pending migrations on a database.
 * Called automatically by getWorkspaceDb() on first connection.
 */
export function runMigrations(db: DrizzleDatabase): void {
  // Create migration tracking table
  db.run(sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  // Get already-applied migrations
  const applied = new Set<string>();
  const rows = db.all<{ name: string }>(sql`SELECT name FROM _migrations`);
  for (const row of rows) {
    applied.add(row.name);
  }

  // Apply pending migrations
  for (const migration of WORKSPACE_MIGRATIONS) {
    if (applied.has(migration.name)) continue;

    // Run migration SQL (each statement separated by semicolons)
    const statements = migration.sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      db.run(sql.raw(statement));
    }

    // Record migration
    db.run(sql`INSERT INTO _migrations (name, applied_at) VALUES (${migration.name}, ${Date.now()})`);
  }
}
