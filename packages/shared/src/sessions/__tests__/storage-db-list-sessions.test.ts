/**
 * Regression tests for list-time session metadata conversion:
 * - status validation uses one statuses query per listSessions call instead of
 *   a per-row SQL lookup, with identical fallback semantics (unknown → 'todo')
 * - planCount is no longer computed at list time (it required a per-session
 *   readdir/stat and had no consumer downstream of listSessions)
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { autoRegisterDriver } from '../../db/driver.ts'
import {
  saveSession,
  listSessions,
  listSessionMetadataPage,
  listSessionMetadataByIds,
  listSessionCountRows,
  countUnreadSessions,
  markWorkspaceSessionsRead,
  getSessionPlansPath,
} from '../storage.db.ts'
import { loadStatusConfig } from '../../statuses/storage.db.ts'
import type { StoredSession } from '../types.ts'

beforeAll(async () => {
  await autoRegisterDriver()
})

function makeSession(
  workspaceRootPath: string,
  id: string,
  sessionStatus?: string,
  overrides: Partial<StoredSession> = {}
): StoredSession {
  return {
    id,
    workspaceRootPath,
    createdAt: overrides.createdAt ?? 1000,
    lastUsedAt: overrides.lastUsedAt ?? 2000,
    name: `Session ${id}`,
    sessionStatus,
    lastMessageAt: overrides.lastMessageAt,
    isFlagged: overrides.isFlagged,
    labels: overrides.labels,
    hidden: overrides.hidden,
    isBatch: overrides.isBatch,
    batchId: overrides.batchId,
    isArchived: overrides.isArchived,
    hasUnread: overrides.hasUnread,
    messages: [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
    ...overrides,
  } as StoredSession
}

describe('listSessions metadata conversion', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-list-'))
    // Seed the default status set (todo, in-progress, done, ...) the same way
    // the app does on first workspace load.
    loadStatusConfig(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('keeps valid statuses and falls back to todo for unknown ones', () => {
    // 'done' is one of the always-seeded fixed statuses
    saveSession(makeSession(tempDir, '260101-valid-status', 'done'))
    saveSession(makeSession(tempDir, '260101-ghost-status', 'deleted-status'))
    saveSession(makeSession(tempDir, '260101-no-status', undefined))

    const metas = listSessions(tempDir)
    const byId = new Map(metas.map(m => [m.id, m]))

    expect(byId.get('260101-valid-status')?.sessionStatus).toBe('done')
    expect(byId.get('260101-ghost-status')?.sessionStatus).toBe('todo')
    expect(byId.get('260101-no-status')?.sessionStatus).toBe('todo')
  })

  it('does not compute planCount at list time even when plan files exist', () => {
    const sessionId = '260101-no-plancount'
    saveSession(makeSession(tempDir, sessionId, 'todo'))
    // A real plan file on disk: the old code would have surfaced planCount=1
    // here via a per-session readdir/stat. List-time conversion must not
    // touch the filesystem at all.
    const plansDir = getSessionPlansPath(tempDir, sessionId)
    mkdirSync(plansDir, { recursive: true })
    writeFileSync(join(plansDir, 'my-plan.md'), '# Plan\n', 'utf-8')

    const metas = listSessions(tempDir)
    expect(metas).toHaveLength(1)
    expect((metas[0] as unknown as Record<string, unknown>).planCount).toBeUndefined()
  })

  it('pages and sorts metadata in SQLite without loading full sessions', () => {
    saveSession(makeSession(tempDir, 'archived', 'todo', { isArchived: true, lastMessageAt: 50 }))
    saveSession(makeSession(tempDir, 'flagged-old', 'todo', { isFlagged: true, lastMessageAt: 10 }))
    saveSession(makeSession(tempDir, 'flagged-new', 'done', { isFlagged: true, lastMessageAt: 30 }))
    saveSession(makeSession(tempDir, 'plain', 'todo', { lastMessageAt: 40 }))

    const page = listSessionMetadataPage(tempDir, {
      filter: { archived: false, flagged: true },
      sortBy: 'recent',
      offset: 0,
      limit: 1,
    })

    expect(page.total).toBe(2)
    expect(page.rows.map(row => row.id)).toEqual(['flagged-new'])
  })

  it('applies label predicates before pagination while preserving id::value semantics', () => {
    saveSession(makeSession(tempDir, 'first', 'todo', { labels: ['team::alpha'], lastMessageAt: 30 }))
    saveSession(makeSession(tempDir, 'second', 'todo', { labels: ['team::beta', 'priority'], lastMessageAt: 20 }))
    saveSession(makeSession(tempDir, 'third', 'todo', { labels: ['other'], lastMessageAt: 10 }))

    const page = listSessionMetadataPage(tempDir, {
      filter: {
        archived: false,
        labelIncludeGroups: [['team']],
        labelExclude: ['priority'],
      },
      sortBy: 'recent',
      offset: 0,
      limit: 5,
    })

    expect(page.total).toBe(1)
    expect(page.rows.map(row => row.id)).toEqual(['first'])
  })

  it('loads metadata by ids and exposes minimal count rows', () => {
    saveSession(makeSession(tempDir, 'visible', 'done', { labels: ['parent'], hasUnread: true }))
    saveSession(makeSession(tempDir, 'hidden', 'done', { hidden: true }))

    expect(listSessionMetadataByIds(tempDir, ['visible', 'hidden']).map(row => row.id)).toEqual(['visible'])

    const countRows = listSessionCountRows(tempDir)
    expect(countRows).toHaveLength(1)
    expect(countRows[0]).toMatchObject({
      id: 'visible',
      sessionStatus: 'done',
      labels: ['parent'],
      hasUnread: true,
    })
  })

  it('counts and clears unread active sessions without loading session histories', () => {
    saveSession(makeSession(tempDir, 'unread', 'todo', { hasUnread: true }))
    saveSession(makeSession(tempDir, 'processing-unread', 'todo', { hasUnread: true }))
    saveSession(makeSession(tempDir, 'archived-unread', 'todo', { hasUnread: true, isArchived: true }))
    saveSession(makeSession(tempDir, 'batch-unread', 'todo', { hasUnread: true, isBatch: true }))

    expect(countUnreadSessions(tempDir)).toBe(2)
    markWorkspaceSessionsRead(tempDir, { excludeSessionIds: ['processing-unread'] })
    expect(countUnreadSessions(tempDir)).toBe(1)

    const archived = listSessionMetadataByIds(tempDir, ['archived-unread'])[0]
    expect(archived?.hasUnread).toBe(true)
    const unread = listSessionMetadataByIds(tempDir, ['unread'])[0]
    expect(unread?.hasUnread).toBe(false)
    const processing = listSessionMetadataByIds(tempDir, ['processing-unread'])[0]
    expect(processing?.hasUnread).toBe(true)
  })
})
