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
import { eq, desc } from 'drizzle-orm';
import { getWorkspaceSessionsPath } from '../workspaces/storage.ts';
import { generateUniqueSessionId } from './slug-generator.ts';
import { toPortablePath, expandPath, normalizePath } from '../utils/paths.ts';
import { sanitizeSessionId } from './validation.ts';
import { validateSessionStatus } from '../statuses/validation.ts';
import type {
  SessionConfig,
  StoredSession,
  SessionMetadata,
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
 * Get existing session IDs from DB for collision detection
 */
function getExistingSessionIds(workspaceRootPath: string): Set<string> {
  const db = getWorkspaceDb(workspaceRootPath);
  const rows = db.select().from(sessionsTable).all();
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
 * Convert a StoredSession to a DB row values object
 */
function sessionToRow(session: StoredSession, workspaceRootPath: string): typeof sessionsTable.$inferInsert {
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
 * Convert a session DB row to SessionMetadata for list views
 */
function rowToMetadata(row: SessionRow, workspaceRootPath: string): SessionMetadata {
  const validatedStatus = validateSessionStatus(workspaceRootPath, row.sessionStatus ?? undefined);
  const planCount = listPlanFiles(workspaceRootPath, row.id).length;

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
    planCount: planCount > 0 ? planCount : undefined,
    sharedUrl: row.sharedUrl ?? undefined,
    sharedId: row.sharedId ?? undefined,
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
    isArchived: row.isArchived ?? undefined,
    archivedAt: row.archivedAt ?? undefined,
    branchFromMessageId: row.branchFromMessageId ?? undefined,
  };
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

  const rows = db.select()
    .from(sessionsTable)
    .where(eq(sessionsTable.hidden, false))
    .orderBy(desc(sessionsTable.lastUsedAt))
    .all();

  return rows.map(row => rowToMetadata(row, workspaceRootPath));
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
): { planPath: string; draftInputSnapshot?: string; awaitingCompaction: boolean } | null {
  const db = getWorkspaceDb(workspaceRootPath);
  const row = db.select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .get();

  return (row?.pendingPlanExecution as SessionConfig['pendingPlanExecution']) ?? null;
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
