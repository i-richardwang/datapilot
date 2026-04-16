/**
 * Sessions Schema
 *
 * Chat sessions with messages. Session metadata is fully denormalized into
 * columns for efficient list queries. Messages are stored as JSON blobs.
 *
 * Replaces: {workspace}/sessions/{id}/session.jsonl
 * Session directories still exist on disk for: attachments/, plans/, data/, downloads/, long_responses/
 */

import { sqliteTable, text, integer, real, index, primaryKey } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable('sessions', {
  // Identity
  id: text('id').primaryKey(),
  sdkSessionId: text('sdk_session_id'),
  /** SDK cwd — stored as portable path, expanded on read */
  sdkCwd: text('sdk_cwd'),

  // Timestamps
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'number' }).notNull(),
  lastMessageAt: integer('last_message_at', { mode: 'number' }),

  // Display
  name: text('name'),
  isFlagged: integer('is_flagged', { mode: 'boolean' }).default(false),
  /** Dynamic status ID referencing workspace status config */
  sessionStatus: text('session_status').default('todo'),
  /** Label IDs as JSON array (bare IDs or "id::value" entries) */
  labels: text('labels', { mode: 'json' }),
  hidden: integer('hidden', { mode: 'boolean' }).default(false),
  isBatch: integer('is_batch', { mode: 'boolean' }).default(false),

  // Read tracking
  lastReadMessageId: text('last_read_message_id'),
  hasUnread: integer('has_unread', { mode: 'boolean' }).default(false),

  // Config
  /** Enabled source slugs as JSON array */
  enabledSourceSlugs: text('enabled_source_slugs', { mode: 'json' }),
  /** 'safe' | 'ask' | 'allow-all' */
  permissionMode: text('permission_mode'),
  previousPermissionMode: text('previous_permission_mode'),
  /** Working directory — stored as portable path */
  workingDirectory: text('working_directory'),

  // Model/Connection
  model: text('model'),
  llmConnection: text('llm_connection'),
  connectionLocked: integer('connection_locked', { mode: 'boolean' }),
  /** 'off' | 'think' | 'max' */
  thinkingLevel: text('thinking_level'),

  // Sharing
  sharedUrl: text('shared_url'),
  sharedId: text('shared_id'),
  /** HTML shares keyed by sha256(html) — JSON object: { [hash]: { sharedUrl, sharedId } } */
  htmlShares: text('html_shares', { mode: 'json' }),

  // Plan execution state as JSON
  pendingPlanExecution: text('pending_plan_execution', { mode: 'json' }),

  // Archive
  isArchived: integer('is_archived', { mode: 'boolean' }).default(false),
  archivedAt: integer('archived_at', { mode: 'number' }),

  // Branching
  branchFromMessageId: text('branch_from_message_id'),
  branchFromSdkSessionId: text('branch_from_sdk_session_id'),
  branchFromSessionPath: text('branch_from_session_path'),
  branchFromSdkCwd: text('branch_from_sdk_cwd'),
  branchFromSdkTurnId: text('branch_from_sdk_turn_id'),

  // Remote transfer
  transferredSessionSummary: text('transferred_session_summary'),
  transferredSessionSummaryApplied: integer('transferred_session_summary_applied', { mode: 'boolean' }),

  // Automation origin as JSON
  triggeredBy: text('triggered_by', { mode: 'json' }),

  // Pre-computed fields (replaces JSONL header pre-computation)
  messageCount: integer('message_count').default(0),
  lastMessageRole: text('last_message_role'),
  /** First 150 chars of first user message */
  preview: text('preview'),
  lastFinalMessageId: text('last_final_message_id'),

  // Token usage as JSON
  tokenUsage: text('token_usage', { mode: 'json' }).notNull()
    .default('{"inputTokens":0,"outputTokens":0,"totalTokens":0,"contextTokens":0,"costUsd":0}'),
}, (table) => [
  index('idx_sessions_last_used').on(table.lastUsedAt),
  index('idx_sessions_status').on(table.sessionStatus),
  index('idx_sessions_archived').on(table.isArchived),
  index('idx_sessions_flagged').on(table.isFlagged),
  index('idx_sessions_hidden').on(table.hidden),
]);

/** Session messages — one row per message, ordered by position */
export const messages = sqliteTable('messages', {
  id: text('id').notNull(),
  sessionId: text('session_id').notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  /** Insertion order within session (0-based) */
  position: integer('position').notNull(),
  /** Full StoredMessage as JSON (content made portable via {{SESSION_PATH}} token) */
  content: text('content', { mode: 'json' }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.sessionId, table.id] }),
  index('idx_messages_session_pos').on(table.sessionId, table.position),
]);

/**
 * Per-turn token usage — one row per API call (append-only, permanent).
 *
 * Provides accurate, per-turn granularity for usage statistics.
 * Column names align with Claude Code's JSONL usage format.
 *
 * Key properties:
 * - NOT copied during session fork (only messages are copied)
 * - NOT deleted when the parent session is hard-deleted (permanent audit log)
 * - Aggregatable via simple SUM() queries for session/workspace totals
 */
export const turnUsage = sqliteTable('turn_usage', {
  rowId: integer('rowid').primaryKey({ autoIncrement: true }),
  /** Session ID (no foreign key — records survive session deletion) */
  sessionId: text('session_id').notNull(),
  /** Assistant message ID this turn produced (if any) */
  messageId: text('message_id'),
  /** Model used for this API call */
  model: text('model'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheCreationInputTokens: integer('cache_creation_input_tokens').notNull().default(0),
  cacheReadInputTokens: integer('cache_read_input_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  timestamp: integer('timestamp', { mode: 'number' }).notNull(),
}, (table) => [
  index('idx_turn_usage_session').on(table.sessionId),
  index('idx_turn_usage_timestamp').on(table.timestamp),
]);
