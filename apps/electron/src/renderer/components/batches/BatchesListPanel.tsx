/**
 * BatchesListPanel
 *
 * Navigator panel for displaying batches in the 2nd column.
 * Follows the AutomationsListPanel pattern with avatar, title, status badge.
 * Title and filter button are handled by the shared PanelHeader in AppShell.
 */

import * as React from 'react'
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers } from 'lucide-react'
import { isToday, isYesterday, format, startOfDay } from 'date-fns'
import { EntityList, type EntityListGroup } from '@/components/ui/entity-list'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { EntityRow } from '@/components/ui/entity-row'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { SessionSearchHeader } from '@/components/app-shell/SessionSearchHeader'
import { getDateLocale } from '@craft-agent/shared/i18n'
import { BatchAvatar } from './BatchAvatar'
import { BatchMenu } from './BatchMenu'
import { cn } from '@/lib/utils'
import {
  BATCH_STATUS_DISPLAY_KEY,
  BATCH_STATUS_COLOR,
  BATCH_STATUS_ORDER,
  type BatchFilterKind,
  type BatchGroupingMode,
} from './types'
import type { BatchListItem } from './types'
import type { BatchProgress, BatchStatus } from '@craft-agent/shared/batches'
import type { FilterMode } from '@/hooks/useSessionSearch'

/** Tiny inline badge for batch status */
function MicroBadge({ children, colorClass }: { children: React.ReactNode; colorClass: string }) {
  return (
    <span className={cn('shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded', colorClass)}>
      {children}
    </span>
  )
}

// ============================================================================
// Batch Item
// ============================================================================

interface BatchItemProps {
  batch: BatchListItem
  isSelected: boolean
  isFirst: boolean
  isTesting?: boolean
  onClick: () => void
  onStart?: () => void
  onPause?: () => void
  onResume?: () => void
  onTest?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
}

function BatchItem({
  batch,
  isSelected,
  isFirst,
  isTesting,
  onClick,
  onStart,
  onPause,
  onResume,
  onTest,
  onDuplicate,
  onDelete,
}: BatchItemProps) {
  const { t } = useTranslation()
  const status: BatchStatus = batch.progress?.status ?? 'pending'
  const statusColors = BATCH_STATUS_COLOR[status]
  const progressText = batch.progress
    ? `${batch.progress.completedItems + batch.progress.failedItems}/${batch.progress.totalItems}`
    : undefined

  return (
    <EntityRow
      className="batch-item"
      showSeparator={!isFirst}
      separatorClassName="pl-10 pr-4"
      isSelected={isSelected}
      onMouseDown={onClick}
      icon={<BatchAvatar status={status} size="sm" />}
      title={batch.name}
      badges={
        <>
          <MicroBadge colorClass={`${statusColors.bg} ${statusColors.text}`}>
            {t(BATCH_STATUS_DISPLAY_KEY[status])}
          </MicroBadge>
          {isTesting && (
            <MicroBadge colorClass="bg-info/10 text-info">
              {t('batches.badgeTesting')}
            </MicroBadge>
          )}
        </>
      }
      trailing={
        progressText ? (
          <span className="shrink-0 text-[11px] text-foreground/40 whitespace-nowrap">
            {progressText}
          </span>
        ) : undefined
      }
      menuContent={
        <BatchMenu
          batchId={batch.id ?? ''}
          status={status}
          onStart={onStart}
          onPause={onPause}
          onResume={onResume}
          onTest={onTest}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      }
    />
  )
}

// ============================================================================
// Filtering / sorting / grouping
// ============================================================================

/**
 * Apply tri-state status filter (matches session pattern in useSessionSearch).
 * Empty filter map → no filtering.
 * If any 'include' entries exist, item must match one. Any 'exclude' match disqualifies.
 */
function batchMatchesStatusFilter(
  status: BatchStatus,
  filter: Map<BatchStatus, FilterMode>,
): boolean {
  if (filter.size === 0) return true
  let hasInclude = false
  let included = false
  for (const [statusId, mode] of filter) {
    if (mode === 'exclude' && statusId === status) return false
    if (mode === 'include') {
      hasInclude = true
      if (statusId === status) included = true
    }
  }
  return hasInclude ? included : true
}

