/**
 * Session Storage — SQLite Backend
 *
 * Drop-in replacement for storage.ts with identical exported function signatures.
 * Reads/writes session metadata and messages from workspace.db instead of
 * {workspace}/sessions/{id}/session.jsonl.
 *
 * Session directories still exist on disk for: attachments/, plans/, data/,
 * downloads/, long_responses/
 *
 * The persistence queue is NOT needed in DB mode — SQLite WAL writes < 1ms.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'fs';
import { join, basename } from 'path';
import { eq, and, desc, asc, inArray, sql, type SQL } from 'drizzle-orm';
import { getWorkspaceSessionsPath } from '../workspaces/storage.ts';
import { generateUniqueSessionId } from './slug-generator.ts';
import { toPortablePath, expandPath, normalizePath } from '../utils/paths.ts';
import { sanitizeSessionId } from './validation.ts';
import { listStatuses } from '../statuses/storage.db.ts';
import type {
  SessionConfig,
  StoredSession,
  SessionMetadata,
  SessionHeader,
  SessionTokenUsage,
  SessionStatus,
  StoredMessage,
} from './types.ts';
import type { Plan } from '../agent/plan-types.ts';
import { sessions as sessionsTable, messages as messagesTable } from '../db/schema/sessions.sql.ts';
import { getWorkspaceDb } from '../db/connection.ts';
import { dbEvents } from '../db/events.ts';
import { getStatusCategory } from '../statuses/storage.db.ts';

// Re-export types for convenience
export type { SessionConfig } from './types.ts';

export interface SessionMetadataQueryFilter {
  archived?: boolean;
  flagged?: boolean;
  batch?: boolean;
  batchId?: string;
  hasLabels?: boolean;
  statusInclude?: string[];
  statusExclude?: string[];
  labelIncludeGroups?: string[][];
  labelExclude?: string[];
  search?: string;
}

export interface SessionMetadataQueryOptions {
  filter?: SessionMetadataQueryFilter;
  sortBy?: 'recent' | 'name' | 'status';
  offset?: number;
  limit?: number;
  postFilter?: (metadata: SessionMetadata) => boolean;
}

export interface SessionMetadataPage {
  rows: SessionMetadata[];
  total: number;
}

export interface SessionCountRow {
  id: string;
  sessionStatus: SessionStatus;
  labels?: string[];
  isArchived?: boolean;
  isBatch?: boolean;
  isFlagged?: boolean;
  hasUnread?: boolean;
}

export interface SessionSidebarScalarCounts {
  total: number;
  flagged: number;
  archived: number;
  batch: number;
  unread: number;
  byStatus: Record<string, number>;
}

export interface SessionLabelCountRow {
  id: string;
  labels?: string[];
}

// ============================================================
// Session Path Portability (for message content)
// ============================================================

const SESSION_PATH_TOKEN = '{{SESSION_PATH}}';

function makeContentPortable(jsonStr: string, sessionDir: string): string {
  if (!sessionDir) return jsonStr;
  const normalized = normalizePath(sessionDir);
  let result = jsonStr.replaceAll(normalized, SESSION_PATH_TOKEN);
  if (sessionDir !== normalized) {
    const jsonEscaped = sessionDir.replaceAll('\\', '\\\\');
    result = result.replaceAll(jsonEscaped, SESSION_PATH_TOKEN);
  }
  return result;
}

function expandContent(jsonStr: string, sessionDir: string): string {
  if (typeof jsonStr !== 'string' || !jsonStr.includes(SESSION_PATH_TOKEN)) return jsonStr;
  return jsonStr.replaceAll(SESSION_PATH_TOKEN, normalizePath(sessionDir));
}

// ============================================================
// Directory Utilities (unchanged — still needed for attachments etc.)
// ============================================================

/**
 * Ensure sessions directory exists for a workspace
 */
export function ensureSessionsDir(workspaceRootPath: string): string {
  const dir = getWorkspaceSessionsPath(workspaceRootPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get path to a session's directory
 */
export function getSessionPath(workspaceRootPath: string, sessionId: string): string {
  const safeSessionId = sanitizeSessionId(sessionId);
  return join(getWorkspaceSessionsPath(workspaceRootPath), safeSessionId);
}

/**
 * Get path to a session's JSONL file (inside session folder)
 */
export function getSessionFilePath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'session.jsonl');
}

/**
 * Ensure session directory exists with all subdirectories
 */
export function ensureSessionDir(workspaceRootPath: string, sessionId: string): string {
  const sessionDir = getSessionPath(workspaceRootPath, sessionId);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
  for (const sub of ['plans', 'attachments', 'long_responses', 'data', 'downloads']) {
    const subDir = join(sessionDir, sub);
    if (!existsSync(subDir)) {
      mkdirSync(subDir, { recursive: true });
    }
  }
  return sessionDir;
}

/**
 * Get the attachments directory for a session
 */
export function getSessionAttachmentsPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'attachments');
}

/**
 * Get the plans directory for a session
 */
export function getSessionPlansPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'plans');
}

/**
 * Get the data directory for a session (transform_data tool output)
 */
export function getSessionDataPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'data');
}

/**
 * Get the downloads directory for a session (binary files from API responses)
 */
export function getSessionDownloadsPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'downloads');
}

// ============================================================
// Session ID Generation
// ============================================================

/**
 * Get existing session IDs from DB for collision detection.
 * id-only select — a full-row select hydrates ~50 columns (6 of them JSON)
 * per row, which costs hundreds of ms of synchronous work at 30k+ sessions
 * and runs on every session creation.
 */
function getExistingSessionIds(workspaceRootPath: string): Set<string> {
  const db = getWorkspaceDb(workspaceRootPath);
  const rows = db.select({ id: sessionsTable.id }).from(sessionsTable).all();
  return new Set(rows.map(r => r.id));
}

/**
 * Generate a human-readable session ID
 * Format: YYMMDD-adjective-noun (e.g., 260111-swift-river)
 */
export function generateSessionId(workspaceRootPath: string): string {
  const existingIds = getExistingSessionIds(workspaceRootPath);
  return generateUniqueSessionId(existingIds);
}

// ============================================================
// Row Converters
// ============================================================

type SessionRow = typeof sessionsTable.$inferSelect;

/**
 * StoredSession without message-derived state. Used by saveSessionMeta() so
 * metadata-only writes never need the messages array in memory.
 */
export type StoredSessionMeta = Omit<StoredSession, 'messages' | 'tokenUsage'>;

/**
 * Convert session metadata to DB row values — everything EXCEPT the
 * message-derived columns (messageCount, lastMessageRole, preview,
 * lastFinalMessageId, tokenUsage). Those are owned by the message-writing
 * paths (saveSession / saveSessionMessageUpdate).
 */
