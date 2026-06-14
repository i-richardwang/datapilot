/**
 * BatchInfoPage
 *
 * Detail view for a selected batch, using the Info_Page compound component system.
 * Follows AutomationInfoPage pattern: Hero → Sections (Source, Action, Execution, Progress, Items, JSON).
 *
 * Items are loaded via paginated getBatchItems RPC (50 per page) to avoid
 * serializing thousands of items over IPC. Auto-positions to the execution
 * frontier (first running item) on initial load.
 */

import * as React from 'react'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Badge,
  Info_Markdown,
} from '@/components/info'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { BatchAvatar } from './BatchAvatar'
import { BatchMenu } from './BatchMenu'
import { BatchItemTimeline } from './BatchItemTimeline'
import { BATCH_STATUS_DISPLAY_KEY, BATCH_STATUS_BADGE_COLOR, getPermissionModeKey } from './types'
import type { BatchListItem } from './types'
import type { BatchStatus, BatchItemStatus, BatchItemsPage } from '@craft-agent/shared/batches'

// ============================================================================
// Constants
// ============================================================================

const PAGE_SIZE = 50

// ============================================================================
// Component
// ============================================================================

export interface BatchInfoPageProps {
  batch: BatchListItem
  onStart?: () => void
  onPause?: () => void
  onResume?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
  onRetryItem?: (itemId: string) => void
  onRetryFailed?: (batchId: string) => void
  getBatchItems?: (batchId: string, offset: number, limit: number, filterStatus?: BatchItemStatus) => Promise<BatchItemsPage | null>
  className?: string
}

