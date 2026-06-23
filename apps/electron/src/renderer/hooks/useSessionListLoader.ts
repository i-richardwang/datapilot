/**
 * Owns server-side fetching of the session list WINDOW (the O(page) core).
 *
 * - loadWindow: fetch page 0 for a (filter, sort) request + sidebar counts and
 *   replace the window. Stale responses (a newer request started) are dropped
 *   via a monotonic request id, so rapid filter switching never clobbers.
 * - loadMore: fetch the next page at the given offset and append it.
 *
 * Dynamic views also go through this path: the renderer sends a view id and the
 * server evaluates the workspace's saved view expressions while paginating.
 */
import { useCallback, useRef } from 'react'
import { useSetAtom } from 'jotai'
import {
  setSessionWindowAtom,
  appendSessionWindowAtom,
  sidebarCountsAtom,
  sessionListLoadingAtom,
} from '@/atoms/sessions'
import type { SessionListPageFilter, SessionListPageOptions } from '@craft-agent/shared/protocol'

export const SESSION_PAGE_SIZE = 50
const SESSION_RELOAD_PAGE_SIZE = 1000

export interface SessionListRequest {
  filter?: SessionListPageFilter
  sortBy?: SessionListPageOptions['sortBy']
}

export function useSessionListLoader() {
  const setWindow = useSetAtom(setSessionWindowAtom)
  const appendWindow = useSetAtom(appendSessionWindowAtom)
  const setCounts = useSetAtom(sidebarCountsAtom)
  const setLoading = useSetAtom(sessionListLoadingAtom)
  const reqIdRef = useRef(0)
  const loadingMoreRef = useRef(false)

  /**
   * Replace the window with a fresh page-0 fetch for `request`. `limit` can be
   * raised for reconcile (re-fetch the already-loaded depth). Returns true if
   * this response was applied (false if superseded or failed).
   */
  const loadWindow = useCallback(async (
    workspaceId: string,
    request: SessionListRequest,
    opts?: { limit?: number; withCounts?: boolean },
  ): Promise<boolean> => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    try {
      const limit = opts?.limit ?? SESSION_PAGE_SIZE
      const [page, counts] = await Promise.all([
        window.electronAPI.listSessionsPage(workspaceId, {
          filter: request.filter,
          sortBy: request.sortBy,
          offset: 0,
          limit,
        }),
        (opts?.withCounts ?? true)
          ? window.electronAPI.getSidebarCounts(workspaceId)
          : Promise.resolve(null),
      ])
      if (reqId !== reqIdRef.current) return false // superseded by a newer request
      setWindow({ rows: page.rows, total: page.total })
      if (counts) setCounts(counts)
      return true
    } catch (err) {
      if (reqId === reqIdRef.current) console.error('[sessionList] loadWindow failed', err)
      return false
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [setWindow, setCounts, setLoading])

  /** Append the next page at `currentCount` offset. No-op if a window reload superseded it. */
  const loadMore = useCallback(async (
    workspaceId: string,
    request: SessionListRequest,
    currentCount: number,
  ): Promise<void> => {
    if (loadingMoreRef.current) return
    loadingMoreRef.current = true
    const reqId = reqIdRef.current
    try {
      const page = await window.electronAPI.listSessionsPage(workspaceId, {
        filter: request.filter,
        sortBy: request.sortBy,
        offset: currentCount,
        limit: SESSION_PAGE_SIZE,
      })
      if (reqId !== reqIdRef.current) return // a window reload happened mid-fetch
      appendWindow({ rows: page.rows, total: page.total })
    } catch (err) {
      console.error('[sessionList] loadMore failed', err)
    } finally {
      loadingMoreRef.current = false
    }
  }, [appendWindow])

  /**
   * Reconcile-friendly reload of the FULL currently-loaded depth (not just page
   * 0), so a membership/order/badge change never truncates a scrolled-open
   * window back to one page. Fetches ceil(depth/RELOAD_PAGE) pages — usually one
   * request for normal scrolling depth — plus counts, then replaces the window in
   * one write. Stale responses drop via the monotonic request id.
   */
  const reloadWindow = useCallback(async (
    workspaceId: string,
    request: SessionListRequest,
    depth: number,
  ): Promise<boolean> => {
    const reqId = ++reqIdRef.current
    setLoading(true)
    try {
      const pages = Math.max(1, Math.ceil(depth / SESSION_RELOAD_PAGE_SIZE))
      const [counts, ...pageResults] = await Promise.all([
        window.electronAPI.getSidebarCounts(workspaceId),
        ...Array.from({ length: pages }, (_, i) =>
          window.electronAPI.listSessionsPage(workspaceId, {
            filter: request.filter,
            sortBy: request.sortBy,
            offset: i * SESSION_RELOAD_PAGE_SIZE,
            limit: Math.min(SESSION_RELOAD_PAGE_SIZE, Math.max(depth - i * SESSION_RELOAD_PAGE_SIZE, 1)),
          }),
        ),
      ])
      if (reqId !== reqIdRef.current) return false // superseded by a newer request
      const seen = new Set<string>()
      const rows = pageResults.flatMap(p => p.rows).filter(r => {
        if (seen.has(r.id)) return false
        seen.add(r.id)
        return true
      })
      const total = pageResults[0]?.total ?? rows.length
      setWindow({ rows, total })
      if (counts) setCounts(counts)
      return true
    } catch (err) {
      if (reqId === reqIdRef.current) console.error('[sessionList] reloadWindow failed', err)
      return false
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [setWindow, setCounts, setLoading])

  return { loadWindow, loadMore, reloadWindow }
}
