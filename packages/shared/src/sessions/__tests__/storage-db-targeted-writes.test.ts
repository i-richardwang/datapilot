/**
 * Regression tests for the targeted session persistence split:
 * - saveSessionMeta: sessions-row-only writes that never touch message rows
 *   or message-derived columns
 * - saveSessionMessageUpdate: upserts only the changed message rows instead of
 *   delete-all + reinsert-all
 *
 * Guards the invariant that targeted writes and full saveSession writes can
 * interleave without corrupting messages, positions, or derived metadata.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { eq } from 'drizzle-orm'
import { autoRegisterDriver } from '../../db/driver.ts'
import { getWorkspaceDb } from '../../db/connection.ts'
import { sessions as sessionsTable, messages as messagesTable } from '../../db/schema/sessions.sql.ts'
import {
  saveSession,
  saveSessionMeta,
  saveSessionMessageUpdate,
  loadSession,
  type StoredSessionMeta,
} from '../storage.db.ts'
import type { StoredSession, StoredMessage } from '../types.ts'

beforeAll(async () => {
  await autoRegisterDriver()
})

function makeMessage(id: string, content: string): StoredMessage {
  return {
    id,
    type: 'user',
    content,
    timestamp: 1000,
  } as StoredMessage
}

function makeSession(workspaceRootPath: string, messages: StoredMessage[]): StoredSession {
  return {
    id: '260101-targeted-writes',
    workspaceRootPath,
    createdAt: 1000,
    lastUsedAt: 2000,
    name: 'Targeted Writes',
    messages,
    tokenUsage: {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      contextTokens: 100,
      costUsd: 0.001,
    },
  } as StoredSession
}

function sessionRow(workspaceRootPath: string, sessionId: string) {
  const db = getWorkspaceDb(workspaceRootPath)
  return db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId)).get()
}

describe('targeted session persistence (meta / message split)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-storage-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('saveSessionMeta', () => {
    it('updates metadata without touching message rows or derived columns', () => {
      const session = makeSession(tempDir, [
        makeMessage('msg-1', 'Hello'),
        makeMessage('msg-2', 'World'),
      ])
      saveSession(session)

      const { messages: _messages, tokenUsage: _tokenUsage, ...meta } = session
      const updatedMeta: StoredSessionMeta = {
        ...meta,
        name: 'Renamed',
        isFlagged: true,
      }
      saveSessionMeta(updatedMeta)

      const row = sessionRow(tempDir, session.id)
      expect(row?.name).toBe('Renamed')
      expect(row?.isFlagged).toBe(true)
      // Derived columns keep the values written by the full save
      expect(row?.messageCount).toBe(2)
      expect(row?.tokenUsage).toEqual(session.tokenUsage)

      const loaded = loadSession(tempDir, session.id)
      expect(loaded?.messages).toHaveLength(2)
      expect(loaded?.messages[0]?.content).toBe('Hello')
      expect(loaded?.messages[1]?.content).toBe('World')
    })

    it('preserves deferred-load fields when they are undefined (cold session)', () => {
      // Regression: SessionManager leaves these fields undefined on sessions
      // never opened since boot. A meta write must keep the DB values instead
      // of clearing them to NULL.
      const session = makeSession(tempDir, [makeMessage('msg-1', 'Hello')])
      session.enabledSourceSlugs = ['gmail', 'slack']
      session.transferredSessionSummary = 'handoff context'
      session.transferredSessionSummaryApplied = false
      session.sdkSessionId = 'sdk-123'
      saveSession(session)

      const { messages: _messages, tokenUsage: _tokenUsage, ...meta } = session
      const coldMeta: StoredSessionMeta = {
        ...meta,
        name: 'Cold rename',
        // Cold session: deferred-load fields are not in memory
        enabledSourceSlugs: undefined,
        transferredSessionSummary: undefined,
        transferredSessionSummaryApplied: undefined,
        // Intentional clear of a NON-deferred field must still write NULL
        sdkSessionId: undefined,
      }
      saveSessionMeta(coldMeta)

      const row = sessionRow(tempDir, session.id)
      expect(row?.name).toBe('Cold rename')
      // Deferred fields preserved
      expect(row?.enabledSourceSlugs).toEqual(['gmail', 'slack'])
      expect(row?.transferredSessionSummary).toBe('handoff context')
      expect(row?.transferredSessionSummaryApplied).toBe(false)
      // Non-deferred undefined still clears (e.g. onSdkSessionIdCleared)
      expect(row?.sdkSessionId).toBeNull()
    })

    it('inserts a row when the session does not exist yet', () => {
      const session = makeSession(tempDir, [])
      const { messages: _messages, tokenUsage: _tokenUsage, ...meta } = session
      saveSessionMeta(meta)

      const row = sessionRow(tempDir, session.id)
      expect(row?.name).toBe('Targeted Writes')
      expect(row?.messageCount).toBe(0)
    })
  })

  describe('saveSessionMessageUpdate', () => {
    it('appends a new message row and refreshes derived columns', () => {
      const session = makeSession(tempDir, [
        makeMessage('msg-1', 'Hello'),
        makeMessage('msg-2', 'World'),
      ])
      saveSession(session)

      session.messages.push(makeMessage('msg-3', 'Appended'))
      saveSessionMessageUpdate(session, ['msg-3'])

      const loaded = loadSession(tempDir, session.id)
      expect(loaded?.messages.map(m => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3'])
      expect(loaded?.messages[2]?.content).toBe('Appended')

      const row = sessionRow(tempDir, session.id)
      expect(row?.messageCount).toBe(3)
    })

    it('updates an existing message in place without rewriting siblings', () => {
      const session = makeSession(tempDir, [
        makeMessage('msg-1', 'Hello'),
        makeMessage('msg-2', 'World'),
        makeMessage('msg-3', 'Third'),
      ])
      saveSession(session)

      const db = getWorkspaceDb(tempDir)
      // Tamper a sibling row directly — a targeted write of msg-2 must NOT
      // restore it (delete-all + reinsert-all would).
      db.update(messagesTable)
        .set({ content: { id: 'msg-3', type: 'user', content: 'Tampered', timestamp: 1000 } })
        .where(eq(messagesTable.id, 'msg-3'))
        .run()

      session.messages[1] = { ...session.messages[1]!, content: 'World (edited)' } as StoredMessage
      saveSessionMessageUpdate(session, ['msg-2'])

      const loaded = loadSession(tempDir, session.id)
      expect(loaded?.messages[1]?.content).toBe('World (edited)')
      // Sibling row untouched by the targeted write
      expect(loaded?.messages[2]?.content).toBe('Tampered')
      // Order preserved
      expect(loaded?.messages.map(m => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3'])
    })

    it('interleaves with a later full save without drift', () => {
      const session = makeSession(tempDir, [makeMessage('msg-1', 'Hello')])
      saveSession(session)

      session.messages.push(makeMessage('msg-2', 'Streamed'))
      saveSessionMessageUpdate(session, ['msg-2'])

      // Turn-end full save (reconciliation anchor)
      saveSession(session)

      const loaded = loadSession(tempDir, session.id)
      expect(loaded?.messages.map(m => m.id)).toEqual(['msg-1', 'msg-2'])
      expect(loaded?.messages[1]?.content).toBe('Streamed')
    })
  })
})
