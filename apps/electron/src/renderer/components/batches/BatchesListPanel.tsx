/**
 * BatchesListPanel
 *
 * Navigator panel for displaying batches in the 2nd column.
 * Follows the AutomationsListPanel pattern with avatar, title, status badge.
 * Title and Plus button are handled by the shared PanelHeader in AppShell.
 */

import * as React from 'react'
import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { EntityRow } from '@/components/ui/entity-row'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { SessionSearchHeader } from '@/components/app-shell/SessionSearchHeader'
import { BatchAvatar } from './BatchAvatar'
import { BatchMenu } from './BatchMenu'
import { cn } from '@/lib/utils'
import { BATCH_STATUS_DISPLAY_KEY, BATCH_STATUS_COLOR, type BatchFilterKind } from './types'
import type { BatchListItem } from './types'
import type { BatchProgress, BatchStatus } from '@craft-agent/shared/batches'

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
// BatchesListPanel
// ============================================================================

export interface BatchesListPanelProps {
  batches: BatchListItem[]
  batchFilter?: { kind: BatchFilterKind } | null
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
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchActive, setSearchActive] = useState(false)

  const isSearchMode = searchActive && searchQuery.length >= 2

  // Filter by status
  const statusFiltered = React.useMemo(() => {
    const kind = batchFilter?.kind ?? 'all'
    if (kind === 'all') return batches
    return batches.filter(b => {
      const status = b.progress?.status ?? 'pending'
      return status === kind
    })
  }, [batches, batchFilter?.kind])

  // Filter by search query
  const searchFiltered = React.useMemo(() => {
    if (!isSearchMode) return statusFiltered
    const q = searchQuery.toLowerCase()
    return statusFiltered.filter(b => b.name.toLowerCase().includes(q))
  }, [statusFiltered, isSearchMode, searchQuery])

  const filteredBatches = searchFiltered

  // Empty state
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

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      {/* Search header */}
      {searchActive && (
        <SessionSearchHeader
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearchClose={() => {
            setSearchActive(false)
            setSearchQuery('')
          }}
          placeholder={t('batches.searchPlaceholder')}
          resultCount={isSearchMode ? filteredBatches.length : undefined}
        />
      )}

      {/* Filtered empty state */}
      {filteredBatches.length === 0 ? (
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
      ) : (
        <ScrollArea className="flex-1">
          <div className="pb-2">
            <div className="pt-1">
              {filteredBatches.map((batch, index) => (
                <BatchItem
                  key={batch.id ?? index}
                  batch={batch}
                  isSelected={selectedBatchId === batch.id}
                  isFirst={index === 0}
                  isTesting={!!(batch.id && testProgress?.[batch.id])}
                  onClick={() => onBatchClick(batch.id ?? '')}
                  onStart={onStartBatch ? () => onStartBatch(batch.id ?? '') : undefined}
                  onPause={onPauseBatch ? () => onPauseBatch(batch.id ?? '') : undefined}
                  onResume={onResumeBatch ? () => onResumeBatch(batch.id ?? '') : undefined}
                  onTest={onTestBatch ? () => onTestBatch(batch.id ?? '') : undefined}
                  onDuplicate={onDuplicateBatch ? () => onDuplicateBatch(batch.id ?? '') : undefined}
                  onDelete={onDeleteBatch ? () => onDeleteBatch(batch.id ?? '') : undefined}
                />
              ))}
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
