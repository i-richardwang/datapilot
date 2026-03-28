/**
 * Phase 3 Integration Tests — Sessions DB Storage
 *
 * Tests for sessions/storage.db.ts module.
 * Covers: full session lifecycle (create → save messages → load → update metadata
 * → flag → archive → delete), listSessions filtering, deleteOldArchivedSessions.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { autoRegisterDriver } from '../driver.ts';
import { closeWorkspaceDb } from '../connection.ts';

import {
  ensureSessionsDir,
  getSessionPath,
  getSessionFilePath,
  ensureSessionDir,
  getSessionAttachmentsPath,
  getSessionPlansPath,
  getSessionDataPath,
  getSessionDownloadsPath,
  generateSessionId,
  createSession,
  getOrCreateSessionById,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  clearSessionMessages,
  updateSessionMetadata,
  flagSession,
  unflagSession,
  setSessionStatus,
  setSessionLabels,
  archiveSession,
  unarchiveSession,
  setPendingPlanExecution,
  markCompactionComplete,
  clearPendingPlanExecution,
  getPendingPlanExecution,
  updateSessionSdkId,
  canUpdateSdkCwd,
  listFlaggedSessions,
  listArchivedSessions,
  listActiveSessions,
  deleteOldArchivedSessions,
  formatPlanAsMarkdown,
  savePlanToFile,
  listPlanFiles,
} from '../../sessions/storage.db.ts';

import type { StoredSession, SessionTokenUsage } from '../../sessions/types.ts';
import type { StoredMessage } from '@craft-agent/core/types';

beforeAll(async () => {
  await autoRegisterDriver();
});

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'datapilot-phase3-test-'));
  mkdirSync(join(testDir, 'sessions'), { recursive: true });
});

afterEach(() => {
  closeWorkspaceDb(testDir);
  rmSync(testDir, { recursive: true, force: true });
});

// Helper to create a minimal StoredMessage
function makeMessage(id: string, type: 'user' | 'assistant' = 'user', content = 'Hello'): StoredMessage {
  return {
    id,
    type,
    content,
    timestamp: Date.now(),
  } as StoredMessage;
}

// Helper to create a minimal StoredSession
function makeStoredSession(sessionId: string, overrides?: Partial<StoredSession>): StoredSession {
  return {
    id: sessionId,
    workspaceRootPath: testDir,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    messages: [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
    ...overrides,
  };
}

// ─── Directory Utilities ─────────────────────────────────────────────────────

describe('Session Directory Utilities', () => {
  test('ensureSessionsDir creates directory', () => {
    const dir = ensureSessionsDir(testDir);
    expect(existsSync(dir)).toBe(true);
  });

  test('getSessionPath returns correct path', () => {
    const path = getSessionPath(testDir, 'test-session');
    expect(path).toContain('sessions');
    expect(path).toContain('test-session');
  });

  test('ensureSessionDir creates all subdirectories', () => {
    const dir = ensureSessionDir(testDir, 'sub-test');
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, 'plans'))).toBe(true);
    expect(existsSync(join(dir, 'attachments'))).toBe(true);
    expect(existsSync(join(dir, 'data'))).toBe(true);
    expect(existsSync(join(dir, 'downloads'))).toBe(true);
    expect(existsSync(join(dir, 'long_responses'))).toBe(true);
  });

  test('path helpers return correct subdirectory paths', () => {
    expect(getSessionAttachmentsPath(testDir, 'x')).toContain('attachments');
    expect(getSessionPlansPath(testDir, 'x')).toContain('plans');
    expect(getSessionDataPath(testDir, 'x')).toContain('data');
    expect(getSessionDownloadsPath(testDir, 'x')).toContain('downloads');
  });
});

// ─── Session ID Generation ───────────────────────────────────────────────────

describe('Session ID Generation', () => {
  test('generateSessionId returns unique IDs', () => {
    const id1 = generateSessionId(testDir);
    // Save a session with this ID so the second one is different
    saveSession(makeStoredSession(id1));
    const id2 = generateSessionId(testDir);
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^\d{6}-/);
    expect(id2).toMatch(/^\d{6}-/);
  });
});

// ─── Session CRUD ────────────────────────────────────────────────────────────

describe('Session CRUD', () => {
  test('createSession creates a new session', async () => {
    const session = await createSession(testDir, {
      name: 'Test Session',
      sessionStatus: 'todo',
    });

    expect(session.id).toBeTruthy();
    expect(session.workspaceRootPath).toBe(testDir);
    expect(session.name).toBe('Test Session');
    expect(session.createdAt).toBeGreaterThan(0);

    // Session dir should exist
    expect(existsSync(getSessionPath(testDir, session.id))).toBe(true);
  });

  test('createSession with options', async () => {
    const session = await createSession(testDir, {
      name: 'Custom',
      permissionMode: 'safe',
      model: 'claude-sonnet-4-6',
      hidden: true,
      isBatch: true,
      labels: ['bug', 'urgent'],
      isFlagged: true,
    });

    expect(session.permissionMode).toBe('safe');
    expect(session.model).toBe('claude-sonnet-4-6');
    expect(session.hidden).toBe(true);
    expect(session.isBatch).toBe(true);
    expect(session.labels).toEqual(['bug', 'urgent']);
    expect(session.isFlagged).toBe(true);
  });

  test('saveSession and loadSession round-trip', () => {
    const messages = [
      makeMessage('msg-1', 'user', 'Hello'),
      makeMessage('msg-2', 'assistant', 'Hi there'),
    ];

    const session = makeStoredSession('round-trip-test', {
      name: 'Round Trip',
      messages,
      tokenUsage: {
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        contextTokens: 50,
        costUsd: 0.01,
      },
    });

    saveSession(session);

    const loaded = loadSession(testDir, 'round-trip-test');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('round-trip-test');
    expect(loaded!.name).toBe('Round Trip');
    expect(loaded!.messages).toHaveLength(2);
    expect(loaded!.messages[0]!.id).toBe('msg-1');
    expect(loaded!.messages[0]!.content).toBe('Hello');
    expect(loaded!.messages[1]!.id).toBe('msg-2');
    expect(loaded!.tokenUsage.inputTokens).toBe(100);
    expect(loaded!.tokenUsage.totalTokens).toBe(300);
  });

  test('saveSession updates existing session', () => {
    const session = makeStoredSession('update-test', { name: 'Original' });
    saveSession(session);

    session.name = 'Updated';
    session.messages = [makeMessage('msg-1', 'user', 'New message')];
    saveSession(session);

    const loaded = loadSession(testDir, 'update-test');
    expect(loaded!.name).toBe('Updated');
    expect(loaded!.messages).toHaveLength(1);
  });

  test('loadSession returns null for nonexistent', () => {
    expect(loadSession(testDir, 'nonexistent')).toBeNull();
  });

  test('getOrCreateSessionById creates new session', async () => {
    const session = await getOrCreateSessionById(testDir, 'custom-id-123');
    expect(session.id).toBe('custom-id-123');

    const loaded = loadSession(testDir, 'custom-id-123');
    expect(loaded).not.toBeNull();
  });

  test('getOrCreateSessionById returns existing session', async () => {
    const session1 = await getOrCreateSessionById(testDir, 'existing-id');
    const session2 = await getOrCreateSessionById(testDir, 'existing-id');
    expect(session1.id).toBe(session2.id);
    expect(session1.createdAt).toBe(session2.createdAt);
  });

  test('deleteSession removes session and directory', async () => {
    const session = await createSession(testDir, { name: 'Delete Me' });
    expect(loadSession(testDir, session.id)).not.toBeNull();

    const result = deleteSession(testDir, session.id);
    expect(result).toBe(true);
    expect(loadSession(testDir, session.id)).toBeNull();
    expect(existsSync(getSessionPath(testDir, session.id))).toBe(false);
  });

  test('clearSessionMessages removes messages but preserves metadata', async () => {
    const session = makeStoredSession('clear-test', {
      name: 'Keep This Name',
      messages: [makeMessage('msg-1'), makeMessage('msg-2')],
      sdkSessionId: 'sdk-123',
    });
    saveSession(session);

    await clearSessionMessages(testDir, 'clear-test');

    const loaded = loadSession(testDir, 'clear-test');
    expect(loaded!.name).toBe('Keep This Name');
    expect(loaded!.messages).toHaveLength(0);
    expect(loaded!.sdkSessionId).toBeUndefined();
    expect(loaded!.tokenUsage.inputTokens).toBe(0);
  });
});

// ─── Metadata Updates ────────────────────────────────────────────────────────

describe('Session Metadata Updates', () => {
  test('updateSessionMetadata updates multiple fields', async () => {
    const session = await createSession(testDir);

    await updateSessionMetadata(testDir, session.id, {
      name: 'Renamed',
      isFlagged: true,
      sessionStatus: 'done',
      labels: ['feature'],
    });

    const loaded = loadSession(testDir, session.id);
    expect(loaded!.name).toBe('Renamed');
    expect(loaded!.isFlagged).toBe(true);
    expect(loaded!.sessionStatus).toBe('done');
    expect(loaded!.labels).toEqual(['feature']);
  });

  test('flagSession and unflagSession', async () => {
    const session = await createSession(testDir);

    await flagSession(testDir, session.id);
    let loaded = loadSession(testDir, session.id);
    expect(loaded!.isFlagged).toBe(true);

    await unflagSession(testDir, session.id);
    loaded = loadSession(testDir, session.id);
    expect(loaded!.isFlagged).toBe(false);
  });

  test('setSessionStatus', async () => {
    const session = await createSession(testDir);

    await setSessionStatus(testDir, session.id, 'done');
    const loaded = loadSession(testDir, session.id);
    expect(loaded!.sessionStatus).toBe('done');
  });

  test('setSessionLabels', async () => {
    const session = await createSession(testDir);

    await setSessionLabels(testDir, session.id, ['bug', 'urgent']);
    const loaded = loadSession(testDir, session.id);
    expect(loaded!.labels).toEqual(['bug', 'urgent']);
  });

  test('archiveSession and unarchiveSession', async () => {
    const session = await createSession(testDir);

    await archiveSession(testDir, session.id);
    let loaded = loadSession(testDir, session.id);
    expect(loaded!.isArchived).toBe(true);
    expect(loaded!.archivedAt).toBeGreaterThan(0);

    await unarchiveSession(testDir, session.id);
    loaded = loadSession(testDir, session.id);
    expect(loaded!.isArchived).toBe(false);
  });

  test('updateSessionSdkId', async () => {
    const session = await createSession(testDir);

    await updateSessionSdkId(testDir, session.id, 'new-sdk-id');
    const loaded = loadSession(testDir, session.id);
    expect(loaded!.sdkSessionId).toBe('new-sdk-id');
  });

  test('canUpdateSdkCwd checks conditions', () => {
    const emptySession = makeStoredSession('test', { messages: [] });
    expect(canUpdateSdkCwd(emptySession)).toBe(true);

    const withMessages = makeStoredSession('test', {
      messages: [makeMessage('msg-1')],
    });
    expect(canUpdateSdkCwd(withMessages)).toBe(false);

    const withSdk = makeStoredSession('test', {
      sdkSessionId: 'sdk-1',
    });
    expect(canUpdateSdkCwd(withSdk)).toBe(false);
  });
});

// ─── Pending Plan Execution ──────────────────────────────────────────────────

describe('Pending Plan Execution', () => {
  test('setPendingPlanExecution and getPendingPlanExecution', async () => {
    const session = await createSession(testDir);

    await setPendingPlanExecution(testDir, session.id, '/path/to/plan.md', 'draft input');

    const pending = getPendingPlanExecution(testDir, session.id);
    expect(pending).not.toBeNull();
    expect(pending!.planPath).toBe('/path/to/plan.md');
    expect(pending!.draftInputSnapshot).toBe('draft input');
    expect(pending!.awaitingCompaction).toBe(true);
  });

  test('markCompactionComplete sets awaitingCompaction to false', async () => {
    const session = await createSession(testDir);
    await setPendingPlanExecution(testDir, session.id, '/plan.md');

    await markCompactionComplete(testDir, session.id);

    const pending = getPendingPlanExecution(testDir, session.id);
    expect(pending!.awaitingCompaction).toBe(false);
  });

  test('clearPendingPlanExecution removes pending state', async () => {
    const session = await createSession(testDir);
    await setPendingPlanExecution(testDir, session.id, '/plan.md');

    await clearPendingPlanExecution(testDir, session.id);

    const pending = getPendingPlanExecution(testDir, session.id);
    expect(pending).toBeNull();
  });
});

// ─── Session Filtering ───────────────────────────────────────────────────────

describe('Session Filtering', () => {
  test('listSessions returns sorted by lastUsedAt', async () => {
    const s1 = await createSession(testDir, { name: 'First' });
    const s2 = await createSession(testDir, { name: 'Second' });
    const s3 = await createSession(testDir, { name: 'Third' });

    const sessions = listSessions(testDir);
    expect(sessions.length).toBe(3);
    // Most recent first
    expect(sessions[0]!.id).toBe(s3.id);
  });

  test('listSessions excludes hidden sessions', async () => {
    await createSession(testDir, { name: 'Visible' });
    await createSession(testDir, { name: 'Hidden', hidden: true });

    const sessions = listSessions(testDir);
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.name).toBe('Visible');
  });

  test('listFlaggedSessions', async () => {
    const s1 = await createSession(testDir, { isFlagged: true });
    await createSession(testDir);

    const flagged = listFlaggedSessions(testDir);
    expect(flagged.length).toBe(1);
    expect(flagged[0]!.id).toBe(s1.id);
  });

  test('listArchivedSessions', async () => {
    const s1 = await createSession(testDir);
    await archiveSession(testDir, s1.id);
    await createSession(testDir);

    const archived = listArchivedSessions(testDir);
    expect(archived.length).toBe(1);
    expect(archived[0]!.id).toBe(s1.id);
  });

  test('listActiveSessions excludes archived', async () => {
    const s1 = await createSession(testDir);
    const s2 = await createSession(testDir);
    await archiveSession(testDir, s1.id);

    const active = listActiveSessions(testDir);
    expect(active.length).toBe(1);
    expect(active[0]!.id).toBe(s2.id);
  });

  test('deleteOldArchivedSessions respects retention period', async () => {
    const s1 = await createSession(testDir);
    const s2 = await createSession(testDir);

    // Archive s1 with old date
    await archiveSession(testDir, s1.id);
    // Force archivedAt to be old (31 days ago)
    const db = (await import('../connection.ts')).getWorkspaceDb(testDir);
    const { sessions: st } = await import('../schema/sessions.sql.ts');
    const { eq } = await import('drizzle-orm');
    db.update(st)
      .set({ archivedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 })
      .where(eq(st.id, s1.id))
      .run();

    // Archive s2 recently
    await archiveSession(testDir, s2.id);

    const deleted = deleteOldArchivedSessions(testDir, 30);
    expect(deleted).toBe(1);

    // s1 should be deleted, s2 should remain
    expect(loadSession(testDir, s1.id)).toBeNull();
    expect(loadSession(testDir, s2.id)).not.toBeNull();
  });
});

// ─── Plan Storage ────────────────────────────────────────────────────────────

describe('Plan Storage (filesystem)', () => {
  test('savePlanToFile and listPlanFiles', async () => {
    const session = await createSession(testDir);

    const plan = {
      id: 'plan-1',
      title: 'Test Plan',
      state: 'ready' as const,
      context: 'Plan context',
      steps: [
        { id: 'step-1', description: 'Step 1', status: 'pending' as const },
        { id: 'step-2', description: 'Step 2', status: 'completed' as const },
      ],
      refinementRound: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const filePath = savePlanToFile(testDir, session.id, plan);
    expect(existsSync(filePath)).toBe(true);

    const files = listPlanFiles(testDir, session.id);
    expect(files.length).toBe(1);
    expect(files[0]!.name).toContain('test-plan');
  });

  test('formatPlanAsMarkdown produces valid markdown', () => {
    const plan = {
      id: 'plan-1',
      title: 'My Plan',
      state: 'executing' as const,
      context: 'Some context',
      steps: [
        { id: 's1', description: 'Do thing', status: 'completed' as const },
        { id: 's2', description: 'Do other thing', status: 'in_progress' as const },
      ],
      refinementRound: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const md = formatPlanAsMarkdown(plan);
    expect(md).toContain('# My Plan');
    expect(md).toContain('**Status:** executing');
    expect(md).toContain('- [x] Do thing');
    expect(md).toContain('- [ ] Do other thing *(in progress)*');
  });
});

// ─── Message Content Portability ─────────────────────────────────────────────

describe('Message Content Portability', () => {
  test('session paths in message content are portable', async () => {
    const session = await createSession(testDir);
    const sessionDir = getSessionPath(testDir, session.id);

    // Save a message with an absolute session path embedded
    const stored = makeStoredSession(session.id, {
      messages: [
        makeMessage('msg-1', 'user', `File at ${sessionDir}/attachments/file.png`),
      ],
    });
    saveSession(stored);

    // Load and verify the path was expanded back
    const loaded = loadSession(testDir, session.id);
    expect(loaded!.messages[0]!.content).toContain(sessionDir);
    expect(loaded!.messages[0]!.content).not.toContain('{{SESSION_PATH}}');
  });
});
