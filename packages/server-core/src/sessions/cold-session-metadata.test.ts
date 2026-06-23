import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  loadSessionHeader,
  loadSession,
  saveSession,
  type SessionBundle,
  type StoredSession,
} from '@craft-agent/shared/sessions'
import { autoRegisterDriver, closeWorkspaceDb } from '@craft-agent/shared/db'
import type { StoredMessage } from '@craft-agent/core/types'
import { SessionManager, createManagedSession } from './SessionManager.ts'

// Regression test for the silent-drop bug in persistSession:
//
//   On startup, sessions load with messagesLoaded=false and only get loaded
//   on first getSession(). The old persistSession early-returned in that
//   state to avoid wiping the JSONL with []. As a result, status/label/rename
//   changes on sessions the user hadn't opened since restart were never
//   written to disk and were lost on the next restart.
//
// The fix routes cold-session persists through ensureMessagesLoaded so the
// existing JSONL messages are loaded first, then the full record (with the
// new metadata) is enqueued. flushSession awaits the in-flight load+enqueue
// so durability holds for sync mutate-then-flush callers.

describe('cold-session metadata persistence', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeAll(async () => {
    await autoRegisterDriver()
  })

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-cold-meta-'))
    sm = new SessionManager()
  })

  afterEach(() => {
    closeWorkspaceDb(tmpRoot)
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildWorkspace() {
    return {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    } as never
  }

  // Seed a session JSONL on disk to simulate a session present from a
  // previous app run, then register it in the SessionManager with the
  // post-restart `messagesLoaded: false` state — i.e. metadata only.
  function seedColdSession(
    sessionId: string,
    opts: {
      name?: string
      sessionStatus?: string
      labels?: string[]
      messages?: StoredMessage[]
      registerInManager?: boolean
    } = {},
  ) {
    const stored: StoredSession = {
      id: sessionId,
      workspaceRootPath: tmpRoot,
      name: opts.name ?? 'cold session',
      sessionStatus: opts.sessionStatus ?? 'todo',
      labels: opts.labels ?? [],
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      messages: opts.messages ?? [],
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextTokens: 0,
        costUsd: 0,
      },
    } as StoredSession
    saveSession(stored)

    if (opts.registerInManager === false) return

    const managed = createManagedSession(
      {
        id: sessionId,
        name: stored.name,
        sessionStatus: stored.sessionStatus,
        labels: stored.labels,
        createdAt: stored.createdAt,
      },
      buildWorkspace(),
      // messagesLoaded defaults to false — this is the cold-session state.
    )
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(sessionId, managed)
  }

  function readDiskHeader(sessionId: string): Record<string, unknown> {
    return loadSessionHeader(tmpRoot, sessionId) as unknown as Record<string, unknown>
  }

  function readDiskMessageIds(sessionId: string): string[] {
    return loadSession(tmpRoot, sessionId)?.messages.map(m => m.id) ?? []
  }

  function makeUserMessage(id: string, content: string): StoredMessage {
    return { id, type: 'user', content, timestamp: Date.now() } as StoredMessage
  }

  function makeBundle(sessionId: string): SessionBundle {
    return {
      version: 1,
      session: {
        header: {
          id: sessionId,
          workspaceRootPath: tmpRoot,
          name: sessionId,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          messageCount: 0,
          tokenUsage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            contextTokens: 0,
            costUsd: 0,
          },
        },
        messages: [],
      },
      files: [],
    } as SessionBundle
  }

  it('setSessionStatus on a cold session is on disk after flushSession resolves', async () => {
    const sessionId = 'cold-status'
    seedColdSession(sessionId, { sessionStatus: 'todo' })

    await sm.setSessionStatus(sessionId, 'done')

    const header = readDiskHeader(sessionId)
    expect(header.sessionStatus).toBe('done')

    // Independently re-load from disk via the production loader to confirm
    // round-trip integrity.
    const reloaded = loadSession(tmpRoot, sessionId)
    expect(reloaded?.sessionStatus).toBe('done')
  })

  it('setSessionLabels on a cold session is on disk after flushSession resolves', async () => {
    const sessionId = 'cold-labels'
    seedColdSession(sessionId, { labels: [] })

    await sm.setSessionLabels(sessionId, ['urgent', 'bug'])

    const header = readDiskHeader(sessionId)
    expect(header.labels).toEqual(['urgent', 'bug'])

    const reloaded = loadSession(tmpRoot, sessionId)
    expect(reloaded?.labels).toEqual(['urgent', 'bug'])
  })

  it('renameSession on a cold session persists (with explicit flushSession)', async () => {
    const sessionId = 'cold-rename'
    seedColdSession(sessionId, { name: 'old name' })

    // renameSession does not flush internally; mirror the production order
    // (rename → flushSession). Without the cold-load fix, this assertion fails
    // because persistSession silently dropped the enqueue.
    await sm.renameSession(sessionId, 'new name')
    await sm.flushSession(sessionId)

    const header = readDiskHeader(sessionId)
    expect(header.name).toBe('new name')
  })

  it('cold-session persist preserves existing messages on disk', async () => {
    const sessionId = 'cold-preserve-msgs'
    const seededMessages = [
      makeUserMessage('m1', 'hello'),
      makeUserMessage('m2', 'world'),
      makeUserMessage('m3', 'three'),
    ]
    seedColdSession(sessionId, { messages: seededMessages })

    // Sanity: messages are on disk before mutation.
    expect(readDiskMessageIds(sessionId)).toEqual(['m1', 'm2', 'm3'])

    await sm.setSessionStatus(sessionId, 'done')

    // Header reflects the new status…
    expect(readDiskHeader(sessionId).sessionStatus).toBe('done')
    // …and the seeded messages survive (regression: original guard's intent).
    expect(readDiskMessageIds(sessionId)).toEqual(['m1', 'm2', 'm3'])
  })

  it('concurrent cold-session status changes serialize to last-writer-wins on disk', async () => {
    const sessionId = 'cold-concurrent'
    seedColdSession(sessionId, { sessionStatus: 'todo' })

    // Fire two mutations back-to-back without awaiting the first. Both flow
    // through the cold-persist path; ensureMessagesLoaded dedupes the load,
    // and the persistence queue debounces enqueues. Both calls must resolve
    // and disk must reflect the second value with no JSONL corruption.
    const p1 = sm.setSessionStatus(sessionId, 'in-progress')
    const p2 = sm.setSessionStatus(sessionId, 'done')
    await Promise.all([p1, p2])

    // Disk header has the last value.
    expect(readDiskHeader(sessionId).sessionStatus).toBe('done')

    expect(loadSession(tmpRoot, sessionId)).toBeTruthy()
  })

  it('flushSession on a cold session returns only after the disk write lands', async () => {
    const sessionId = 'cold-flush-ordering'
    seedColdSession(sessionId, { sessionStatus: 'todo' })

    // Mirror the production pattern where a caller mutates and immediately
    // flushes (e.g. setSessionStatus, or any UI flow that quits the app
    // right after a metadata change). The disk must reflect the new value
    // by the time flushSession resolves — no debounce window.
    const managed = (sm as unknown as { sessions: Map<string, { sessionStatus?: string }> })
      .sessions.get(sessionId)!
    managed.sessionStatus = 'cancelled'
    ;(sm as unknown as { persistSession: (m: unknown) => void }).persistSession(managed)
    await sm.flushSession(sessionId)

    expect(readDiskHeader(sessionId).sessionStatus).toBe('cancelled')
  })

  it('exports a persisted session that has not been loaded into memory', async () => {
    seedColdSession('workspace-anchor')
    const sessionId = 'cold-export'
    seedColdSession(sessionId, {
      messages: [makeUserMessage('m1', 'export me')],
      registerInManager: false,
    })
    expect((sm as unknown as { sessions: Map<string, unknown> }).sessions.has(sessionId)).toBe(false)

    const bundle = await sm.exportSession(sessionId, 'ws_test')

    expect(bundle?.session.header.id).toBe(sessionId)
    expect(bundle?.session.messages.map(message => message.id)).toEqual(['m1'])
    expect((sm as unknown as { sessions: Map<string, unknown> }).sessions.has(sessionId)).toBe(true)
  })

  it('rejects move import when the target session id exists only in storage', async () => {
    seedColdSession('workspace-anchor')
    const sessionId = 'existing-cold'
    seedColdSession(sessionId, { registerInManager: false })
    expect((sm as unknown as { sessions: Map<string, unknown> }).sessions.has(sessionId)).toBe(false)

    await expect(sm.importSession('ws_test', makeBundle(sessionId), 'move'))
      .rejects
      .toThrow(`Session ${sessionId} already exists in target workspace`)
  })
})