export function BatchInfoPage({
  batch,
  onStart,
  onPause,
  onResume,
  onDuplicate,
  onDelete,
  onRetryItem,
  onRetryFailed,
  getBatchItems,
  className,
}: BatchInfoPageProps) {
  const { t } = useTranslation()
  const workspace = useActiveWorkspace()
  const status: BatchStatus = batch.progress?.status ?? 'pending'

  const editActions = status === 'pending' && workspace?.rootPath ? (
    <EditPopover
      trigger={<EditButton />}
      {...getEditConfig('batch-config', workspace.rootPath)}
      secondaryAction={{ label: t('common.editFile'), filePath: `${workspace.rootPath}/batches.json` }}
    />
  ) : undefined

  // ---------------------------------------------------------------------------
  // Paginated items loading (replaces full-state fetch)
  // ---------------------------------------------------------------------------

  const [itemsPage, setItemsPage] = useState<BatchItemsPage | null>(null)
  const [pageOffset, setPageOffset] = useState(0)
  const [filterStatus, setFilterStatus] = useState<BatchItemStatus | undefined>(undefined)
  const hasAutoPositioned = useRef(false)

  // Fetch current page of items
  useEffect(() => {
    if (!getBatchItems || !batch.id) return
    let stale = false
    getBatchItems(batch.id, pageOffset, PAGE_SIZE, filterStatus).then(page => {
      if (!stale) setItemsPage(page)
    })
    return () => { stale = true }
  }, [getBatchItems, batch.id, pageOffset, filterStatus, batch.progress])

  // Auto-position to execution frontier on first load — skip when filtering,
  // since frontier navigation is not meaningful under a status filter.
  useEffect(() => {
    if (hasAutoPositioned.current || !itemsPage || filterStatus) return
    hasAutoPositioned.current = true
    if (itemsPage.runningOffset >= 0) {
      const frontierPage = Math.floor(itemsPage.runningOffset / PAGE_SIZE) * PAGE_SIZE
      if (frontierPage !== pageOffset) {
        setPageOffset(frontierPage)
      }
    }
  }, [itemsPage]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset when switching batches
  useEffect(() => {
    hasAutoPositioned.current = false
    setPageOffset(0)
    setFilterStatus(undefined)
    setItemsPage(null)
  }, [batch.id])

  // Reset to first page when toggling filter
  const toggleFailedFilter = () => {
    setFilterStatus(prev => (prev === 'failed' ? undefined : 'failed'))
    setPageOffset(0)
  }

  const itemCount = itemsPage?.total ?? batch.progress?.totalItems ?? 0

  // itemsPage.items is already in display order (mirrors batch_items.position).
  // Pass it straight through — do NOT round-trip via a Record, which would
  // re-sort integer-like ids ("10".."28") ahead of zero-padded ("01".."09").
  const pageItems = itemsPage?.items ?? []

  // ---------------------------------------------------------------------------
  // Pagination helpers
  // ---------------------------------------------------------------------------

  const totalPages = itemsPage ? Math.ceil(itemsPage.total / PAGE_SIZE) : 0
  const currentPage = Math.floor(pageOffset / PAGE_SIZE) + 1
  const frontierPage = itemsPage && itemsPage.runningOffset >= 0
    ? Math.floor(itemsPage.runningOffset / PAGE_SIZE) * PAGE_SIZE
    : -1
  const isOnFrontierPage = frontierPage >= 0 && frontierPage === pageOffset

  return (
    <Info_Page className={className}>
      <Info_Page.Header
        title={batch.name}
        titleMenu={
          <BatchMenu
            batchId={batch.id ?? ''}
            status={status}
            onStart={onStart}
            onPause={onPause}
            onResume={onResume}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        }
      />

      <Info_Page.Content>
        {/* Hero */}
        <div className="flex items-start justify-between">
          <Info_Page.Hero
            avatar={<BatchAvatar status={status} fluid />}
            title={batch.name}
            tagline={t('batches.heroTagline', {
              status: t(BATCH_STATUS_DISPLAY_KEY[status]),
              sourceType: batch.source.type.toUpperCase(),
            })}
          />
          {editActions}
        </div>

        {/* Section: Source */}
        <Info_Section title={t('batches.sectionSource')} description={t('batches.sectionSourceDesc')} actions={editActions}>
          <Info_Table>
            <Info_Table.Row label={t('batches.labelFormat')}>
              <Info_Badge color="default">{batch.source.type.toUpperCase()}</Info_Badge>
            </Info_Table.Row>
            <Info_Table.Row label={t('batches.labelPath')}>
              <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
                {batch.source.path}
              </code>
            </Info_Table.Row>
            <Info_Table.Row label={t('batches.labelIdField')}>
              <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
                {batch.source.idField}
              </code>
            </Info_Table.Row>
          </Info_Table>
        </Info_Section>

        {/* Section: Action */}
        <Info_Section title={t('batches.sectionAction')} description={t('batches.sectionActionDesc')} actions={editActions}>
          <Info_Markdown maxHeight={540} fullscreen>
            {batch.action.prompt || t('automations.emptyPrompt')}
          </Info_Markdown>
        </Info_Section>

        {/* Section: Execution */}
        <Info_Section title={t('batches.sectionExecution')} description={t('batches.sectionExecutionDesc')} actions={editActions}>
          <Info_Table>
            <Info_Table.Row label={t('batches.labelConcurrency')} value={String(batch.execution?.maxConcurrency ?? 3)} />
            <Info_Table.Row label={t('batches.labelRetry')}>
              <Info_Badge color={batch.execution?.retryOnFailure ? 'success' : 'muted'}>
                {batch.execution?.retryOnFailure ? t('batches.enabled') : t('batches.disabled')}
              </Info_Badge>
            </Info_Table.Row>
            {batch.execution?.retryOnFailure && (
              <Info_Table.Row label={t('batches.labelMaxRetries')} value={String(batch.execution?.maxRetries ?? 2)} />
            )}
            <Info_Table.Row label={t('batches.labelAccessLevel')} value={t(getPermissionModeKey(batch.execution?.permissionMode))} />
            {batch.workingDirectory && (
              <Info_Table.Row label={t('batches.labelWorkingDirectory')}>
                <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
                  {batch.workingDirectory}
                </code>
              </Info_Table.Row>
            )}
            {batch.execution?.toolProfile && batch.execution.toolProfile !== 'default' && (
              <Info_Table.Row label={t('batches.labelToolProfile')}>
                <Info_Badge color="default">{batch.execution.toolProfile}</Info_Badge>
              </Info_Table.Row>
            )}
            {batch.execution?.model && (
              <Info_Table.Row label={t('batches.labelModel')} value={batch.execution.model} />
            )}
            {batch.execution?.llmConnection && (
              <Info_Table.Row label={t('batches.labelLlmConnection')} value={batch.execution.llmConnection} />
            )}
            {batch.action.labels && batch.action.labels.length > 0 && (
              <Info_Table.Row label={t('batches.labelLabels')}>
                <div className="flex gap-1.5 flex-wrap">
                  {batch.action.labels.map(label => (
                    <Info_Badge key={label} color="muted">{label}</Info_Badge>
                  ))}
                </div>
              </Info_Table.Row>
            )}
            {batch.action.mentions && batch.action.mentions.length > 0 && (
              <Info_Table.Row label={t('batches.labelMentions')}>
                <div className="flex gap-1.5 flex-wrap">
                  {batch.action.mentions.map(mention => (
                    <Info_Badge key={mention} color="default">@{mention}</Info_Badge>
                  ))}
                </div>
              </Info_Table.Row>
            )}
          </Info_Table>
        </Info_Section>

        {/* Section: Output (only when configured) */}
        {batch.output && (
          <Info_Section title={t('batches.sectionOutput')} description={t('batches.sectionOutputDesc')} actions={editActions}>
            <Info_Table>
              <Info_Table.Row label={t('batches.labelPath')}>
                <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
                  {batch.output.path}
                </code>
              </Info_Table.Row>
              <Info_Table.Row label={t('batches.labelSchema')}>
                <Info_Badge color={batch.output.schema ? 'success' : 'muted'}>
                  {batch.output.schema ? t('batches.schemaDefined') : t('batches.schemaFreeform')}
                </Info_Badge>
              </Info_Table.Row>
              {batch.output.schema?.properties && Object.keys(batch.output.schema.properties).length > 0 && (
                <Info_Table.Row label={t('batches.labelFields')}>
                  <div className="flex gap-1.5 flex-wrap">
                    {Object.entries(batch.output.schema.properties).map(([key, _prop]) => {
                      const isRequired = batch.output?.schema?.required?.includes(key)
                      return (
                        <Info_Badge key={key} color={isRequired ? 'default' : 'muted'}>
                          {key}{isRequired ? '*' : ''}
                        </Info_Badge>
                      )
                    })}
                  </div>
                </Info_Table.Row>
              )}
            </Info_Table>
          </Info_Section>
        )}

        {/* Section: Progress */}
        {batch.progress && (
          <Info_Section
            title={t('batches.sectionProgress')}
            description={t('batches.itemsProcessed', {
              done: batch.progress.completedItems + batch.progress.failedItems + (batch.progress.skippedItems ?? 0),
              total: batch.progress.totalItems,
            })}
          >
            <Info_Table>
              <Info_Table.Row label={t('batches.labelStatus')}>
                <Info_Badge color={BATCH_STATUS_BADGE_COLOR[status]}>
                  {t(BATCH_STATUS_DISPLAY_KEY[status])}
                </Info_Badge>
              </Info_Table.Row>
              <Info_Table.Row label={t('batches.labelTotal')} value={t('batches.totalItems', { count: batch.progress.totalItems })} />
              <Info_Table.Row label={t('batches.statusCompleted')}>
                <Info_Badge color="success">{batch.progress.completedItems}</Info_Badge>
              </Info_Table.Row>
              <Info_Table.Row label={t('batches.statusFailed')}>
                <div className="flex items-center gap-3">
                  <Info_Badge color="destructive">{batch.progress.failedItems}</Info_Badge>
                  {batch.progress.failedItems > 0 && (
                    <button
                      type="button"
                      onClick={toggleFailedFilter}
                      className="text-xs text-accent hover:underline cursor-pointer"
                    >
                      {filterStatus === 'failed' ? t('batches.filterShowAll') : t('batches.filterFailedOnly')}
                    </button>
                  )}
                  {batch.progress.failedItems > 0 && onRetryFailed && batch.id && (
                    <button
                      type="button"
                      onClick={() => onRetryFailed(batch.id!)}
                      className="text-xs text-accent hover:underline cursor-pointer"
                    >
                      {t('batches.retryAllFailed')}
                    </button>
                  )}
                </div>
              </Info_Table.Row>
              {(batch.progress.skippedItems ?? 0) > 0 && (
                <Info_Table.Row label={t('batches.statusSkipped')}>
                  <Info_Badge color="muted">{batch.progress.skippedItems}</Info_Badge>
                </Info_Table.Row>
              )}
              <Info_Table.Row label={t('batches.statusRunning')}>
                <Info_Badge color="warning">{batch.progress.runningItems}</Info_Badge>
              </Info_Table.Row>
              <Info_Table.Row label={t('batches.statusPending')}>
                <Info_Badge color="muted">{batch.progress.pendingItems}</Info_Badge>
              </Info_Table.Row>
            </Info_Table>
          </Info_Section>
        )}

        {/* Section: Items (paginated) */}
        <Info_Section
          title={t('batches.sectionItems')}
          description={itemCount > 0 ? t('batches.itemsInBatch', { count: itemCount }) : undefined}
        >
          <BatchItemTimeline items={pageItems} batchId={batch.id} onRetryItem={onRetryItem} />
          {itemsPage && itemsPage.total > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground border-t border-border/30">
              <span>
                {t('batches.pageRange', {
                  start: itemsPage.offset + 1,
                  end: Math.min(itemsPage.offset + PAGE_SIZE, itemsPage.total),
                  total: itemsPage.total,
                })}
                {totalPages > 1 && ` · ${t('batches.pageIndicator', { current: currentPage, total: totalPages })}`}
              </span>
              <div className="flex items-center gap-1.5">
                {frontierPage >= 0 && !isOnFrontierPage && (
                  <button
                    onClick={() => setPageOffset(frontierPage)}
                    className="text-accent hover:underline cursor-pointer"
                  >
                    {t('batches.goToActive')}
                  </button>
                )}
                <button
                  onClick={() => setPageOffset(p => Math.max(0, p - PAGE_SIZE))}
                  disabled={pageOffset === 0}
                  className="px-2 py-1 rounded hover:bg-muted disabled:opacity-30 cursor-pointer disabled:cursor-default"
                >
                  {t('batches.prev')}
                </button>
                <button
                  onClick={() => setPageOffset(p => p + PAGE_SIZE)}
                  disabled={pageOffset + PAGE_SIZE >= itemsPage.total}
                  className="px-2 py-1 rounded hover:bg-muted disabled:opacity-30 cursor-pointer disabled:cursor-default"
                >
                  {t('batches.next')}
                </button>
              </div>
            </div>
          )}
        </Info_Section>

        {/* Section: Raw config (JSON) */}
        <Info_Section title={t('batches.sectionRawConfig')}>
          <div className="rounded-lg shadow-minimal overflow-hidden [&_pre]:!bg-transparent [&_.relative]:!bg-transparent [&_.relative]:!border-0 [&_.relative>div:first-child]:!bg-transparent [&_.relative>div:first-child]:!border-0">
            <Info_Markdown maxHeight={300} fullscreen>
              {`\`\`\`json\n${JSON.stringify(batch, null, 2)}\n\`\`\``}
            </Info_Markdown>
          </div>
        </Info_Section>
      </Info_Page.Content>
    </Info_Page>
  )
}