function sessionMetaToRow(session: StoredSessionMeta): Omit<typeof sessionsTable.$inferInsert, 'messageCount' | 'lastMessageRole' | 'preview' | 'lastFinalMessageId' | 'tokenUsage'> {
  return {
    id: session.id,
    sdkSessionId: session.sdkSessionId ?? null,
    sdkCwd: session.sdkCwd ? toPortablePath(session.sdkCwd) : null,
    createdAt: session.createdAt,
    lastUsedAt: Date.now(),
    lastMessageAt: session.lastMessageAt ?? null,
    name: session.name ?? null,
    isFlagged: session.isFlagged ?? false,
    sessionStatus: session.sessionStatus ?? 'todo',
    labels: session.labels ?? null,
    hidden: session.hidden ?? false,
    isBatch: session.isBatch ?? false,
    batchId: session.batchId ?? null,
    lastReadMessageId: session.lastReadMessageId ?? null,
    hasUnread: session.hasUnread ?? false,
    enabledSourceSlugs: session.enabledSourceSlugs ?? null,
    permissionMode: session.permissionMode ?? null,
    previousPermissionMode: session.previousPermissionMode ?? null,
    workingDirectory: session.workingDirectory ? toPortablePath(session.workingDirectory) : null,
    model: session.model ?? null,
    llmConnection: session.llmConnection ?? null,
    connectionLocked: session.connectionLocked ?? null,
    thinkingLevel: session.thinkingLevel ?? null,
    sharedUrl: session.sharedUrl ?? null,
    sharedId: session.sharedId ?? null,
    sharedPasswordSet: session.sharedPasswordSet ?? null,
    htmlShares: session.htmlShares ?? null,
    assets: session.assets ?? null,
    pendingPlanExecution: session.pendingPlanExecution ?? null,
    isArchived: session.isArchived ?? false,
    archivedAt: session.archivedAt ?? null,
    branchFromMessageId: session.branchFromMessageId ?? null,
    branchFromSdkSessionId: session.branchFromSdkSessionId ?? null,
    branchFromSessionPath: session.branchFromSessionPath ?? null,
    branchFromSdkCwd: session.branchFromSdkCwd ?? null,
    branchFromSdkTurnId: session.branchFromSdkTurnId ?? null,
    transferredSessionSummary: session.transferredSessionSummary ?? null,
    transferredSessionSummaryApplied: session.transferredSessionSummaryApplied ?? null,
    triggeredBy: session.triggeredBy ?? null,
  };
}

/**
 * Convert a StoredSession to a DB row values object
 */
function sessionToRow(session: StoredSession, workspaceRootPath: string): typeof sessionsTable.$inferInsert {
  return {
    ...sessionMetaToRow(session),
    // Pre-computed fields
    messageCount: session.messages.length,
    lastMessageRole: extractLastMessageRole(session.messages),
    preview: extractPreview(session.messages),
    lastFinalMessageId: extractLastFinalMessageId(session.messages),
    tokenUsage: session.tokenUsage,
  };
}

/**
 * Convert a DB row back to a StoredSession (without messages — loaded separately)
 */
function rowToSessionConfig(row: SessionRow, workspaceRootPath: string): SessionConfig {
  return {
    id: row.id,
    workspaceRootPath,
    sdkSessionId: row.sdkSessionId ?? undefined,
    sdkCwd: row.sdkCwd ? expandPath(row.sdkCwd) : undefined,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    lastMessageAt: row.lastMessageAt ?? undefined,
    name: row.name ?? undefined,
    isFlagged: row.isFlagged ?? undefined,
    sessionStatus: row.sessionStatus ?? undefined,
    labels: (row.labels as string[] | null) ?? undefined,
    hidden: row.hidden ?? undefined,
    isBatch: row.isBatch ?? undefined,
    batchId: row.batchId ?? undefined,
    lastReadMessageId: row.lastReadMessageId ?? undefined,
    hasUnread: row.hasUnread ?? undefined,
    enabledSourceSlugs: (row.enabledSourceSlugs as string[] | null) ?? undefined,
    permissionMode: row.permissionMode as SessionConfig['permissionMode'],
    previousPermissionMode: row.previousPermissionMode as SessionConfig['permissionMode'],
    workingDirectory: row.workingDirectory ? expandPath(row.workingDirectory) : undefined,
    model: row.model ?? undefined,
    llmConnection: row.llmConnection ?? undefined,
    connectionLocked: row.connectionLocked ?? undefined,
    thinkingLevel: row.thinkingLevel as SessionConfig['thinkingLevel'],
    sharedUrl: row.sharedUrl ?? undefined,
    sharedId: row.sharedId ?? undefined,
    sharedPasswordSet: row.sharedPasswordSet ?? undefined,
    htmlShares: (row.htmlShares as SessionConfig['htmlShares']) ?? undefined,
    assets: (row.assets as SessionConfig['assets']) ?? undefined,
    pendingPlanExecution: row.pendingPlanExecution as SessionConfig['pendingPlanExecution'],
    isArchived: row.isArchived ?? undefined,
    archivedAt: row.archivedAt ?? undefined,
    branchFromMessageId: row.branchFromMessageId ?? undefined,
    branchFromSdkSessionId: row.branchFromSdkSessionId ?? undefined,
    branchFromSessionPath: row.branchFromSessionPath ?? undefined,
    branchFromSdkCwd: row.branchFromSdkCwd ?? undefined,
    branchFromSdkTurnId: row.branchFromSdkTurnId ?? undefined,
    transferredSessionSummary: row.transferredSessionSummary ?? undefined,
    transferredSessionSummaryApplied: row.transferredSessionSummaryApplied ?? undefined,
    triggeredBy: row.triggeredBy as SessionConfig['triggeredBy'],
  };
}

/**
 * Convert a session DB row to SessionMetadata for list views.
 *
 * List-time invariant: this runs once per row over the whole sessions table
 * (33k+ rows in large workspaces), so it must stay O(1) per row — no SQL
 * queries and no filesystem access in here. Status validity comes from the
 * caller-provided set (one statuses query per list call).
 */
function rowToMetadata(
  row: SessionRow,
  workspaceRootPath: string,
  validStatusIds: Set<string>
): SessionMetadata {
  // Same semantics as validateSessionStatus(): undefined or unknown → 'todo'.
  const rawStatus = row.sessionStatus ?? undefined;
  let validatedStatus: string;
  if (!rawStatus) {
    validatedStatus = 'todo';
  } else if (validStatusIds.has(rawStatus)) {
    validatedStatus = rawStatus;
  } else {
    console.warn(
      `[listSessions] Invalid status '${rawStatus}' for workspace, ` +
      `falling back to 'todo'. The status may have been deleted.`
    );
    validatedStatus = 'todo';
  }
  // planCount disabled: listPlanFiles() does a per-session readdir/stat (very
  // slow over Docker bind mounts at this scale) and the value never reached
  // the UI — managedToSession drops it and no renderer code reads it. Plan
  // APIs still call listPlanFiles() on demand. Re-enable only via a
  // denormalized DB column.
  // const planCount = listPlanFiles(workspaceRootPath, row.id).length;

  return {
    id: row.id,
    workspaceRootPath,
    name: row.name ?? undefined,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    lastMessageAt: row.lastMessageAt ?? undefined,
    messageCount: row.messageCount ?? 0,
    preview: row.preview ?? undefined,
    sdkSessionId: row.sdkSessionId ?? undefined,
    isFlagged: row.isFlagged ?? undefined,
    sessionStatus: validatedStatus,
    labels: (row.labels as string[] | null) ?? undefined,
    permissionMode: row.permissionMode as SessionMetadata['permissionMode'],
    previousPermissionMode: row.previousPermissionMode as SessionMetadata['permissionMode'],
    // planCount: planCount > 0 ? planCount : undefined,
    sharedUrl: row.sharedUrl ?? undefined,
    sharedId: row.sharedId ?? undefined,
    sharedPasswordSet: row.sharedPasswordSet ?? undefined,
    htmlShares: (row.htmlShares as SessionConfig['htmlShares']) ?? undefined,
    assets: (row.assets as SessionConfig['assets']) ?? undefined,
    workingDirectory: row.workingDirectory ? expandPath(row.workingDirectory) : undefined,
    sdkCwd: row.sdkCwd ? expandPath(row.sdkCwd) : undefined,
    lastMessageRole: row.lastMessageRole as SessionMetadata['lastMessageRole'],
    model: row.model ?? undefined,
    llmConnection: row.llmConnection ?? undefined,
    connectionLocked: row.connectionLocked ?? undefined,
    thinkingLevel: row.thinkingLevel as SessionMetadata['thinkingLevel'],
    lastReadMessageId: row.lastReadMessageId ?? undefined,
    lastFinalMessageId: row.lastFinalMessageId ?? undefined,
    hasUnread: row.hasUnread ?? undefined,
    tokenUsage: row.tokenUsage as SessionTokenUsage | undefined,
    hidden: row.hidden ?? undefined,
    isBatch: row.isBatch ?? undefined,
    batchId: row.batchId ?? undefined,
    isArchived: row.isArchived ?? undefined,
    archivedAt: row.archivedAt ?? undefined,
    branchFromMessageId: row.branchFromMessageId ?? undefined,
  };
}

