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
import { saveSession, listSessions, getSessionPlansPath } from '../storage.db.ts'
import { loadStatusConfig } from '../../statuses/storage.db.ts'
import type { StoredSession } from '../types.ts'

beforeAll(async () => {
  await autoRegisterDriver()
})

function makeSession(
  workspaceRootPath: string,
  id: string,
  sessionStatus?: string
): StoredSession {
  return {
    id,
    workspaceRootPath,
    createdAt: 1000,
    lastUsedAt: 2000,
    name: `Session ${id}`,
    sessionStatus,
    messages: [],
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
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
})