function formatBatchDateGroupLabel(date: Date, t: (key: string) => string, lang: string): string {
  if (isToday(date)) return t('common.today')
  if (isYesterday(date)) return t('common.yesterday')
  return format(date, 'MMM d', { locale: getDateLocale(lang) })
}

/**
 * Build EntityListGroup<BatchListItem>[] from a sorted list, by either date or status.
 * Both modes preserve the input array order within each group.
 */
function groupBatches(
  batches: BatchListItem[],
  mode: BatchGroupingMode,
  t: (key: string) => string,
  lang: string,
): EntityListGroup<BatchListItem>[] {
  if (mode === 'status') {
    const byStatus = new Map<BatchStatus, BatchListItem[]>()
    for (const b of batches) {
      const status = b.progress?.status ?? 'pending'
      if (!byStatus.has(status)) byStatus.set(status, [])
      byStatus.get(status)!.push(b)
    }
    return BATCH_STATUS_ORDER
      .filter(s => byStatus.has(s))
      .map<EntityListGroup<BatchListItem>>(status => ({
        key: `status:${status}`,
        label: t(BATCH_STATUS_DISPLAY_KEY[status]),
        items: byStatus.get(status)!,
      }))
  }

  // Date grouping. Batches without createdAt drop into a single 'earlier' bucket pinned to the bottom.
  const byDay = new Map<string, { date: Date; items: BatchListItem[] }>()
  const earlier: BatchListItem[] = []
  for (const b of batches) {
    if (typeof b.createdAt !== 'number' || b.createdAt <= 0) {
      earlier.push(b)
      continue
    }
    const day = startOfDay(new Date(b.createdAt))
    const key = day.toISOString()
    if (!byDay.has(key)) byDay.set(key, { date: day, items: [] })
    byDay.get(key)!.items.push(b)
  }
  const dateGroups = Array.from(byDay.values())
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .map<EntityListGroup<BatchListItem>>(g => ({
      key: g.date.toISOString(),
      label: formatBatchDateGroupLabel(g.date, t, lang),
      items: g.items,
    }))
  if (earlier.length > 0) {
    dateGroups.push({
      key: 'earlier',
      label: t('batches.groupEarlier'),
      items: earlier,
    })
  }
  return dateGroups
}

// ============================================================================
// BatchesListPanel
// ============================================================================

export interface BatchesListPanelProps {
  batches: BatchListItem[]
  /** Legacy single-status seed from sidebar route — applied as 'include' when statusFilter is empty. */
  batchFilter?: { kind: BatchFilterKind } | null
  /** Tri-state status filter (Map<status, FilterMode>). Owned by AppShell, mirrors session pattern. */
  statusFilter?: Map<BatchStatus, FilterMode>
  /** Grouping mode for the list. Default: 'date'. */
  groupingMode?: BatchGroupingMode
  onBatchClick: (batchId: string) => void
  onStartBatch?: (batchId: string) => void
  onPauseBatch?: (batchId: string) => void
  onResumeBatch?: (batchId: string) => void
  onTestBatch?: (batchId: string) => void
  onDuplicateBatch?: (batchId: string) => void
  onDeleteBatch?: (batchId: string) => void
  selectedBatchId?: string | null
  workspaceRootPath?: string
  testProgress?: Record<string, BatchProgress>
  className?: string
}