function sqlValueList(values: string[]): SQL {
  return sql.join(values.map(value => sql`${value}`), sql`, `);
}

function labelMatchesSql(labelId: string): SQL {
  // Labels may be stored either as a bare id or as "id::value".
  return sql`EXISTS (
    SELECT 1 FROM json_each(${sessionsTable.labels})
    WHERE json_each.value = ${labelId}
       OR json_each.value LIKE ${`${labelId}::%`}
  )`;
}

function anyLabelMatchesSql(labelIds: string[]): SQL | undefined {
  const clauses = labelIds.map(labelMatchesSql);
  if (clauses.length === 0) return undefined;
  return clauses.length === 1 ? clauses[0] : sql`(${sql.join(clauses, sql` OR `)})`;
}

function sessionWhereClause(filter?: SessionMetadataQueryFilter): SQL | undefined {
  const conditions: SQL[] = [eq(sessionsTable.hidden, false)];

  if (filter?.archived !== undefined) conditions.push(eq(sessionsTable.isArchived, filter.archived));
  if (filter?.flagged !== undefined) conditions.push(eq(sessionsTable.isFlagged, filter.flagged));
  if (filter?.batch !== undefined) conditions.push(eq(sessionsTable.isBatch, filter.batch));
  if (filter?.batchId !== undefined) conditions.push(eq(sessionsTable.batchId, filter.batchId));
  if (filter?.hasLabels === true) {
    conditions.push(sql`json_array_length(COALESCE(${sessionsTable.labels}, '[]')) > 0`);
  }

  if (filter?.statusInclude && filter.statusInclude.length > 0) {
    conditions.push(sql`COALESCE(${sessionsTable.sessionStatus}, 'todo') IN (${sqlValueList(filter.statusInclude)})`);
  }
  if (filter?.statusExclude && filter.statusExclude.length > 0) {
    conditions.push(sql`COALESCE(${sessionsTable.sessionStatus}, 'todo') NOT IN (${sqlValueList(filter.statusExclude)})`);
  }
  if (filter?.search) {
    conditions.push(sql`LOWER(COALESCE(${sessionsTable.name}, '')) LIKE ${`%${filter.search.toLowerCase()}%`}`);
  }
  if (filter?.labelIncludeGroups && filter.labelIncludeGroups.length > 0) {
    for (const group of filter.labelIncludeGroups) {
      const clause = anyLabelMatchesSql(group);
      if (clause) conditions.push(clause);
    }
  }
  if (filter?.labelExclude && filter.labelExclude.length > 0) {
    const clause = anyLabelMatchesSql(filter.labelExclude);
    if (clause) conditions.push(sql`NOT ${clause}`);
  }

  return conditions.length === 1 ? conditions[0] : and(...conditions);
}

function sessionOrderBy(sortBy?: SessionMetadataQueryOptions['sortBy']): SQL[] {
  const recent = sql<number>`COALESCE(${sessionsTable.lastMessageAt}, ${sessionsTable.lastUsedAt}, 0)`;
  if (sortBy === 'name') {
    return [asc(sql<string>`LOWER(COALESCE(${sessionsTable.name}, ''))`), desc(recent)];
  }
  if (sortBy === 'status') {
    return [asc(sql<string>`COALESCE(${sessionsTable.sessionStatus}, 'todo')`), desc(recent)];
  }
  return [desc(recent)];
}

function needsMetadataPostFilter(options?: SessionMetadataQueryOptions): boolean {
  return Boolean(options?.postFilter);
}

// ============================================================
// Pre-computed Field Extractors
// ============================================================

function extractLastMessageRole(messages: StoredMessage[]): string | null {
  const last = messages[messages.length - 1];
  if (!last) return null;
  const role = last.type;
  if (role === 'user' || role === 'assistant' || role === 'plan' || role === 'tool' || role === 'error') {
    return role;
  }
  return null;
}

function extractLastFinalMessageId(messages: StoredMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.type === 'assistant' && !msg.isIntermediate) {
      return msg.id;
    }
  }
  return null;
}

