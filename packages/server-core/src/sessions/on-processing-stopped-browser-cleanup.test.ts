import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { autoRegisterDriver } from '@craft-agent/shared/db'
import { NullBrowserPaneManager } from '../runtime/null-browser-pane-manager.ts'
import { SessionManager, createManagedSession } from './SessionManager.ts'

class FailingCleanupBrowserPaneManager extends NullBrowserPaneManager {
  clearCalls = 0
  unbindCalls = 0

  async clearVisualsForSession(_sessionId: string): Promise<void> {
    this.clearCalls++
    throw new Error('No connected desktop client supports browser tools for this session.')
  }

  unbindAllForSession(_sessionId: string): void {
    this.unbindCalls++
  }
}

describe('SessionManager onProcessingStopped browser cleanup', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeAll(async () => {
    await autoRegisterDriver()
  })

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-browser-cleanup-'))
    sm = new SessionManager()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildSession(id: string) {
    const workspace = {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    }
    const managed = createManagedSession(
      { id, name: 'browser cleanup test', isBatch: true },
      workspace as never,
      { messagesLoaded: true },
    )
    managed.isProcessing = true
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return managed
  }

  it('still notifies batch processors when browser cleanup fails', async () => {
    const sessionId = 'batch-session'
    buildSession(sessionId)

    const bpm = new FailingCleanupBrowserPaneManager()
    sm.setBrowserPaneManager(bpm)

    const completions: Array<{ sessionId: string; reason: string }> = []
    ;(sm as unknown as {
      batchProcessors: Map<string, { onSessionComplete: (sid: string, reason: string) => boolean }>
    }).batchProcessors.set(tmpRoot, {
      onSessionComplete: (sid, reason) => {
        completions.push({ sessionId: sid, reason })
        return true
      },
    })

    await (sm as unknown as {
      onProcessingStopped: (sid: string, reason: 'complete') => Promise<void>
    }).onProcessingStopped(sessionId, 'complete')

    expect(completions).toEqual([{ sessionId, reason: 'complete' }])
    expect(bpm.clearCalls).toBe(2)
    expect(bpm.unbindCalls).toBe(1)
  })
})
