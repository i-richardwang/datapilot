/**
 * BatchInfoPage
 *
 * Detail view for a selected batch, using the Info_Page compound component system.
 * Follows AutomationInfoPage pattern: Hero → Sections (Source, Execution, Prompt, Progress, Items, JSON).
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
import { Play, Pause, RotateCcw, ExternalLink, PauseCircle } from 'lucide-react'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Alert,
  Info_Badge,
  Info_Markdown,
} from '@/components/info'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { BatchAvatar } from './BatchAvatar'
import { BatchMenu } from './BatchMenu'
import { BatchProgressBar } from './BatchProgressBar'
import { BATCH_STATUS_DISPLAY, BATCH_STATUS_COLOR } from './types'
import { cn } from '@/lib/utils'
import type { BatchListItem } from './types'
import type { BatchState, BatchStatus, BatchItemState } from '@craft-agent/shared/batches'

// ============================================================================
// Component
// ============================================================================

export interface BatchInfoPageProps {
  batch: BatchListItem
  onStart?: () => void
  onPause?: () => void
  onResume?: () => void
  onToggleEnabled?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
  getBatchState?: (batchId: string) => Promise<BatchState | null>
  onNavigateToSession?: (sessionId: string) => void
  className?: string
}

export function BatchInfoPage({
  batch,
  onStart,
  onPause,
  onResume,
  onToggleEnabled,
  onDuplicate,
  onDelete,
  getBatchState,
  onNavigateToSession,
  className,
}: BatchInfoPageProps) {
  const workspace = useActiveWorkspace()
  const [batchState, setBatchState] = useState<BatchState | null>(null)
  const status: BatchStatus = batch.progress?.status ?? 'pending'
  const enabled = batch.enabled !== false

  const editActions = workspace?.rootPath ? (
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

  return (
    <Info_Page className={className}>
      <Info_Page.Header
        title={batch.name}
        titleMenu={
          <BatchMenu
            batchId={batch.id ?? ''}
            status={status}
            enabled={enabled}
            onStart={onStart}
            onPause={onPause}
            onResume={onResume}
            onToggleEnabled={onToggleEnabled}
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

        {/* Disabled warning */}
        {!enabled && (
          <Info_Alert variant="warning" icon={<PauseCircle className="h-4 w-4" />}>
            <Info_Alert.Title>Disabled</Info_Alert.Title>
            <Info_Alert.Description>
              This batch is disabled. Enable it from the menu to allow execution.
            </Info_Alert.Description>
          </Info_Alert>
        )}

        {/* Section: Data Source */}
        <Info_Section title="Data Source" actions={editActions}>
          <Info_Table>
            <Info_Table.Row label="Type" value={batch.source.type.toUpperCase()} />
            <Info_Table.Row label="Path" value={batch.source.path} />
            <Info_Table.Row label="ID Field" value={batch.source.idField} />
          </Info_Table>
        </Info_Section>

        {/* Section: Execution */}
        <Info_Section title="Execution" actions={editActions}>
          <Info_Table>
            <Info_Table.Row label="Max Concurrency" value={String(batch.execution?.maxConcurrency ?? 3)} />
            <Info_Table.Row label="Retry on Failure" value={batch.execution?.retryOnFailure ? 'Yes' : 'No'} />
            <Info_Table.Row label="Max Retries" value={String(batch.execution?.maxRetries ?? 2)} />
            <Info_Table.Row label="Permission Mode" value={batch.execution?.permissionMode ?? 'safe'} />
            {batch.execution?.model && (
              <Info_Table.Row label="Model" value={batch.execution.model} />
            )}
            {batch.execution?.llmConnection && (
              <Info_Table.Row label="LLM Connection" value={batch.execution.llmConnection} />
            )}
          </Info_Table>
        </Info_Section>

        {/* Section: Prompt Template */}
        <Info_Section title="Prompt Template" actions={editActions}>
          <Info_Markdown>{`\`\`\`\n${batch.action.prompt}\n\`\`\``}</Info_Markdown>
          {batch.action.labels && batch.action.labels.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-2">
              {batch.action.labels.map(label => (
                <Info_Badge key={label}>{label}</Info_Badge>
              ))}
            </div>
          )}
          {batch.action.mentions && batch.action.mentions.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-2">
              {batch.action.mentions.map(mention => (
                <Info_Badge key={mention} color="muted">@{mention}</Info_Badge>
              ))}
            </div>
          )}
        </Info_Section>

        {/* Section: Progress */}
        {batch.progress && (
          <Info_Section title="Progress">
            <BatchProgressBar progress={batch.progress} />

            {/* Status counts */}
            <div className="flex gap-4 mt-3 text-xs">
              <span className="text-success">
                {batch.progress.completedItems} completed
              </span>
              <span className="text-destructive">
                {batch.progress.failedItems} failed
              </span>
              <span className="text-info">
                {batch.progress.runningItems} running
              </span>
              <span className="text-muted-foreground">
                {batch.progress.pendingItems} pending
              </span>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 mt-3">
              {(status === 'pending' || status === 'completed' || status === 'failed') && onStart && (
                <button
                  onClick={onStart}
                  className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
                >
                  <Play className="h-3 w-3" />
                  Start
                </button>
              )}
              {status === 'running' && onPause && (
                <button
                  onClick={onPause}
                  className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
                >
                  <Pause className="h-3 w-3" />
                  Pause
                </button>
              )}
              {status === 'paused' && onResume && (
                <button
                  onClick={onResume}
                  className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
                >
                  <RotateCcw className="h-3 w-3" />
                  Resume
                </button>
              )}
            </div>
          </Info_Section>
        )}

        {/* Section: Items */}
        {batchState && Object.keys(batchState.items).length > 0 && (
          <Info_Section
            title="Items"
            description={`${Object.keys(batchState.items).length} items in this batch`}
          >
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-foreground/[0.02] border-b border-border">
                    <th className="text-left font-medium px-3 py-2 text-muted-foreground">Item ID</th>
                    <th className="text-left font-medium px-3 py-2 text-muted-foreground">Status</th>
                    <th className="text-left font-medium px-3 py-2 text-muted-foreground">Session</th>
                    <th className="text-left font-medium px-3 py-2 text-muted-foreground">Retries</th>
                    <th className="text-left font-medium px-3 py-2 text-muted-foreground">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(batchState.items).map(([itemId, item]: [string, BatchItemState]) => {
                    const itemStatusColors = BATCH_STATUS_COLOR[item.status as BatchStatus] ?? BATCH_STATUS_COLOR.pending
                    return (
                      <tr key={itemId} className="border-b border-border/50 last:border-b-0">
                        <td className="px-3 py-1.5 font-mono text-foreground/80 max-w-[120px] truncate">
                          {itemId}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={cn(
                            'inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded',
                            itemStatusColors.bg,
                            itemStatusColors.text,
                          )}>
                            {item.status}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          {item.sessionId ? (
                            <button
                              onClick={() => onNavigateToSession?.(item.sessionId!)}
                              className="text-accent hover:underline inline-flex items-center gap-0.5"
                            >
                              <span className="truncate max-w-[100px]">{item.sessionId.slice(0, 8)}</span>
                              <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                            </button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {item.retryCount > 0 ? item.retryCount : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-destructive max-w-[200px] truncate">
                          {item.error ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Info_Section>
        )}

        {/* Section: Raw config (JSON) */}
        <Info_Section title="Raw config">
          <div className="rounded-[8px] shadow-minimal overflow-hidden [&_pre]:!bg-transparent [&_.relative]:!bg-transparent [&_.relative]:!border-0 [&_.relative>div:first-child]:!bg-transparent [&_.relative>div:first-child]:!border-0">
            <Info_Markdown maxHeight={300} fullscreen>
              {`\`\`\`json\n${JSON.stringify(batch, null, 2)}\n\`\`\``}
            </Info_Markdown>
          </div>
        </Info_Section>
      </Info_Page.Content>
    </Info_Page>
  )
}