function extractPreview(messages: StoredMessage[]): string | null {
  const firstUser = messages.find(m => m.type === 'user');
  if (!firstUser?.content) return null;

  const sanitized = firstUser.content
    .replace(/<edit_request>[\s\S]*?<\/edit_request>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[skill:(?:[\w-]+:)?[\w-]+\]/g, '')
    .replace(/\[source:[\w-]+\]/g, '')
    .replace(/\[file:[^\]]+\]/g, '')
    .replace(/\[folder:[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized.substring(0, 150) || null;
}

// ============================================================
// Session CRUD (SQLite)
// ============================================================

/**
 * Create a new session for a workspace
 */
export async function createSession(
  workspaceRootPath: string,
  options?: {
    name?: string;
    workingDirectory?: string;
    permissionMode?: SessionConfig['permissionMode'];
    enabledSourceSlugs?: string[];
    model?: string;
    llmConnection?: string;
    hidden?: boolean;
    isBatch?: boolean;
    batchId?: string;
    sessionStatus?: SessionConfig['sessionStatus'];
    labels?: string[];
    isFlagged?: boolean;
  }
): Promise<SessionConfig> {
  ensureSessionsDir(workspaceRootPath);

  const now = Date.now();
  const sessionId = generateSessionId(workspaceRootPath);

  ensureSessionDir(workspaceRootPath, sessionId);

  const sdkCwd = options?.workingDirectory ?? getSessionPath(workspaceRootPath, sessionId);

  const session: SessionConfig = {
    id: sessionId,
    workspaceRootPath,
    name: options?.name,
    createdAt: now,
    lastUsedAt: now,
    workingDirectory: options?.workingDirectory,
    sdkCwd,
    permissionMode: options?.permissionMode,
    enabledSourceSlugs: options?.enabledSourceSlugs,
    model: options?.model,
    llmConnection: options?.llmConnection,
    hidden: options?.hidden,
    isBatch: options?.isBatch,
    batchId: options?.batchId,
    sessionStatus: options?.sessionStatus,
    labels: options?.labels,
    isFlagged: options?.isFlagged,
  };

  const storedSession: StoredSession = {
    ...session,
    messages: [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
  };
  saveSession(storedSession);

  return session;
}

/**
 * Get or create a session with a specific ID
 */
export async function getOrCreateSessionById(
  workspaceRootPath: string,
  sessionId: string
): Promise<SessionConfig> {
  const existing = loadSession(workspaceRootPath, sessionId);
  if (existing) {
    return {
      id: existing.id,
      sdkSessionId: existing.sdkSessionId,
      workspaceRootPath: existing.workspaceRootPath,
      name: existing.name,
      createdAt: existing.createdAt,
      lastUsedAt: existing.lastUsedAt,
      sdkCwd: existing.sdkCwd,
      workingDirectory: existing.workingDirectory,
    };
  }

  ensureSessionsDir(workspaceRootPath);
  ensureSessionDir(workspaceRootPath, sessionId);

  const now = Date.now();
  const sdkCwd = getSessionPath(workspaceRootPath, sessionId);

  const session: SessionConfig = {
    id: sessionId,
    workspaceRootPath,
    sdkCwd,
    createdAt: now,
    lastUsedAt: now,
  };

  const storedSession: StoredSession = {
    ...session,
    messages: [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
  };
  saveSession(storedSession);

  return session;
}

/**
 * Save session to DB (transaction: upsert session + replace messages).
 * Direct DB write — no persistence queue needed.
 */
export function saveSession(session: StoredSession): void {
  const db = getWorkspaceDb(session.workspaceRootPath);
  const sessionDir = getSessionPath(session.workspaceRootPath, session.id);

  db.transaction((tx) => {
    const rowValues = sessionToRow(session, session.workspaceRootPath);

    // Upsert session row
    const existing = tx.select()
      .from(sessionsTable)
      .where(eq(sessionsTable.id, session.id))
      .get();

    if (existing) {
      // Update — exclude id from the set
      const { id: _id, ...updateValues } = rowValues;
      tx.update(sessionsTable)
        .set(updateValues)
        .where(eq(sessionsTable.id, session.id))
        .run();
    } else {
      tx.insert(sessionsTable).values(rowValues).run();
    }

    // Replace all messages
    tx.delete(messagesTable)
      .where(eq(messagesTable.sessionId, session.id))
      .run();

    for (let i = 0; i < session.messages.length; i++) {
      const msg = session.messages[i]!;
      // Make message content portable
      const contentJson = JSON.stringify(msg);
      const portableJson = makeContentPortable(contentJson, sessionDir);
      const portableContent = JSON.parse(portableJson);

      tx.insert(messagesTable).values({
        id: msg.id,
        sessionId: session.id,
        position: i,
        content: portableContent,
      }).run();
    }
  });

  dbEvents.emit('session:saved', session.id);
}

/**
 * Save session metadata only — writes the sessions row WITHOUT touching
 * message rows or the message-derived columns (messageCount, lastMessageRole,
 * preview, lastFinalMessageId, tokenUsage). Those keep their current DB values.
 *
 * Use for metadata-only mutations (flag, archive, status, labels, name, ...).
 * Unlike saveSession, this never needs the messages array, so callers can skip
 * cold-loading messages for hibernated sessions just to write one flag.
 */
export function saveSessionMeta(meta: StoredSessionMeta): void {
  const db = getWorkspaceDb(meta.workspaceRootPath);

  const rowValues = sessionMetaToRow(meta);

  // Deferred-load guard: SessionManager leaves these row-resident fields
  // undefined on sessions never opened since boot (rowToMetadata does not
  // carry them; hydrateMessagesForColdPersist backfills them on the full-save
  // path). Here, undefined means "not loaded in memory" — never "clear" — so
  // drop the column from the write and keep the DB value. Fields that ARE
  // intentionally cleared to undefined via meta writes (sdkSessionId,
  // branchFrom*, archivedAt, ...) must stay OUT of this list.
  const deferredLoadFields = [
    'enabledSourceSlugs',
    'lastReadMessageId',
    'hasUnread',
    'sharedUrl',
    'sharedId',
    'transferredSessionSummary',
    'transferredSessionSummaryApplied',
    'pendingPlanExecution',
    'triggeredBy',
  ] as const;
  for (const field of deferredLoadFields) {
    if (meta[field] === undefined) {
      delete rowValues[field];
    }
  }

  const existing = db.select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, meta.id))
    .get();

  if (existing) {
    const { id: _id, ...updateValues } = rowValues;
    db.update(sessionsTable)
      .set(updateValues)
      .where(eq(sessionsTable.id, meta.id))
      .run();
  } else {
    // Row not yet created (createSession full-saves first, so this is rare).
    // Message-derived columns fall back to their schema defaults.
    db.insert(sessionsTable).values(rowValues).run();
  }

  dbEvents.emit('session:saved', meta.id);
}

/**
 * Targeted message write — upserts ONLY the rows in `changedMessageIds` plus
 * the sessions row (including message-derived columns, computed from the full
 * `session.messages` array the caller already holds in memory).
 *
 * This is the hot-path replacement for saveSession's delete-all + reinsert-all:
 * a streaming session appending its 500th message writes 1 message row instead
 * of re-serializing and rewriting all 500.
 *
 * `position` is the message's index in `session.messages` — identical to what
 * a full saveSession would assign, so targeted and full writes interleave
 * consistently. Paths that REMOVE messages must use saveSession (full rewrite);
 * the per-turn full persist in onProcessingStopped acts as the reconciliation
 * anchor for any transient position drift.
 */
export function saveSessionMessageUpdate(session: StoredSession, changedMessageIds: string[]): void {
  const db = getWorkspaceDb(session.workspaceRootPath);
  const sessionDir = getSessionPath(session.workspaceRootPath, session.id);
  const changed = new Set(changedMessageIds);

  db.transaction((tx) => {
    // Upsert session row (same as saveSession — derived fields recomputed)
    const rowValues = sessionToRow(session, session.workspaceRootPath);
    const existing = tx.select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, session.id))
      .get();

    if (existing) {
      const { id: _id, ...updateValues } = rowValues;
      tx.update(sessionsTable)
        .set(updateValues)
        .where(eq(sessionsTable.id, session.id))
        .run();
    } else {
      tx.insert(sessionsTable).values(rowValues).run();
    }

    for (let i = 0; i < session.messages.length; i++) {
      const msg = session.messages[i]!;
      if (!changed.has(msg.id)) continue;

      const contentJson = JSON.stringify(msg);
      const portableJson = makeContentPortable(contentJson, sessionDir);
      const portableContent = JSON.parse(portableJson);

      const existingMsg = tx.select({ id: messagesTable.id })
        .from(messagesTable)
        .where(and(eq(messagesTable.sessionId, session.id), eq(messagesTable.id, msg.id)))
        .get();

      if (existingMsg) {
        tx.update(messagesTable)
          .set({ position: i, content: portableContent })
          .where(and(eq(messagesTable.sessionId, session.id), eq(messagesTable.id, msg.id)))
          .run();
      } else {
        tx.insert(messagesTable).values({
          id: msg.id,
          sessionId: session.id,
          position: i,
          content: portableContent,
        }).run();
      }
    }
  });

  dbEvents.emit('session:saved', session.id);
}

/**
 * Turn-end reconcile — the cheap replacement for saveSession's delete-all +
 * reinsert-all when nothing was removed (the overwhelmingly common case:
 * turns only append messages and update the ones they appended).
 *
 * Verifies with an id+position-only select (no content) that the DB rows are
 * an exact positional prefix of the in-memory array. If they are, only the
 * rows in `recentlyChangedMessageIds` plus the new tail rows are upserted.
 * Any drift — removals, reorders, position gaps — falls back to the full
 * saveSession rewrite, preserving its reconciliation-anchor role.
 */
