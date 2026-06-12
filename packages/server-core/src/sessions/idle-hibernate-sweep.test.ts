import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession } from './SessionManager.ts'

// The idle hibernation sweep reclaims interactive sessions left loaded after
// completion (batch/automation sessions hibernate eagerly on completion).
// These tests drive the private sweep directly: seed warm sessions with a
// stale activity clock and assert heavy state is released — or kept when a
// safety gate applies.

const THIRTY_ONE_MINUTES_AGO = Date.now() - 31 * 60_000

type AnySm = {
  sessions: Map<string, ReturnType<typeof createManagedSession>>
  sweepIdleSessions(): void
  isIdleHibernationSafe(managed: unknown): boolean
}

describe('idle hibernation sweep', () => {
  let tmpRoot: string
  let sm: SessionManager
  let smAny: AnySm

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-idle-sweep-'))
    sm = new SessionManager()
    smAny = sm as unknown as AnySm
  })

  afterEach(() => {
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

  // A warm interactive session: messages in memory, fake agent attached,
  // idle past the threshold unless overridden.
  function seedWarmSession(
    sessionId: string,
    overrides: Partial<Record<string, unknown>> = {},
  ) {
    const managed = createManagedSession({ id: sessionId }, buildWorkspace())
    managed.messages = [{ id: 'm1' } as never]
    managed.messagesLoaded = true
    managed.lastMessageAt = THIRTY_ONE_MINUTES_AGO
    managed.lastActivityAt = THIRTY_ONE_MINUTES_AGO
    managed.agent = { dispose: () => {} } as never
    Object.assign(managed, overrides)
    smAny.sessions.set(sessionId, managed)
    return managed
  }

  async function runSweep() {
    smAny.sweepIdleSessions()
    // hibernateSession is async (persistence flush) — let it settle.
    await new Promise(resolve => setTimeout(resolve, 25))
  }

  it('hibernates an idle interactive session', async () => {
    const managed = seedWarmSession('s_idle')

    await runSweep()

    expect(managed.agent).toBeNull()
    expect(managed.messages).toEqual([])
    expect(managed.messagesLoaded).toBe(false)
    // Metadata stays in the Map for UI visibility.
    expect(smAny.sessions.has('s_idle')).toBe(true)
  })

  it('skips sessions with recent activity even if lastMessageAt is stale', async () => {
    // Simulates a long turn: the message was sent 31min ago but the turn
    // finished just now (onProcessingStopped stamps lastActivityAt).
    const managed = seedWarmSession('s_recent', { lastActivityAt: Date.now() })

    await runSweep()

    expect(managed.agent).not.toBeNull()
    expect(managed.messagesLoaded).toBe(true)
  })

  it('skips the session the user is actively viewing', async () => {
    const managed = seedWarmSession('s_viewed')
    sm.setActiveViewingSession('s_viewed', 'ws_test')
    // Viewing stamps lastActivityAt — re-age it so only the viewing gate holds.
    managed.lastActivityAt = THIRTY_ONE_MINUTES_AGO

    await runSweep()

    expect(managed.agent).not.toBeNull()
  })

  it('skips sessions with live background shells', async () => {
    const managed = seedWarmSession('s_shell')
    managed.backgroundShellCommands.set('shell_1', 'npm run dev')

    await runSweep()

    expect(managed.agent).not.toBeNull()
  })

  it('skips sessions with a pending source-activation auto-retry', async () => {
    const managed = seedWarmSession('s_retry', {
      autoRetryPending: { content: 'retry me', deadlineMs: Date.now() + 60_000, committed: false },
    })

    await runSweep()

    expect(managed.agent).not.toBeNull()
  })

  it('skips processing sessions (isHibernationSafe gate)', async () => {
    const managed = seedWarmSession('s_processing', { isProcessing: true })

    await runSweep()

    expect(managed.agent).not.toBeNull()
    expect(managed.messagesLoaded).toBe(true)
  })

  it('sweeps idle batch sessions whose completion-time hibernate was blocked', async () => {
    // A batch session left warm means its eager hibernate hit a safety gate at
    // completion; the gate has since cleared and nothing else retries — the
    // sweep must pick it up.
    const managed = seedWarmSession('s_batch', { isBatch: true })

    await runSweep()

    expect(managed.agent).toBeNull()
    expect(managed.messagesLoaded).toBe(false)
  })

  it('ignores already-cold sessions', async () => {
    const managed = seedWarmSession('s_cold', { agent: null, messagesLoaded: false })
    managed.messages = []

    await runSweep()

    expect(managed.messagesLoaded).toBe(false)
    expect(smAny.sessions.has('s_cold')).toBe(true)
  })
})