export function BatchesListPanel({
  batches,
  batchFilter,
  statusFilter,
  groupingMode = 'date',
  onBatchClick,
  onStartBatch,
  onPauseBatch,
  onResumeBatch,
  onTestBatch,
  onDuplicateBatch,
  onDeleteBatch,
  selectedBatchId,
  workspaceRootPath,
  testProgress,
  className,
}: BatchesListPanelProps) {
  const { t, i18n } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchActive, setSearchActive] = useState(false)

  const isSearchMode = searchActive && searchQuery.length >= 2

  // Resolve the effective filter Map. If caller passed an explicit Map, use it.
  // Otherwise fall back to the legacy `batchFilter.kind` seed (sidebar-driven, single status).
  const effectiveStatusFilter = useMemo<Map<BatchStatus, FilterMode>>(() => {
    if (statusFilter && statusFilter.size > 0) return statusFilter
    const seedKind = batchFilter?.kind
    if (!seedKind || seedKind === 'all') return new Map()
    return new Map<BatchStatus, FilterMode>([[seedKind as BatchStatus, 'include']])
  }, [statusFilter, batchFilter?.kind])

  // Sort + filter — pure derivation, no side effects.
  const visibleBatches = useMemo(() => {
    const filtered = batches.filter(b => {
      const status = b.progress?.status ?? 'pending'
      return batchMatchesStatusFilter(status, effectiveStatusFilter)
    })
    const searched = isSearchMode
      ? filtered.filter(b => b.name.toLowerCase().includes(searchQuery.toLowerCase()))
      : filtered
    return [...searched].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }, [batches, effectiveStatusFilter, isSearchMode, searchQuery])

  // Search active → render flat (no grouping makes sense over a search result).
  const groups = useMemo(() => {
    if (isSearchMode) return undefined
    return groupBatches(visibleBatches, groupingMode, t, i18n.resolvedLanguage ?? 'en')
  }, [visibleBatches, groupingMode, isSearchMode, t, i18n.resolvedLanguage])

  // Empty state for the entire workspace (no batches at all)
  if (batches.length === 0) {
    return (
      <div className={cn('flex flex-col flex-1 min-h-0', className)}>
        <EntityListEmptyScreen
          icon={<Layers />}
          title={t('batches.emptyTitle')}
          description={t('batches.emptyDescription')}
          docKey="batches"
        >
          {workspaceRootPath && (
            <EditPopover
              align="center"
              trigger={
                <button className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-lg bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors">
                  {t('batches.addBatch')}
                </button>
              }
              {...getEditConfig('batch-config', workspaceRootPath)}
            />
          )}
        </EntityListEmptyScreen>
      </div>
    )
  }

  const header = searchActive ? (
    <SessionSearchHeader
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onSearchClose={() => {
        setSearchActive(false)
        setSearchQuery('')
      }}
      placeholder={t('batches.searchPlaceholder')}
      resultCount={isSearchMode ? visibleBatches.length : undefined}
    />
  ) : undefined

  // Filtered-empty state inside the panel (have batches overall, but none match current filter/search)
  if (visibleBatches.length === 0) {
    return (
      <div className={cn('flex flex-col flex-1 min-h-0', className)}>
        {header}
        <div className="flex-1 flex flex-col items-center justify-center gap-1">
          <p className="text-sm text-muted-foreground">
            {isSearchMode ? t('batches.noBatchesFound') : t('batches.noBatchesMatchFilter')}
          </p>
          {isSearchMode && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-xs text-foreground hover:underline"
            >
              {t('batches.clearSearch')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <EntityList
      className={className}
      header={header}
      items={isSearchMode ? visibleBatches : undefined}
      groups={groups}
      getKey={(b) => b.id ?? b.name}
      renderItem={(batch, indexInGroup) => (
        <BatchItem
          batch={batch}
          isSelected={selectedBatchId === batch.id}
          isFirst={indexInGroup === 0}
          isTesting={!!(batch.id && testProgress?.[batch.id])}
          onClick={() => onBatchClick(batch.id ?? '')}
          onStart={onStartBatch ? () => onStartBatch(batch.id ?? '') : undefined}
          onPause={onPauseBatch ? () => onPauseBatch(batch.id ?? '') : undefined}
          onResume={onResumeBatch ? () => onResumeBatch(batch.id ?? '') : undefined}
          onTest={onTestBatch ? () => onTestBatch(batch.id ?? '') : undefined}
          onDuplicate={onDuplicateBatch ? () => onDuplicateBatch(batch.id ?? '') : undefined}
          onDelete={onDeleteBatch ? () => onDeleteBatch(batch.id ?? '') : undefined}
        />
      )}
    />
  )
}