export function saveSessionTurnReconcile(session: StoredSession, recentlyChangedMessageIds: string[]): void {
  const db = getWorkspaceDb(session.workspaceRootPath);

  const dbRows = db.select({ id: messagesTable.id, position: messagesTable.position })
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, session.id))
    .orderBy(messagesTable.position)
    .all();

  let drift = dbRows.length > session.messages.length;
  if (!drift) {
    for (let i = 0; i < dbRows.length; i++) {
      if (dbRows[i]!.id !== session.messages[i]!.id || dbRows[i]!.position !== i) {
        drift = true;
        break;
      }
    }
  }

  if (drift) {
    console.warn(
      `[saveSessionTurnReconcile] Message rows drifted from memory for session ${session.id} ` +
      `(db=${dbRows.length}, mem=${session.messages.length}) — falling back to full rewrite`
    );
    saveSession(session);
    return;
  }

  const upsert = new Set(recentlyChangedMessageIds);
  // New tail rows may never have hit a targeted write (e.g. a turn
  // interrupted mid-stream) — always write them.
  for (let i = dbRows.length; i < session.messages.length; i++) {
    upsert.add(session.messages[i]!.id);
  }

  saveSessionMessageUpdate(session, [...upsert]);
}

/**
 * Load a session's header (metadata only) — a single sessions-row select.
 * Message-derived fields (messageCount, lastMessageRole, preview, tokenUsage)
 * come from the denormalized columns; the messages table is never touched.
 *
 * This exists for the config watcher's DB-mode `session:saved` listener,
 * which runs synchronously inside every message persist on the streaming hot
 * path — loading the full session there costs O(history) per persisted
 * message and blocks the event loop for all sessions.
 */
export function loadSessionHeader(workspaceRootPath: string, sessionId: string): SessionHeader | null {
  const db = getWorkspaceDb(workspaceRootPath);

  const row = db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).get();
  if (!row) return null;

  const config = rowToSessionConfig(row, workspaceRootPath);
  return {
    ...config,
    messageCount: row.messageCount ?? 0,
    lastMessageRole: (row.lastMessageRole ?? undefined) as SessionHeader['lastMessageRole'],
    preview: row.preview ?? undefined,
    tokenUsage: (row.tokenUsage as SessionTokenUsage | null) ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
  };
}

/**
 * Load session by ID from DB
 */
export function loadSession(workspaceRootPath: string, sessionId: string): StoredSession | null {
  const db = getWorkspaceDb(workspaceRootPath);

  const row = db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).get();
  if (!row) return null;

  const config = rowToSessionConfig(row, workspaceRootPath);

  // Load messages ordered by position
  const messageRows = db.select()
    .from(messagesTable)
    .where(eq(messagesTable.sessionId, sessionId))
    .orderBy(messagesTable.position)
    .all();

  const sessionDir = getSessionPath(workspaceRootPath, sessionId);
  const messages: StoredMessage[] = messageRows.map(mr => {
    // Expand portable paths in message content
    const contentJson = JSON.stringify(mr.content);
    const expandedJson = expandContent(contentJson, sessionDir);
    return JSON.parse(expandedJson) as StoredMessage;
  });

  return {
    ...config,
    messages,
    tokenUsage: (row.tokenUsage as SessionTokenUsage) ?? {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
  };
}

/**
 * List sessions for a workspace from DB.
 * Returns sessions sorted by lastUsedAt descending (most recent first).
 * Excludes hidden sessions.
 */
export function listSessions(workspaceRootPath: string): SessionMetadata[] {
  const db = getWorkspaceDb(workspaceRootPath);

  // One statuses query for the entire list; rowToMetadata must not issue
  // per-row SQL or filesystem calls (see its doc comment).
  const validStatusIds = new Set(listStatuses(workspaceRootPath).map(s => s.id));

  const rows = db.select()
    .from(sessionsTable)
    .where(eq(sessionsTable.hidden, false))
    .orderBy(desc(sessionsTable.lastUsedAt))
    .all();

  return rows.map(row => rowToMetadata(row, workspaceRootPath, validStatusIds));
}

/**
 * Windowed session metadata query backed by SQLite.
 *
 * Common predicates (hidden/archive/flagged/batch/status/search) are pushed
 * into SQL. Label predicates and caller-supplied dynamic predicates run over
 * lightweight metadata rows so arbitrary UI semantics do not force persistent
 * ManagedSession hydration.
 */
export function listSessionMetadataPage(
  workspaceRootPath: string,
  options: SessionMetadataQueryOptions = {}
): SessionMetadataPage {
  const db = getWorkspaceDb(workspaceRootPath);
  const validStatusIds = new Set(listStatuses(workspaceRootPath).map(s => s.id));
  const where = sessionWhereClause(options.filter);
  const orderBy = sessionOrderBy(options.sortBy);
  const offset = Math.max(options.offset ?? 0, 0);
  const limit = options.limit === undefined ? undefined : Math.max(options.limit, 0);

  if (!needsMetadataPostFilter(options)) {
    const countRow = db.select({ count: sql<number>`COUNT(*)` })
      .from(sessionsTable)
      .where(where)
      .get();

    if (limit === 0) {
      return { rows: [], total: Number(countRow?.count ?? 0) };
    }

    let query = db.select()
      .from(sessionsTable)
      .where(where)
      .orderBy(...orderBy);

    if (limit !== undefined) {
      query = query.limit(limit).offset(offset) as typeof query;
    }

    const rows = query.all();
    return {
      rows: rows.map(row => rowToMetadata(row, workspaceRootPath, validStatusIds)),
      total: Number(countRow?.count ?? 0),
    };
  }

  const allRows = db.select()
    .from(sessionsTable)
    .where(where)
    .orderBy(...orderBy)
    .all()
    .map(row => rowToMetadata(row, workspaceRootPath, validStatusIds))
    .filter(metadata => options.postFilter ? options.postFilter(metadata) : true);

  return {
    rows: limit === undefined ? allRows.slice(offset) : allRows.slice(offset, offset + limit),
    total: allRows.length,
  };
}

/**
 * Load lightweight metadata for specific session ids. Hidden sessions are
 * excluded to match list semantics.
 */
export function listSessionMetadataByIds(workspaceRootPath: string, ids: string[]): SessionMetadata[] {
  if (ids.length === 0) return [];
  const db = getWorkspaceDb(workspaceRootPath);
  const validStatusIds = new Set(listStatuses(workspaceRootPath).map(s => s.id));
  const rows = db.select()
    .from(sessionsTable)
    .where(and(eq(sessionsTable.hidden, false), inArray(sessionsTable.id, ids)))
    .all();
  return rows.map(row => rowToMetadata(row, workspaceRootPath, validStatusIds));
}

/**
 * Minimal rows for sidebar aggregation. This intentionally avoids the full
 * SessionMetadata shape and never touches message rows or session folders.
 */
export function listSessionCountRows(workspaceRootPath: string): SessionCountRow[] {
  const db = getWorkspaceDb(workspaceRootPath);
  const validStatusIds = new Set(listStatuses(workspaceRootPath).map(s => s.id));
  const rows = db.select({
    id: sessionsTable.id,
    sessionStatus: sessionsTable.sessionStatus,
    labels: sessionsTable.labels,
    isArchived: sessionsTable.isArchived,
    isBatch: sessionsTable.isBatch,
    isFlagged: sessionsTable.isFlagged,
    hasUnread: sessionsTable.hasUnread,
  })
    .from(sessionsTable)
    .where(eq(sessionsTable.hidden, false))
    .all();

  return rows.map(row => {
    const status = row.sessionStatus && validStatusIds.has(row.sessionStatus)
      ? row.sessionStatus
      : 'todo';
    return {
      id: row.id,
      sessionStatus: status,
      labels: (row.labels as string[] | null) ?? undefined,
      isArchived: row.isArchived ?? undefined,
      isBatch: row.isBatch ?? undefined,
      isFlagged: row.isFlagged ?? undefined,
      hasUnread: row.hasUnread ?? undefined,
    };
  });
}

