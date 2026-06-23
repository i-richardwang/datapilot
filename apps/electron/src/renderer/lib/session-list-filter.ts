/**
 * Translate the renderer's UI filter state (sidebar nav kind + secondary
 * status/label chips) into the server's generic structured predicate
 * (SessionListPageFilter). The server never learns about UI "kinds" — this is
 * the single place that maps them, so adding/altering a kind only touches here.
 *
 * `view` kind is translated to a server-side view id. The server owns loading
 * and compiling the workspace's saved view expressions, so view routes stay
 * paginated instead of falling back to a full client load.
 */
import type { SessionListPageFilter } from '@craft-agent/shared/protocol'
import type { SessionFilter } from '@/contexts/NavigationContext'
import type { LabelConfig } from '@craft-agent/shared/labels'
import { getDescendantIds } from '@craft-agent/shared/labels'

export type FilterMode = 'include' | 'exclude'

/** Sentinel that matches no session status — used when a status include/exclude combo intersects to empty. */
const STATUS_NONE = '__none__'

/**
 * Build the server predicate for a (sessionFilter, secondary status, secondary
 * label) combination. Mirrors AppShell's `filteredSessionMetas` + the batch
 * visibility rule + the secondary include/exclude layering, exactly.
 */
export function buildSessionListFilter(
  sessionFilter: SessionFilter | null | undefined,
  listFilter: Map<string, FilterMode>,
  labelFilter: Map<string, FilterMode>,
  labelConfigs: LabelConfig[],
): SessionListPageFilter {
  const f: SessionListPageFilter = {}
  const labelGroups: string[][] = []

  const kind = sessionFilter?.kind ?? 'allSessions'
  switch (kind) {
    case 'allSessions':
      f.archived = false
      f.batch = false
      break
    case 'flagged':
      f.flagged = true
      f.archived = false
      f.batch = false
      break
    case 'archived':
      f.archived = true
      f.batch = false
      break
    case 'state':
      f.statusInclude = [(sessionFilter as Extract<SessionFilter, { kind: 'state' }>).stateId]
      f.archived = false
      f.batch = false
      break
    case 'batch':
      // Batch view shows batch sessions (archived included, like the sidebar count).
      f.batch = true
      break
    case 'batchInstance':
      f.batchId = (sessionFilter as Extract<SessionFilter, { kind: 'batchInstance' }>).batchId
      break
    case 'label': {
      // Label views keep batch sub-sessions (taggable bucket).
      f.archived = false
      const labelId = (sessionFilter as Extract<SessionFilter, { kind: 'label' }>).labelId
      if (labelId === '__all__') f.hasLabels = true
      else labelGroups.push([labelId, ...getDescendantIds(labelConfigs, labelId)])
      break
    }
    case 'view': {
      // View expressions are evaluated server-side against active/taggable metas.
      // Match the old client path: non-hidden, non-archived, batch sessions kept.
      f.archived = false
      f.viewId = (sessionFilter as Extract<SessionFilter, { kind: 'view' }>).viewId
      break
    }
    default:
      f.archived = false
      f.batch = false
  }

  // Secondary status chips (include narrows via intersection, exclude removes).
  if (listFilter.size > 0) {
    const inc: string[] = []
    const exc: string[] = []
    for (const [id, mode] of listFilter) (mode === 'include' ? inc : exc).push(id)
    if (inc.length > 0) {
      const next = f.statusInclude ? f.statusInclude.filter(s => inc.includes(s)) : inc
      f.statusInclude = next.length > 0 ? next : [STATUS_NONE]
    }
    if (exc.length > 0) f.statusExclude = exc
  }

  // Secondary label chips with descendant expansion (include = another AND group).
  if (labelFilter.size > 0) {
    const incExpanded: string[] = []
    const excExpanded: string[] = []
    for (const [id, mode] of labelFilter) {
      const ids = [id, ...getDescendantIds(labelConfigs, id)]
      if (mode === 'include') incExpanded.push(...ids)
      else excExpanded.push(...ids)
    }
    if (incExpanded.length > 0) labelGroups.push(incExpanded)
    if (excExpanded.length > 0) f.labelExclude = excExpanded
  }

  if (labelGroups.length > 0) f.labelIncludeGroups = labelGroups
  return f
}

/** Stable string key for a (filter, sortBy) request — drives effect deps. */
export function sessionListRequestKey(
  filter: SessionListPageFilter,
  sortBy: string | undefined,
): string {
  return JSON.stringify({ filter, sortBy: sortBy ?? 'recent' })
}
