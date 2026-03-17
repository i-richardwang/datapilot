/**
 * BatchInfoPage
 *
 * Detail view for a selected batch, using the Info_Page compound component system.
 * Follows AutomationInfoPage pattern: Hero → Sections (Source, Action, Execution, Progress, Items, JSON).
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
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
import { BATCH_STATUS_DISPLAY, BATCH_STATUS_BADGE_COLOR, getPermissionDisplayName } from './types'
import { TEST_BATCH_SUFFIX } from '@craft-agent/shared/batches/constants'
import type { BatchListItem } from './types'
import type { BatchState, BatchStatus, BatchProgress, TestBatchResult } from '@craft-agent/shared/batches'

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
  getBatchState?: (batchId: string) => Promise<BatchState | null>
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
  getBatchState,
  testProgress,
  testResult,
  className,
}: BatchInfoPageProps) {
  const workspace = useActiveWorkspace()
  const [batchState, setBatchState] = useState<BatchState | null>(null)
  const status: BatchStatus = batch.progress?.status ?? 'pending'

  const editActions = status === 'pending' && workspace?.rootPath ? (
    <EditPopover
      trigger={<EditButton />}
      {...getEditConfig('batch-config', workspace.rootPath)}
      secondaryAction={{ label: 'Edit File', filePath: `${workspace.rootPath}/batches.json` }}
    />
  ) : undefined

  // Load full batch state (with items) on mount and when progress changes
  useEffect(() => {
    if (!getBatchState || !batch.id) return
    let stale = false
    getBatchState(batch.id).then(state => {
      if (!stale) setBatchState(state)
    })
    return () => { stale = true }
  }, [getBatchState, batch.id, batch.progress])

  const itemCount = batchState ? Object.keys(batchState.items).length : 0

  // Load test state (with items) when a test is running or has completed
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
            tagline={`${BATCH_STATUS_DISPLAY[status]} batch — ${batch.source.type.toUpperCase()} source`}
          />
          {editActions}
        </div>

        {/* Section: Source */}
        <Info_Section title="Source" description="Where to read items from" actions={editActions}>
          <Info_Table>
            <Info_Table.Row label="Format">
              <Info_Badge color="default">{batch.source.type.toUpperCase()}</Info_Badge>
            </Info_Table.Row>
            <Info_Table.Row label="Path">
              <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
                {batch.source.path}
              </code>
            </Info_Table.Row>
            <Info_Table.Row label="ID Field">
              <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
                {batch.source.idField}
              </code>
            </Info_Table.Row>
          </Info_Table>
        </Info_Section>

        {/* Section: Action */}
        <Info_Section title="Action" description="Prompt sent for each item" actions={editActions}>
          <BatchActionRow prompt={batch.action.prompt} />
        </Info_Section>

        {/* Section: Execution */}
        <Info_Section title="Execution" description="How items are processed" actions={editActions}>
          <Info_Table>
            <Info_Table.Row label="Concurrency" value={String(batch.execution?.maxConcurrency ?? 3)} />
            <Info_Table.Row label="Retry">
              <Info_Badge color={batch.execution?.retryOnFailure ? 'success' : 'muted'}>
                {batch.execution?.retryOnFailure ? 'Enabled' : 'Disabled'}
              </Info_Badge>
            </Info_Table.Row>
            {batch.execution?.retryOnFailure && (
              <Info_Table.Row label="Max Retries" value={String(batch.execution?.maxRetries ?? 2)} />
            )}
            <Info_Table.Row label="Access Level" value={getPermissionDisplayName(batch.execution?.permissionMode)} />
            {batch.workingDirectory && (
              <Info_Table.Row label="Working Directory">
                <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
                  {batch.workingDirectory}
                </code>
              </Info_Table.Row>
            )}
            {batch.execution?.model && (
              <Info_Table.Row label="Model" value={batch.execution.model} />
            )}
            {batch.execution?.llmConnection && (
              <Info_Table.Row label="LLM Connection" value={batch.execution.llmConnection} />
            )}
            {batch.action.labels && batch.action.labels.length > 0 && (
              <Info_Table.Row label="Labels">
                <div className="flex gap-1.5 flex-wrap">
                  {batch.action.labels.map(label => (
                    <Info_Badge key={label} color="muted">{label}</Info_Badge>
                  ))}
                </div>
              </Info_Table.Row>
            )}
            {batch.action.mentions && batch.action.mentions.length > 0 && (
              <Info_Table.Row label="Mentions">
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
          <Info_Section title="Output" description="Structured result collection" actions={editActions}>
            <Info_Table>
              <Info_Table.Row label="Path">
                <code className="text-xs font-mono bg-foreground/5 px-1.5 py-0.5 rounded">
                  {batch.output.path}
                </code>
              </Info_Table.Row>
              <Info_Table.Row label="Schema">
                <Info_Badge color={batch.output.schema ? 'success' : 'muted'}>
                  {batch.output.schema ? 'Defined' : 'Freeform'}
                </Info_Badge>
              </Info_Table.Row>
              {batch.output.schema?.properties && Object.keys(batch.output.schema.properties).length > 0 && (
                <Info_Table.Row label="Fields">
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
            title="Test Run"
            description={`${testDisplayProgress.completedItems + testDisplayProgress.failedItems} of ${testDisplayProgress.totalItems} items processed`}
          >
            <Info_Table>
              <Info_Table.Row label="Status">
                <Info_Badge color={BATCH_STATUS_BADGE_COLOR[testStatus]}>
                  {BATCH_STATUS_DISPLAY[testStatus]}
                </Info_Badge>
              </Info_Table.Row>
              <Info_Table.Row label="Total" value={`${testDisplayProgress.totalItems} items`} />
              <Info_Table.Row label="Completed">
                <Info_Badge color="success">{testDisplayProgress.completedItems}</Info_Badge>
              </Info_Table.Row>
              <Info_Table.Row label="Failed">
                <Info_Badge color="destructive">{testDisplayProgress.failedItems}</Info_Badge>
              </Info_Table.Row>
              <Info_Table.Row label="Running">
                <Info_Badge color="warning">{testDisplayProgress.runningItems}</Info_Badge>
              </Info_Table.Row>
              <Info_Table.Row label="Pending">
                <Info_Badge color="muted">{testDisplayProgress.pendingItems}</Info_Badge>
              </Info_Table.Row>
            </Info_Table>
          </Info_Section>
        )}

        {/* Section: Test Items (only when test data exists) */}
        {(isTestRunning || hasTestResult) && (
          <Info_Section
            title="Test Items"
            description={testItemCount > 0 ? `${testItemCount} items sampled` : undefined}
          >
            <BatchItemTimeline items={testState?.items ?? {}} />
          </Info_Section>
        )}

        {/* Section: Progress */}
        {batch.progress && (
          <Info_Section
            title="Progress"
            description={`${batch.progress.completedItems + batch.progress.failedItems} of ${batch.progress.totalItems} items processed`}
          >
            <Info_Table>
              <Info_Table.Row label="Status">
                <Info_Badge color={BATCH_STATUS_BADGE_COLOR[status]}>
                  {BATCH_STATUS_DISPLAY[status]}
                </Info_Badge>
              </Info_Table.Row>
              <Info_Table.Row label="Total" value={`${batch.progress.totalItems} items`} />
              <Info_Table.Row label="Completed">
                <Info_Badge color="success">{batch.progress.completedItems}</Info_Badge>
              </Info_Table.Row>
              <Info_Table.Row label="Failed">
                <Info_Badge color="destructive">{batch.progress.failedItems}</Info_Badge>
              </Info_Table.Row>
              <Info_Table.Row label="Running">
                <Info_Badge color="warning">{batch.progress.runningItems}</Info_Badge>
              </Info_Table.Row>
              <Info_Table.Row label="Pending">
                <Info_Badge color="muted">{batch.progress.pendingItems}</Info_Badge>
              </Info_Table.Row>
            </Info_Table>
          </Info_Section>
        )}

        {/* Section: Items */}
        <Info_Section
          title="Items"
          description={itemCount > 0 ? `${itemCount} items in this batch` : undefined}
        >
          <BatchItemTimeline items={batchState?.items ?? {}} />
        </Info_Section>

        {/* Section: Raw config (JSON) */}
        <Info_Section title="Raw config">
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