export function getSessionSidebarScalarCounts(workspaceRootPath: string): SessionSidebarScalarCounts {
  const db = getWorkspaceDb(workspaceRootPath);
  const validStatusIds = new Set(listStatuses(workspaceRootPath).map(s => s.id));
  const countWhere = (where: SQL | undefined): number => {
    const row = db.select({ count: sql<number>`COUNT(*)` })
      .from(sessionsTable)
      .where(where)
      .get();
    return Number(row?.count ?? 0);
  };
  const active = and(
    eq(sessionsTable.hidden, false),
    eq(sessionsTable.isArchived, false),
    eq(sessionsTable.isBatch, false),
  );

  const statusRows = db.select({
    sessionStatus: sessionsTable.sessionStatus,
    count: sql<number>`COUNT(*)`,
  })
    .from(sessionsTable)
    .where(active)
    .groupBy(sessionsTable.sessionStatus)
    .all();

  const byStatus: Record<string, number> = {};
  for (const row of statusRows) {
    const status = row.sessionStatus && validStatusIds.has(row.sessionStatus)
      ? row.sessionStatus
      : 'todo';
    byStatus[status] = (byStatus[status] ?? 0) + Number(row.count ?? 0);
  }

  return {
    total: countWhere(eq(sessionsTable.hidden, false)),
    archived: countWhere(and(eq(sessionsTable.hidden, false), eq(sessionsTable.isArchived, true))),
    batch: countWhere(and(eq(sessionsTable.hidden, false), eq(sessionsTable.isBatch, true))),
    flagged: countWhere(and(active, eq(sessionsTable.isFlagged, true))),
    unread: countWhere(and(active, eq(sessionsTable.hasUnread, true))),
    byStatus,
  };
}

export function listSessionLabelCountRows(workspaceRootPath: string): SessionLabelCountRow[] {
  const db = getWorkspaceDb(workspaceRootPath);
  const rows = db.select({
    id: sessionsTable.id,
    labels: sessionsTable.labels,
  })
    .from(sessionsTable)
    .where(and(
      eq(sessionsTable.hidden, false),
      eq(sessionsTable.isArchived, false),
      sql`json_array_length(COALESCE(${sessionsTable.labels}, '[]')) > 0`,
    ))
    .all();

  return rows.map(row => ({
    id: row.id,
    labels: (row.labels as string[] | null) ?? undefined,
  }));
}

export function countUnreadSessions(workspaceRootPath: string): number {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select({ count: sql<number>`COUNT(*)` })
    .from(sessionsTable)
    .where(and(
      eq(sessionsTable.hidden, false),
      eq(sessionsTable.isArchived, false),
      eq(sessionsTable.isBatch, false),
      eq(sessionsTable.hasUnread, true),
    ))
    .get();
  return Number(row?.count ?? 0);
}

export function markWorkspaceSessionsRead(
  workspaceRootPath: string,
  options: { excludeSessionIds?: string[] } = {}
): void {
  const db = getWorkspaceDb(workspaceRootPath);
  const conditions: SQL[] = [
    eq(sessionsTable.hidden, false),
    eq(sessionsTable.isArchived, false),
    eq(sessionsTable.isBatch, false),
    eq(sessionsTable.hasUnread, true),
  ];
  if (options.excludeSessionIds && options.excludeSessionIds.length > 0) {
    conditions.push(sql`${sessionsTable.id} NOT IN (${sqlValueList(options.excludeSessionIds)})`);
  }

  db.update(sessionsTable)
    .set({ hasUnread: false })
    .where(and(...conditions))
    .run();
}

export function getSessionVisibility(workspaceRootPath: string, sessionId: string): { hidden: boolean; isBatch: boolean } | null {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select({
    hidden: sessionsTable.hidden,
    isBatch: sessionsTable.isBatch,
  })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .get();
  if (!row) return null;
  return {
    hidden: row.hidden === true,
    isBatch: row.isBatch === true,
  };
}

/**
 * Delete a session and its associated files
 */
