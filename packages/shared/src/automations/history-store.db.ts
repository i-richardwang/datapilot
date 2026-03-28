/**
 * History Store — SQLite Backend
 *
 * Drop-in replacement for history-store.ts.
 * Reads/writes automation history to workspace.db instead of automations-history.jsonl.
 *
 * SQLite transactions replace the per-workspace mutex.
 * Compaction uses SQL DELETE subqueries instead of in-memory filtering.
 */

import { sql, eq } from 'drizzle-orm';
import { getWorkspaceDb } from '../db/connection.ts';
import { dbEvents } from '../db/events.ts';
import { automationHistory } from '../db/schema/automations.sql.ts';
import {
  AUTOMATION_HISTORY_MAX_RUNS_PER_MATCHER,
  AUTOMATION_HISTORY_MAX_ENTRIES,
} from './constants.ts';

// ============================================================================
// Append
// ============================================================================

/**
 * Append a history entry to the DB.
 * Triggers compaction when total entries exceed the global cap.
 *
 * The entry must already be a fully-formed history object.
 */
export async function appendAutomationHistoryEntry(
  workspaceRootPath: string,
  entry: Record<string, unknown>,
): Promise<void> {
  const db = getWorkspaceDb(workspaceRootPath);

  const automationId = (entry.id as string) ?? '';
  db.insert(automationHistory).values({
    automationId,
    entry,
    createdAt: Date.now(),
  }).run();

  dbEvents.emit('automation:history');

  // Check if compaction is needed using raw SQL
  const countResult = db.all<{ cnt: number }>(sql`SELECT count(*) as cnt FROM automation_history`);
  if (countResult[0] && countResult[0].cnt >= AUTOMATION_HISTORY_MAX_ENTRIES) {
    compactAutomationHistorySync(workspaceRootPath);
  }
}

// ============================================================================
// Compaction
// ============================================================================

/**
 * Compact the automation history asynchronously.
 */
export async function compactAutomationHistory(
  workspaceRootPath: string,
  maxPerMatcher: number = AUTOMATION_HISTORY_MAX_RUNS_PER_MATCHER,
  maxTotal: number = AUTOMATION_HISTORY_MAX_ENTRIES,
): Promise<void> {
  compactAutomationHistorySync(workspaceRootPath, maxPerMatcher, maxTotal);
}

/**
 * Compact the automation history synchronously.
 *
 * Two-tier retention:
 * 1. Per-automation cap: keep last N entries per automation ID
 * 2. Global cap: keep last M entries overall
 */
export function compactAutomationHistorySync(
  workspaceRootPath: string,
  maxPerMatcher: number = AUTOMATION_HISTORY_MAX_RUNS_PER_MATCHER,
  maxTotal: number = AUTOMATION_HISTORY_MAX_ENTRIES,
): void {
  const db = getWorkspaceDb(workspaceRootPath);

  // 1) Per-automation cap: delete older entries beyond maxPerMatcher per automation
  db.run(sql`
    DELETE FROM automation_history
    WHERE rowid NOT IN (
      SELECT rowid FROM (
        SELECT rowid, ROW_NUMBER() OVER (
          PARTITION BY automation_id ORDER BY rowid DESC
        ) as rn FROM automation_history
      ) WHERE rn <= ${maxPerMatcher}
    )
  `);

  // 2) Global cap: keep only last maxTotal entries
  db.run(sql`
    DELETE FROM automation_history
    WHERE rowid NOT IN (
      SELECT rowid FROM automation_history
      ORDER BY rowid DESC LIMIT ${maxTotal}
    )
  `);
}
