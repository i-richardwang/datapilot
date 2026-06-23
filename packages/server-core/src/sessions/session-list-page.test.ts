import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { autoRegisterDriver, closeWorkspaceDb } from '@craft-agent/shared/db'
import { saveViews } from '@craft-agent/shared/views/storage'
import { SessionManager, createManagedSession } from './SessionManager.ts'

type Managed = ReturnType<typeof createManagedSession>
type SessionManagerInternals = { sessions: Map<string, Managed> }
type WorkspaceArg = Parameters<typeof createManagedSession>[1]

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
  return workspace(rootPath, id)
}

function seed(sm: SessionManager, id: string, overrides: Partial<Managed> = {}, ws = workspace()) {
  const managed = createManagedSession({
    id,
    name: id,
    createdAt: overrides.createdAt ?? Date.now(),
    lastMessageAt: overrides.lastMessageAt ?? Date.now(),
    ...overrides,
  }, ws)
  ;(sm as unknown as SessionManagerInternals).sessions.set(id, managed)
  return managed
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
    seed(sm, 'hidden', { hidden: true })
    seed(sm, 'archived', { isArchived: true, lastMessageAt: 40 })
    seed(sm, 'batch', { isBatch: true, batchId: 'b1', lastMessageAt: 30 })
    seed(sm, 'todo-parent', { sessionStatus: 'todo', labels: ['parent'], lastMessageAt: 20 })
    seed(sm, 'done-child-other', { sessionStatus: 'done', labels: ['child', 'other'], lastMessageAt: 10 })

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
    for (let i = 0; i < 1005; i++) {
      seed(sm, `s${i}`, { lastMessageAt: i })
    }

    const page = sm.listSessionsPage('ws_test', {
      offset: 0,
      limit: 5000,
    })

    expect(page.total).toBe(1005)
    expect(page.rows).toHaveLength(1000)
    expect(page.rows[0]?.id).toBe('s1004')
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