export function deleteSession(workspaceRootPath: string, sessionId: string): boolean {
  try {
    const db = getWorkspaceDb(workspaceRootPath);

    // DB delete (messages cascade)
    db.delete(sessionsTable).where(eq(sessionsTable.id, sessionId)).run();

    // Remove session directory
    const sessionDir = getSessionPath(workspaceRootPath, sessionId);
    if (existsSync(sessionDir)) {
      rmSync(sessionDir, { recursive: true });
    }

    dbEvents.emit('session:deleted', sessionId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear messages from a session while preserving metadata.
 */
export async function clearSessionMessages(workspaceRootPath: string, sessionId: string): Promise<void> {
  const session = loadSession(workspaceRootPath, sessionId);
  if (session) {
    session.messages = [];
    session.sdkSessionId = undefined;
    session.tokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    };
    saveSession(session);
  }
}

/**
 * Get or create the latest session for a workspace
 */
export async function getOrCreateLatestSession(workspaceRootPath: string): Promise<SessionConfig> {
  const sessions = listActiveSessions(workspaceRootPath);
  if (sessions.length > 0 && sessions[0]) {
    const latest = sessions[0];
    return {
      id: latest.id,
      sdkSessionId: latest.sdkSessionId,
      workspaceRootPath: latest.workspaceRootPath,
      name: latest.name,
      createdAt: latest.createdAt,
      lastUsedAt: latest.lastUsedAt,
    };
  }
  return createSession(workspaceRootPath);
}

// ============================================================
// Session Metadata Updates (efficient single-column updates)
// ============================================================

/**
 * Update session metadata
 */
export async function updateSessionMetadata(
  workspaceRootPath: string,
  sessionId: string,
  updates: Partial<Pick<SessionConfig,
    | 'isFlagged'
    | 'name'
    | 'sessionStatus'
    | 'labels'
    | 'lastReadMessageId'
    | 'hasUnread'
    | 'enabledSourceSlugs'
    | 'workingDirectory'
    | 'sdkCwd'
    | 'permissionMode'
    | 'sharedUrl'
    | 'sharedId'
    | 'sharedPasswordSet'
    | 'htmlShares'
    | 'assets'
    | 'model'
    | 'llmConnection'
    | 'isArchived'
    | 'archivedAt'
  >>
): Promise<void> {
  const db = getWorkspaceDb(workspaceRootPath);

  // Build set object from updates
  const set: Record<string, unknown> = {};

  if (updates.isFlagged !== undefined) set.isFlagged = updates.isFlagged;
  if (updates.name !== undefined) set.name = updates.name;
  if (updates.sessionStatus !== undefined) set.sessionStatus = updates.sessionStatus;
  if (updates.labels !== undefined) set.labels = updates.labels;
  if (updates.enabledSourceSlugs !== undefined) set.enabledSourceSlugs = updates.enabledSourceSlugs;
  if (updates.workingDirectory !== undefined) set.workingDirectory = toPortablePath(updates.workingDirectory);
  if (updates.sdkCwd !== undefined) set.sdkCwd = toPortablePath(updates.sdkCwd);
  if (updates.permissionMode !== undefined) set.permissionMode = updates.permissionMode;
  if ('lastReadMessageId' in updates) set.lastReadMessageId = updates.lastReadMessageId ?? null;
  if ('hasUnread' in updates) set.hasUnread = updates.hasUnread ?? false;
  if ('sharedUrl' in updates) set.sharedUrl = updates.sharedUrl ?? null;
  if ('sharedId' in updates) set.sharedId = updates.sharedId ?? null;
  if ('sharedPasswordSet' in updates) set.sharedPasswordSet = updates.sharedPasswordSet ?? null;
  if ('htmlShares' in updates) set.htmlShares = updates.htmlShares ?? null;
  if ('assets' in updates) set.assets = updates.assets ?? null;
  if (updates.model !== undefined) set.model = updates.model;
  if (updates.llmConnection !== undefined) set.llmConnection = updates.llmConnection;
  if (updates.isArchived !== undefined) set.isArchived = updates.isArchived;
  if ('archivedAt' in updates) set.archivedAt = updates.archivedAt ?? null;

  if (Object.keys(set).length === 0) return;

  db.update(sessionsTable)
    .set(set)
    .where(eq(sessionsTable.id, sessionId))
    .run();

  dbEvents.emit('session:metadata', sessionId);
}

/**
 * Flag a session
 */
export async function flagSession(workspaceRootPath: string, sessionId: string): Promise<void> {
  await updateSessionMetadata(workspaceRootPath, sessionId, { isFlagged: true });
}

/**
 * Unflag a session
 */
export async function unflagSession(workspaceRootPath: string, sessionId: string): Promise<void> {
  await updateSessionMetadata(workspaceRootPath, sessionId, { isFlagged: false });
}

/**
 * Set session status
 */
export async function setSessionStatus(
  workspaceRootPath: string,
  sessionId: string,
  sessionStatus: SessionStatus
): Promise<void> {
  await updateSessionMetadata(workspaceRootPath, sessionId, { sessionStatus });
}

/**
 * Set labels for a session
 */
export async function setSessionLabels(
  workspaceRootPath: string,
  sessionId: string,
  labels: string[]
): Promise<void> {
  await updateSessionMetadata(workspaceRootPath, sessionId, { labels });
}

/**
 * Archive a session
 */
export async function archiveSession(workspaceRootPath: string, sessionId: string): Promise<void> {
  await updateSessionMetadata(workspaceRootPath, sessionId, {
    isArchived: true,
    archivedAt: Date.now(),
  });
}

/**
 * Unarchive a session
 */
export async function unarchiveSession(workspaceRootPath: string, sessionId: string): Promise<void> {
  await updateSessionMetadata(workspaceRootPath, sessionId, {
    isArchived: false,
    archivedAt: undefined,
  });
}

// ============================================================
// Pending Plan Execution
// ============================================================

/**
 * Set pending plan execution state.
 */
export async function setPendingPlanExecution(
  workspaceRootPath: string,
  sessionId: string,
  planPath: string,
  draftInputSnapshot?: string,
): Promise<void> {
  const db = getWorkspaceDb(workspaceRootPath);
  db.update(sessionsTable)
    .set({
      pendingPlanExecution: {
        planPath,
        draftInputSnapshot,
        awaitingCompaction: true,
      },
    })
    .where(eq(sessionsTable.id, sessionId))
    .run();

  dbEvents.emit('session:metadata', sessionId);
}

/**
 * Mark compaction as complete for pending plan execution.
 */
export async function markCompactionComplete(
  workspaceRootPath: string,
  sessionId: string
): Promise<void> {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .get();

  if (!row?.pendingPlanExecution) return;

  const pending = row.pendingPlanExecution as SessionConfig['pendingPlanExecution'];
  if (pending) {
    pending.awaitingCompaction = false;
    db.update(sessionsTable)
      .set({ pendingPlanExecution: pending })
      .where(eq(sessionsTable.id, sessionId))
      .run();
  }
}

/**
 * Mark pending plan execution as already dispatched from the UI.
 * This prevents reload recovery from sending the same approval message twice
 * if cleanup fails after the send has already been kicked off.
 */
export async function markPendingPlanExecutionDispatched(
  workspaceRootPath: string,
  sessionId: string
): Promise<void> {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .get();

  if (!row?.pendingPlanExecution) return;

  const pending = row.pendingPlanExecution as SessionConfig['pendingPlanExecution'];
  if (pending) {
    pending.executionDispatched = true;
    db.update(sessionsTable)
      .set({ pendingPlanExecution: pending })
      .where(eq(sessionsTable.id, sessionId))
      .run();
  }
}

/**
 * Clear pending plan execution state.
 */
export async function clearPendingPlanExecution(
  workspaceRootPath: string,
  sessionId: string
): Promise<void> {
  const db = getWorkspaceDb(workspaceRootPath);
  db.update(sessionsTable)
    .set({ pendingPlanExecution: null })
    .where(eq(sessionsTable.id, sessionId))
    .run();
}

/**
 * Get pending plan execution state for a session.
 */
export function getPendingPlanExecution(
  workspaceRootPath: string,
  sessionId: string
): { planPath: string; draftInputSnapshot?: string; awaitingCompaction: boolean; executionDispatched: boolean } | null {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .get();

  const pending = row?.pendingPlanExecution as SessionConfig['pendingPlanExecution'];
  if (!pending) return null;
  return {
    ...pending,
    executionDispatched: pending.executionDispatched === true,
  };
}

/**
 * Update SDK session ID for a session
 */
export async function updateSessionSdkId(
  workspaceRootPath: string,
  sessionId: string,
  sdkSessionId: string
): Promise<void> {
  const db = getWorkspaceDb(workspaceRootPath);
  db.update(sessionsTable)
    .set({ sdkSessionId })
    .where(eq(sessionsTable.id, sessionId))
    .run();
}

/**
 * Check if sdkCwd can be safely updated for a session.
 */
export function canUpdateSdkCwd(session: StoredSession): boolean {
  return session.messages.length === 0 && !session.sdkSessionId;
}

// ============================================================
// Session Filtering (SQLite-powered, efficient)
// ============================================================

/**
 * List flagged sessions (excludes archived)
 */
export function listFlaggedSessions(workspaceRootPath: string): SessionMetadata[] {
  return listActiveSessions(workspaceRootPath).filter(s => s.isFlagged === true);
}

/**
 * List completed sessions (category: closed, excludes archived)
 */
export function listCompletedSessions(workspaceRootPath: string): SessionMetadata[] {
  return listActiveSessions(workspaceRootPath).filter(s => {
    const category = getStatusCategory(workspaceRootPath, s.sessionStatus || 'todo');
    return category === 'closed';
  });
}

/**
 * List inbox sessions (category: open, excludes archived)
 */
export function listInboxSessions(workspaceRootPath: string): SessionMetadata[] {
  return listActiveSessions(workspaceRootPath).filter(s => {
    const category = getStatusCategory(workspaceRootPath, s.sessionStatus || 'todo');
    return category === 'open';
  });
}

/**
 * List archived sessions
 */
export function listArchivedSessions(workspaceRootPath: string): SessionMetadata[] {
  return listSessions(workspaceRootPath).filter(s => s.isArchived === true);
}

/**
 * List active (non-archived) sessions
 */
export function listActiveSessions(workspaceRootPath: string): SessionMetadata[] {
  return listSessions(workspaceRootPath).filter(s => s.isArchived !== true);
}

/**
 * Delete archived sessions older than the specified number of days
 * Returns the number of sessions deleted
 */
export function deleteOldArchivedSessions(workspaceRootPath: string, retentionDays: number): number {
  const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
  const archivedSessions = listArchivedSessions(workspaceRootPath);
  let deletedCount = 0;

  for (const session of archivedSessions) {
    const archiveTime = session.archivedAt ?? session.lastUsedAt;
    if (archiveTime < cutoffTime) {
      if (deleteSession(workspaceRootPath, session.id)) {
        deletedCount++;
      }
    }
  }

  return deletedCount;
}

// ============================================================
// Plan Storage (Session-Scoped, filesystem-based — unchanged)
// ============================================================

/**
 * Slugify a string for file names
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
}

/**
 * Generate a unique, readable file name for a plan
 */
function generatePlanFileName(plan: Plan, plansDir: string): string {
  let name = plan.title || plan.context?.substring(0, 50) || 'untitled';
  let slug = slugify(name);

  if (slug.length > 40) {
    slug = slug.substring(0, 40).replace(/-$/, '');
  }

  const date = new Date().toISOString().split('T')[0];
  const baseName = `${date}-${slug}`;

  let fileName = baseName;
  let counter = 2;

  while (existsSync(join(plansDir, `${fileName}.md`))) {
    fileName = `${baseName}-${counter}`;
    counter++;
  }

  return fileName;
}

/**
 * Ensure the plans directory exists
 */
function ensurePlansDir(workspaceRootPath: string, sessionId: string): string {
  const plansDir = getSessionPlansPath(workspaceRootPath, sessionId);
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true });
  }
  return plansDir;
}

