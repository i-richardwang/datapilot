/**
 * Turn Usage Storage — SQLite Backend
 *
 * Append-only per-turn token usage tracking.
 * One row per API call, aligned with Claude Code's JSONL usage format.
 *
 * Key properties:
 * - Not copied during session fork (only messages are copied)
 * - CASCADE-deleted when the parent session is hard-deleted
 * - Aggregatable via SUM() for session/workspace totals
 */

import { eq, sql } from 'drizzle-orm';
import { getWorkspaceDb } from '../db/connection.ts';
import { turnUsage } from '../db/schema/sessions.sql.ts';

export interface TurnUsageRecord {
  sessionId: string;
  messageId?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number;
  timestamp: number;
}

export interface SessionUsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalCostUsd: number;
}

// ============================================================================
// Write
// ============================================================================

/**
 * Append a turn usage record for a single API call.
 */
export function saveTurnUsage(workspaceRootPath: string, record: TurnUsageRecord): void {
  const db = getWorkspaceDb(workspaceRootPath);
  db.insert(turnUsage).values({
    sessionId: record.sessionId,
    messageId: record.messageId ?? null,
    model: record.model ?? null,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    cacheCreationInputTokens: record.cacheCreationInputTokens,
    cacheReadInputTokens: record.cacheReadInputTokens,
    costUsd: record.costUsd,
    timestamp: record.timestamp,
  }).run();
}

// ============================================================================
// Read
// ============================================================================

/**
 * Get all turn usage records for a session, ordered by timestamp.
 */
export function getSessionTurnUsage(workspaceRootPath: string, sessionId: string): TurnUsageRecord[] {
  const db = getWorkspaceDb(workspaceRootPath);
  const rows = db.select().from(turnUsage)
    .where(eq(turnUsage.sessionId, sessionId))
    .orderBy(turnUsage.timestamp)
    .all();

  return rows.map(row => ({
    sessionId: row.sessionId,
    messageId: row.messageId ?? undefined,
    model: row.model ?? undefined,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheCreationInputTokens: row.cacheCreationInputTokens,
    cacheReadInputTokens: row.cacheReadInputTokens,
    costUsd: row.costUsd,
    timestamp: row.timestamp,
  }));
}

/**
 * Get aggregated usage summary for a session.
 */
export function getSessionUsageSummary(workspaceRootPath: string, sessionId: string): SessionUsageSummary {
  const db = getWorkspaceDb(workspaceRootPath);
  const result = db.all<{
    total_input: number;
    total_output: number;
    total_cache_creation: number;
    total_cache_read: number;
    total_cost: number;
  }>(sql`
    SELECT
      COALESCE(SUM(input_tokens), 0) AS total_input,
      COALESCE(SUM(output_tokens), 0) AS total_output,
      COALESCE(SUM(cache_creation_input_tokens), 0) AS total_cache_creation,
      COALESCE(SUM(cache_read_input_tokens), 0) AS total_cache_read,
      COALESCE(SUM(cost_usd), 0) AS total_cost
    FROM turn_usage
    WHERE session_id = ${sessionId}
  `);

  const row = result[0];
  return {
    totalInputTokens: row?.total_input ?? 0,
    totalOutputTokens: row?.total_output ?? 0,
    totalCacheCreationTokens: row?.total_cache_creation ?? 0,
    totalCacheReadTokens: row?.total_cache_read ?? 0,
    totalCostUsd: row?.total_cost ?? 0,
  };
}
