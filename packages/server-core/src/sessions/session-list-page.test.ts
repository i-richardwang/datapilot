import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { autoRegisterDriver, closeWorkspaceDb } from '@craft-agent/shared/db'
import { saveViews } from '@craft-agent/shared/views/storage'
import { saveLabelConfig } from '@craft-agent/shared/labels/storage'
import { saveSession, updateSessionMetadata, type StoredSession } from '@craft-agent/shared/sessions'
import { loadStatusConfig } from '@craft-agent/shared/statuses/storage'
import { SessionManager, createManagedSession } from './SessionManager.ts'

type Managed = ReturnType<typeof createManagedSession>
type SessionManagerInternals = {
  sessions: Map<string, Managed>
  automationSystems: Map<string, {
    getSessionMetadata(sessionId: string): { sessionStatus?: string } | undefined
  }>
}
type WorkspaceArg = Parameters<typeof createManagedSession>[1]
type SeedOverrides = Partial<Managed> & Partial<StoredSession>

const tempRoots: string[] = []

beforeAll(async () => {
  await autoRegisterDriver()
})

function workspace(rootPath = '/tmp/session-list-page-test', id = 'ws_test'): WorkspaceArg {
  return {
    id,
    name: 'Test Workspace',
    rootPath,
    createdAt: Date.now(),
  } as WorkspaceArg
}

function tempWorkspace(id = 'ws_test'): WorkspaceArg {
  const rootPath = mkdtempSync(join(tmpdir(), 'session-list-page-test-'))
  tempRoots.push(rootPath)
  loadStatusConfig(rootPath)
  return workspace(rootPath, id)
}

function makeStoredSession(ws: WorkspaceArg, id: string, overrides: SeedOverrides = {}): StoredSession {
  const lastMessageAt = overrides.lastMessageAt ?? Date.now()
  return {
    id,
    workspaceRootPath: ws.rootPath,
    name: id,
    createdAt: overrides.createdAt ?? lastMessageAt,
    lastUsedAt: overrides.lastUsedAt ?? lastMessageAt,
    lastMessageAt,
    isFlagged: overrides.isFlagged,
    sessionStatus: overrides.sessionStatus,
    labels: overrides.labels,
    hidden: overrides.hidden,
    isBatch: overrides.isBatch,
    batchId: overrides.batchId,
    isArchived: overrides.isArchived,
    hasUnread: overrides.hasUnread,
    permissionMode: overrides.permissionMode,
    model: overrides.model,
    llmConnection: overrides.llmConnection,
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

function seed(sm: SessionManager, id: string, overrides: SeedOverrides = {}, ws = tempWorkspace(), loaded = true) {
  saveSession(makeStoredSession(ws, id, overrides))
  const managed = createManagedSession({
    id,
    name: id,
    createdAt: overrides.createdAt ?? Date.now(),
    lastMessageAt: overrides.lastMessageAt ?? Date.now(),
    ...overrides,
  }, ws)
  if (loaded) {
    ;(sm as unknown as SessionManagerInternals).sessions.set(id, managed)
  }
  return managed
}

async function waitForCondition(condition: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  expect(condition()).toBe(true)
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    closeWorkspaceDb(root)
    rmSync(root, { recursive: true, force: true })
  }
})

