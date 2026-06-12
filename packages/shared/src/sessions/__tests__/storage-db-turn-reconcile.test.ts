/**
 * Regression tests for the turn-end reconcile persistence path:
 * - saveSessionTurnReconcile: upserts only this turn's rows when the DB rows
 *   are an exact positional prefix of memory; falls back to saveSession's
 *   full delete-all + reinsert-all on any drift (removal / reorder / gap)
 * - loadSessionHeader: header from the denormalized sessions row only,
 *   without touching the messages table
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { eq, and } from 'drizzle-orm'
import { autoRegisterDriver } from '../../db/driver.ts'
import { getWorkspaceDb } from '../../db/connection.ts'
import { messages as messagesTable } from '../../db/schema/sessions.sql.ts'
import {
  saveSession,
  saveSessionTurnReconcile,
  loadSession,
  loadSessionHeader,
} from '../storage.db.ts'
import type { StoredSession, StoredMessage } from '../types.ts'

beforeAll(async () => {
  await autoRegisterDriver()
})

function makeMessage(id: string, content: string, type: StoredMessage['type'] = 'user'): StoredMessage {
  return {
    id,
    type,
    content,
    timestamp: 1000,
  } as StoredMessage
}

function makeSession(workspaceRootPath: string, messages: StoredMessage[]): StoredSession {
  return {
    id: '260101-turn-reconcile',
    workspaceRootPath,
    createdAt: 1000,
    lastUsedAt: 2000,
    name: 'Turn Reconcile',
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

/** Overwrite a message row's content out-of-band, bypassing the save APIs. */
function corruptRowContent(workspaceRootPath: string, sessionId: string, messageId: string, sentinel: string) {
  const db = getWorkspaceDb(workspaceRootPath)
  db.update(messagesTable)
    .set({ content: { id: messageId, type: 'user', content: sentinel, timestamp: 1 } })
    .where(and(eq(messagesTable.sessionId, sessionId), eq(messagesTable.id, messageId)))
    .run()
}

describe('saveSessionTurnReconcile', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-reconcile-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('appends new tail rows and skips untouched rows (no full rewrite)', () => {
    const session = makeSession(tempDir, [
      makeMessage('msg-1', 'one'),
      makeMessage('msg-2', 'two'),
    ])
    saveSession(session)

    // Sentinel on an untouched row: a full rewrite would clobber it,
    // a targeted reconcile must leave it alone.
    corruptRowContent(tempDir, session.id, 'msg-1', 'SENTINEL')

    const turnSession = makeSession(tempDir, [
      makeMessage('msg-1', 'one'),
      makeMessage('msg-2', 'two'),
      makeMessage('msg-3', 'three', 'assistant'),
      makeMessage('msg-4', 'four', 'tool'),
    ])
    saveSessionTurnReconcile(turnSession, ['msg-3'])

    const loaded = loadSession(tempDir, session.id)!
    expect(loaded.messages.map(m => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3', 'msg-4'])
    // msg-4 was a tail row outside the changed set — must still be written
    expect(loaded.messages[3]!.content).toBe('four')
    // untouched msg-1 was not rewritten — proves the full-rewrite path didn't run
    expect(loaded.messages[0]!.content).toBe('SENTINEL')
  })

  it('reasserts rows in the changed set', () => {
    const session = makeSession(tempDir, [
      makeMessage('msg-1', 'one'),
      makeMessage('msg-2', 'two'),
    ])
    saveSession(session)
    corruptRowContent(tempDir, session.id, 'msg-2', 'STALE')

    saveSessionTurnReconcile(session, ['msg-2'])

    const loaded = loadSession(tempDir, session.id)!
    expect(loaded.messages[1]!.content).toBe('two')
  })

  it('falls back to full rewrite when messages were removed', () => {
    const session = makeSession(tempDir, [
      makeMessage('msg-1', 'one'),
      makeMessage('msg-2', 'two'),
      makeMessage('msg-3', 'three'),
    ])
    saveSession(session)
    corruptRowContent(tempDir, session.id, 'msg-1', 'SENTINEL')

    // Memory removed the middle message (e.g. queue-cancel/compaction drift)
    const shrunk = makeSession(tempDir, [
      makeMessage('msg-1', 'one'),
      makeMessage('msg-3', 'three'),
    ])
    saveSessionTurnReconcile(shrunk, [])

    const loaded = loadSession(tempDir, session.id)!
    expect(loaded.messages.map(m => m.id)).toEqual(['msg-1', 'msg-3'])
    // Full rewrite reasserted every row — sentinel must be gone
    expect(loaded.messages[0]!.content).toBe('one')
  })

  it('falls back to full rewrite on reorder drift', () => {
    const session = makeSession(tempDir, [
      makeMessage('msg-1', 'one'),
      makeMessage('msg-2', 'two'),
    ])
    saveSession(session)

    const reordered = makeSession(tempDir, [
      makeMessage('msg-2', 'two'),
      makeMessage('msg-1', 'one'),
    ])
    saveSessionTurnReconcile(reordered, [])

    const loaded = loadSession(tempDir, session.id)!
    expect(loaded.messages.map(m => m.id)).toEqual(['msg-2', 'msg-1'])
  })

  it('updates the sessions row derived columns on the targeted path', () => {
    const session = makeSession(tempDir, [makeMessage('msg-1', 'one')])
    saveSession(session)

    const turnSession = makeSession(tempDir, [
      makeMessage('msg-1', 'one'),
      makeMessage('msg-2', 'final answer', 'assistant'),
    ])
    saveSessionTurnReconcile(turnSession, [])

    const header = loadSessionHeader(tempDir, session.id)!
    expect(header.messageCount).toBe(2)
    expect(header.lastMessageRole).toBe('assistant')
  })
})

describe('loadSessionHeader', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-header-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('builds the header from denormalized columns', () => {
    const session = makeSession(tempDir, [
      makeMessage('msg-1', 'first user message'),
      makeMessage('msg-2', 'assistant reply', 'assistant'),
    ])
    saveSession(session)

    const header = loadSessionHeader(tempDir, session.id)!
    expect(header.id).toBe(session.id)
    expect(header.name).toBe('Turn Reconcile')
    expect(header.messageCount).toBe(2)
    expect(header.lastMessageRole).toBe('assistant')
    expect(header.preview).toContain('first user message')
    expect(header.tokenUsage.totalTokens).toBe(30)
  })

  it('returns null for unknown session ids', () => {
    expect(loadSessionHeader(tempDir, 'does-not-exist')).toBeNull()
  })
})
