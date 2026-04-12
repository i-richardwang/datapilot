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
import { useState, useEffect, useRef, useMemo } from 'react'
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
import { BatchActionRow } from './BatchActionRow'
import { BatchItemTimeline } from './BatchItemTimeline'
import { BATCH_STATUS_DISPLAY_KEY, BATCH_STATUS_BADGE_COLOR, getPermissionModeKey } from './types'
import { TEST_BATCH_SUFFIX } from '@craft-agent/shared/batches/constants'
import type { BatchListItem } from './types'
import type { BatchState, BatchStatus, BatchProgress, BatchItemState, BatchItemsPage, TestBatchResult } from '@craft-agent/shared/batches'

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
  onTest?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
  onRetryItem?: (itemId: string) => void
  getBatchState?: (batchId: string) => Promise<BatchState | null>
  getBatchItems?: (batchId: string, offset: number, limit: number) => Promise<BatchItemsPage | null>
  testProgress?: BatchProgress
  testResult?: TestBatchResult
  className?: string
}

export function BatchInfoPage({
  batch,
  onStart,
  onPause,
  onResume,
  onTest,
  onDuplicate,
  onDelete,
  onRetryItem,
  getBatchState,
  getBatchItems,
  testProgress,
  testResult,
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
  const hasAutoPositioned = useRef(false)

  // Fetch current page of items
  useEffect(() => {
    if (!getBatchItems || !batch.id) return
    let stale = false
    getBatchItems(batch.id, pageOffset, PAGE_SIZE).then(page => {
      if (!stale) setItemsPage(page)
    })
    return () => { stale = true }
  }, [getBatchItems, batch.id, pageOffset, batch.progress])

  // Auto-position to execution frontier on first load
  useEffect(() => {
    if (hasAutoPositioned.current || !itemsPage) return
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
    setItemsPage(null)
  }, [batch.id])

  const itemCount = itemsPage?.total ?? batch.progress?.totalItems ?? 0

  // Convert page items to Record for BatchItemTimeline
  const pageItemsRecord = useMemo<Record<string, BatchItemState>>(() => {
    if (!itemsPage) return {}
    return Object.fromEntries(itemsPage.items.map(({ id, state }) => [id, state]))
  }, [itemsPage])

  // ---------------------------------------------------------------------------
  // Test state (still uses full getBatchState — test batches are small)
  // ---------------------------------------------------------------------------

  const [testState, setTestState] = useState<BatchState | null>(null)
  const isTestRunning = !!testProgress
  const hasTestResult = !!testResult

  useEffect(() => {
    if (!getBatchState || !batch.id) return
    if (!isTestRunning && !hasTestResult) { setTestState(null); return }
    let stale = false
    getBatchState(`${batch.id}${TEST_BATCH_SUFFIX}`).then(state => {
      if (!stale) setTestState(state)
    })
    return () => { stale = true }
  }, [getBatchState, batch.id, isTestRunning, hasTestResult, testProgress, testResult])

  // Derive test display data from progress (running) or result (completed)
  const testDisplayProgress = testProgress ?? (testResult ? {
    batchId: testResult.batchId,
    status: testResult.status === 'completed' ? 'completed' as const : 'failed' as const,
    totalItems: testResult.sampleSize,
    completedItems: testResult.items.filter(i => i.status === 'completed').length,
    failedItems: testResult.items.filter(i => i.status === 'failed').length,
    runningItems: 0,
    pendingItems: 0,
  } : null)

  const testStatus: BatchStatus | undefined = testDisplayProgress?.status
  const testItemCount = testState ? Object.keys(testState.items).length : 0

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
            onTest={onTest}
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
          <BatchActionRow prompt={batch.action.prompt} />
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

        {/* Section: Test Run (only when test data exists) */}
        {testDisplayProgress && testStatus && (
          <Info_Section
            title={t('batches.sectionTestRun')}
            description={t('batches.itemsProcessed', {
              done: testDisplayProgress.completedItems + testDisplayProgress.failedItems,
              total: testDisplayProgress.totalItems,
            })}
          >
            <Info_Table>
              <Info_Table.Row label={t('batches.labelStatus')}>
                <Info_Badge color={BATCH_STATUS_BADGE_COLOR[testStatus]}>
                  {t(BATCH_STATUS_DISPLAY_KEY[testStatus])}
                </Info_Badge>
              </Info_Table.Row>
              <Info_Table.Row label={t('batches.labelTotal')} value={t('batches.totalItems', { count: testDisplayProgress.totalItems })} />
              <Info_Table.Row label={t('batches.statusCompleted')}>
                <Info_Badge color="success">{testDisplayProgress.completedItems}</Info_Badge>
              </Info_Table.Row>
              <Info_Table.Row label={t('batches.statusFailed')}>
                <Info_Badge color="destructive">{testDisplayProgress.failedItems}</Info_Badge>
              </Info_Table.Row>
              <Info_Table.Row label={t('batches.statusRunning')}>
                <Info_Badge color="warning">{testDisplayProgress.runningItems}</Info_Badge>
              </Info_Table.Row>
              <Info_Table.Row label={t('batches.statusPending')}>
                <Info_Badge color="muted">{testDisplayProgress.pendingItems}</Info_Badge>
              </Info_Table.Row>
            </Info_Table>
          </Info_Section>
        )}

        {/* Section: Test Items (only when test data exists) */}
        {(isTestRunning || hasTestResult) && (
          <Info_Section
            title={t('batches.sectionTestItems')}
            description={testItemCount > 0 ? t('batches.itemsSampled', { count: testItemCount }) : undefined}
          >
            <BatchItemTimeline items={testState?.items ?? {}} />
          </Info_Section>
        )}

        {/* Section: Progress */}
        {batch.progress && (
          <Info_Section
            title={t('batches.sectionProgress')}
            description={t('batches.itemsProcessed', {
              done: batch.progress.completedItems + batch.progress.failedItems,
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
                <Info_Badge color="destructive">{batch.progress.failedItems}</Info_Badge>
              </Info_Table.Row>
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
          <BatchItemTimeline items={pageItemsRecord} onRetryItem={onRetryItem} />
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