describe('SessionManager.listSessionsPage', () => {
  it('filters and sorts over managed sessions before materializing page rows', () => {
    const sm = new SessionManager()
    const ws = tempWorkspace()
    seed(sm, 'hidden', { hidden: true }, ws)
    seed(sm, 'archived', { isArchived: true, lastMessageAt: 40 }, ws)
    seed(sm, 'batch', { isBatch: true, batchId: 'b1', lastMessageAt: 30 }, ws)
    seed(sm, 'todo-parent', { sessionStatus: 'todo', labels: ['parent'], lastMessageAt: 20 }, ws)
    seed(sm, 'done-child-other', { sessionStatus: 'done', labels: ['child', 'other'], lastMessageAt: 10 }, ws)

    expect(sm.listSessionsPage('ws_test', {
      filter: { archived: false, batch: false },
      sortBy: 'recent',
    }).rows.map(s => s.id)).toEqual(['todo-parent', 'done-child-other'])

    expect(sm.listSessionsPage('ws_test', {
      filter: { batch: true, batchId: 'b1' },
    }).rows.map(s => s.id)).toEqual(['batch'])

    expect(sm.listSessionsPage('ws_test', {
      filter: {
        archived: false,
        batch: false,
        statusInclude: ['done'],
        labelIncludeGroups: [['child'], ['other']],
      },
    }).rows.map(s => s.id)).toEqual(['done-child-other'])
  })

  it('caps oversized renderer page requests at 1000 rows', () => {
    const sm = new SessionManager()
    const ws = tempWorkspace()
    for (let i = 0; i < 1005; i++) {
      seed(sm, `s${i}`, { lastMessageAt: i }, ws, i === 0)
    }

    const page = sm.listSessionsPage('ws_test', {
      offset: 0,
      limit: 5000,
    })

    expect(page.total).toBe(1005)
    expect(page.rows).toHaveLength(1000)
    expect(page.rows[0]?.id).toBe('s1004')
  })

  it('bounds legacy getSessions to a recent metadata window', () => {
    const sm = new SessionManager()
    const ws = tempWorkspace()
    for (let i = 0; i < 1005; i++) {
      seed(sm, `legacy-${i}`, { lastMessageAt: i }, ws, i === 0)
    }

    const sessions = sm.getSessions('ws_test')

    expect(sessions).toHaveLength(1000)
    expect(sessions[0]?.id).toBe('legacy-1004')
    expect(sessions.at(-1)?.id).toBe('legacy-5')
  })

  it('updates automation metadata for cold session events without hydrating the session', async () => {
    const sm = new SessionManager()
    const ws = tempWorkspace()
    seed(sm, 'cold-auto', { sessionStatus: 'todo' }, ws, false)
    const internals = sm as unknown as SessionManagerInternals

    try {
      sm.setupConfigWatcher(ws.rootPath, ws.id)
      expect(internals.sessions.has('cold-auto')).toBe(false)

      await updateSessionMetadata(ws.rootPath, 'cold-auto', { sessionStatus: 'done' })
      await waitForCondition(() =>
        internals.automationSystems.get(ws.rootPath)
          ?.getSessionMetadata('cold-auto')
          ?.sessionStatus === 'done'
      )

      expect(internals.sessions.has('cold-auto')).toBe(false)
    } finally {
      sm.cleanup()
    }
  })

  it('computes sidebar counts from SQL aggregates with loaded-session overlay', () => {
    const sm = new SessionManager()
    const ws = tempWorkspace()
    saveLabelConfig(ws.rootPath, {
      version: 1,
      labels: [
        {
          id: 'parent',
          name: 'Parent',
          color: 'foreground/50',
          children: [{ id: 'child', name: 'Child', color: 'foreground/50' }],
        },
        { id: 'other', name: 'Other', color: 'foreground/50' },
      ],
    })

    const hot = seed(sm, 'hot', { sessionStatus: 'todo', labels: ['child'], hasUnread: true }, ws)
    hot.sessionStatus = 'done'
    hot.labels = ['other']
    hot.hasUnread = false

    seed(sm, 'batch', { isBatch: true, labels: ['child'] }, ws)
    seed(sm, 'archived', { isArchived: true, labels: ['child'], hasUnread: true }, ws)
    seed(sm, 'flagged', { isFlagged: true }, ws)

    const counts = sm.getSidebarCounts('ws_test')

    expect(counts.total).toBe(4)
    expect(counts.archived).toBe(1)
    expect(counts.batch).toBe(1)
    expect(counts.flagged).toBe(1)
    expect(counts.hasUnread).toBe(false)
    expect(counts.byStatus).toEqual({ done: 1, todo: 1 })
    expect(counts.byLabel).toEqual({ other: 1, child: 1, parent: 1 })
  })

  it('evaluates saved views server-side with target, __all__, missing, and cache invalidation semantics', () => {
    const sm = new SessionManager()
    const ws = tempWorkspace()
    saveViews(ws.rootPath, [
      {
        id: 'needs-review',
        name: 'Needs Review',
        expression: 'isFlagged == true',
      },
      {
        id: 'done',
        name: 'Done',
        expression: 'sessionStatus == "done"',
      },
    ])

    seed(sm, 'plain', { lastMessageAt: 10 }, ws)
    seed(sm, 'flagged', { isFlagged: true, lastMessageAt: 30 }, ws)
    seed(sm, 'done', { sessionStatus: 'done', lastMessageAt: 20 }, ws)

    expect(sm.listSessionsPage('ws_test', {
      filter: { archived: false, viewId: 'needs-review' },
    }).rows.map(s => s.id)).toEqual(['flagged'])

    expect(sm.listSessionsPage('ws_test', {
      filter: { archived: false, viewId: '__all__' },
    }).rows.map(s => s.id)).toEqual(['flagged', 'done'])

    expect(sm.listSessionsPage('ws_test', {
      filter: { archived: false, viewId: 'deleted-view' },
    }).rows).toEqual([])

    saveViews(ws.rootPath, [
      {
        id: 'needs-review',
        name: 'Needs Review',
        expression: 'sessionStatus == "done"',
      },
    ])

    expect(sm.listSessionsPage('ws_test', {
      filter: { archived: false, viewId: 'needs-review' },
    }).rows.map(s => s.id)).toEqual(['done'])
  })
})