/**
 * Format a plan as markdown
 */
export function formatPlanAsMarkdown(plan: Plan): string {
  const lines: string[] = [];

  lines.push(`# ${plan.title}`);
  lines.push('');
  lines.push(`**Status:** ${plan.state}`);
  lines.push(`**Created:** ${new Date(plan.createdAt).toISOString()}`);
  if (plan.updatedAt !== plan.createdAt) {
    lines.push(`**Updated:** ${new Date(plan.updatedAt).toISOString()}`);
  }
  lines.push('');

  if (plan.context) {
    lines.push('## Summary');
    lines.push('');
    lines.push(plan.context);
    lines.push('');
  }

  lines.push('## Steps');
  lines.push('');
  for (const step of plan.steps) {
    const checkbox = step.status === 'completed' ? '[x]' : '[ ]';
    const status = step.status === 'in_progress' ? ' *(in progress)*' : '';
    lines.push(`- ${checkbox} ${step.description}${status}`);
    if (step.details) {
      lines.push(`  - Tools: ${step.details}`);
    }
  }
  lines.push('');

  if (plan.refinementHistory && plan.refinementHistory.length > 0) {
    lines.push('## Refinement History');
    lines.push('');
    for (const entry of plan.refinementHistory) {
      lines.push(`### Round ${entry.round}`);
      lines.push(`**Feedback:** ${entry.feedback}`);
      if (entry.questions && entry.questions.length > 0) {
        lines.push(`**Questions:** ${entry.questions.join(', ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Parse a markdown plan file back to a Plan object
 */
export function parsePlanFromMarkdown(content: string, planId: string): Plan | null {
  try {
    const lines = content.split('\n');

    const titleLine = lines.find(l => l.startsWith('# '));
    const title = titleLine ? titleLine.substring(2).trim() : 'Untitled Plan';

    const statusLine = lines.find(l => l.startsWith('**Status:**'));
    const stateStr = statusLine ? statusLine.replace('**Status:**', '').trim() : 'ready';
    const state = (['creating', 'refining', 'ready', 'executing', 'completed', 'cancelled'].includes(stateStr)
      ? stateStr
      : 'ready') as Plan['state'];

    const summaryIdx = lines.findIndex(l => l === '## Summary');
    const stepsIdx = lines.findIndex(l => l === '## Steps');
    let context = '';
    if (summaryIdx !== -1 && stepsIdx !== -1) {
      context = lines.slice(summaryIdx + 2, stepsIdx).join('\n').trim();
    }

    const steps: Plan['steps'] = [];
    if (stepsIdx !== -1) {
      for (let i = stepsIdx + 2; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.startsWith('##')) break;
        if (line.startsWith('- [')) {
          const isCompleted = line.startsWith('- [x]');
          const isInProgress = line.includes('*(in progress)*');
          const description = line
            .replace(/^- \[[ x]\] /, '')
            .replace(' *(in progress)*', '')
            .trim();
          steps.push({
            id: `step-${steps.length + 1}`,
            description,
            status: isCompleted ? 'completed' : isInProgress ? 'in_progress' : 'pending',
          });
        }
      }
    }

    return {
      id: planId,
      title,
      state,
      context,
      steps,
      refinementRound: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Save a plan to a markdown file
 */
export function savePlanToFile(
  workspaceRootPath: string,
  sessionId: string,
  plan: Plan,
  fileName?: string
): string {
  const plansDir = ensurePlansDir(workspaceRootPath, sessionId);
  const name = fileName || generatePlanFileName(plan, plansDir);
  const filePath = join(plansDir, `${name}.md`);
  const content = formatPlanAsMarkdown(plan);

  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Load a plan from a markdown file by name
 */
export function loadPlanFromFile(
  workspaceRootPath: string,
  sessionId: string,
  fileName: string
): Plan | null {
  const plansDir = getSessionPlansPath(workspaceRootPath, sessionId);
  const filePath = join(plansDir, `${fileName}.md`);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return parsePlanFromMarkdown(content, fileName);
  } catch {
    return null;
  }
}

/**
 * Load a plan from a full file path
 */
export function loadPlanFromPath(filePath: string): Plan | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const fileName = basename(filePath).replace('.md', '') || 'unknown';
    return parsePlanFromMarkdown(content, fileName);
  } catch {
    return null;
  }
}

/**
 * List all plan files in a session
 */
export function listPlanFiles(
  workspaceRootPath: string,
  sessionId: string
): Array<{ name: string; path: string; modifiedAt: number }> {
  const plansDir = getSessionPlansPath(workspaceRootPath, sessionId);
  if (!existsSync(plansDir)) {
    return [];
  }

  try {
    const files = readdirSync(plansDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const filePath = join(plansDir, f);
        const stats = existsSync(filePath) ? statSync(filePath) : null;
        return {
          name: f.replace('.md', ''),
          path: filePath,
          modifiedAt: stats?.mtimeMs || 0,
        };
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt);

    return files;
  } catch {
    return [];
  }
}

/**
 * Delete a plan file
 */
export function deletePlanFile(
  workspaceRootPath: string,
  sessionId: string,
  fileName: string
): boolean {
  const plansDir = getSessionPlansPath(workspaceRootPath, sessionId);
  const filePath = join(plansDir, `${fileName}.md`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Get the most recent plan file for a session
 */
export function getMostRecentPlanFile(
  workspaceRootPath: string,
  sessionId: string
): { name: string; path: string } | null {
  const files = listPlanFiles(workspaceRootPath, sessionId);
  return files.length > 0 ? files[0]! : null;
}

// ============================================================
// Attachments Directory
// ============================================================

/**
 * Ensure attachments directory exists
 */
export function ensureAttachmentsDir(workspaceRootPath: string, sessionId: string): string {
  const dir = getSessionAttachmentsPath(workspaceRootPath, sessionId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
