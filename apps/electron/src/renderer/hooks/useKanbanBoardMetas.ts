/**
 * Server-backed metadata source for the Kanban board.
 *
 * The session list is server-driven and windowed: `sessionMetaMapAtom` only
 * holds (current window ∪ opened sessions), so deriving board tiles from it
 * silently drops cards beyond the loaded page in large workspaces. This hook
 * fetches the board's own population — the most recent non-archived,
 * non-batch sessions (hidden are excluded server-side) — through the same
 * list RPC and keeps it in board-local state, mirroring the search-metas
 * hydration pattern (useSessionSearch) instead of widening the global window.
 *
 * The board merges these rows UNDER the live window map (window entries win:
 * they receive streaming/event patches), and `patchBoardMeta` mirrors the
 * board's optimistic drag/status writes for tiles beyond the window, where
 * `updateSessionMetaAtom` is a no-op.
 *
 * The fetch is capped at the server's page clamp: boards beyond that show the
 * most recent slice (logged, not silent). The project filter deliberately
 * stays client-side — quick-add subtasks may carry no projectId, and their
 * parent tile still needs them for run state.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { extractSessionMeta, type SessionMeta } from '@/atoms/sessions'

/** Server-side page clamp (SessionManager.listSessionsPage caps limit at 1000). */
export const KANBAN_BOARD_FETCH_LIMIT = 1000

/**
 * Session events that can change board membership, placement, or badges.
 * Superset of the session list's reconcile set: kanban column moves from other
 * windows/devices arrive as `session_metadata_changed` patches.
 */
const BOARD_RELOAD_TYPES = new Set([
  'complete', 'error', 'interrupted', 'typed_error', 'session_status_changed',
  'session_flagged', 'session_unflagged', 'name_changed', 'labels_changed',
  'title_generated', 'session_created', 'session_deleted',
  'session_metadata_changed',
])

const RELOAD_DEBOUNCE_MS = 1000

export function useKanbanBoardMetas(workspaceId: string | null | undefined): {
  boardMetas: ReadonlyMap<string, SessionMeta>
  patchBoardMeta: (sessionId: string, patch: Partial<SessionMeta>) => void
} {
  const [boardMetas, setBoardMetas] = useState<ReadonlyMap<string, SessionMeta>>(() => new Map())
  const reqIdRef = useRef(0)

  const refetch = useCallback(async (ws: string) => {
    const reqId = ++reqIdRef.current
    try {
      const page = await window.electronAPI.listSessionsPage(ws, {
        filter: { archived: false, batch: false },
        sortBy: 'recent',
        offset: 0,
        limit: KANBAN_BOARD_FETCH_LIMIT,
      })
      if (reqId !== reqIdRef.current) return // superseded by a newer fetch
      const next = new Map<string, SessionMeta>()
      for (const row of page.rows) next.set(row.id, extractSessionMeta(row))
      setBoardMetas(next)
      if (page.total > page.rows.length) {
        console.warn(`[kanban] board capped at the ${page.rows.length} most recent of ${page.total} sessions`)
      }
    } catch (err) {
      if (reqId === reqIdRef.current) console.error('[kanban] board meta fetch failed', err)
    }
  }, [])

  // Initial fetch + workspace switch.
  useEffect(() => {
    if (!workspaceId) {
      setBoardMetas(new Map())
      return
    }
    void refetch(workspaceId)
  }, [workspaceId, refetch])

  // Live reconcile: debounced refetch on events that can change the board.
  // Same shape as the session list's window reconcile in AppShell.
  useEffect(() => {
    if (!workspaceId) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = window.electronAPI.onSessionEvent((event: { type: string }) => {
      if (!BOARD_RELOAD_TYPES.has(event.type)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void refetch(workspaceId)
      }, RELOAD_DEBOUNCE_MS)
    })
    return () => {
      if (timer) clearTimeout(timer)
      cleanup?.()
    }
  }, [workspaceId, refetch])

  const patchBoardMeta = useCallback((sessionId: string, patch: Partial<SessionMeta>) => {
    setBoardMetas(prev => {
      const existing = prev.get(sessionId)
      if (!existing) return prev
      const next = new Map(prev)
      next.set(sessionId, { ...existing, ...patch })
      return next
    })
  }, [])

  return { boardMetas, patchBoardMeta }
}
