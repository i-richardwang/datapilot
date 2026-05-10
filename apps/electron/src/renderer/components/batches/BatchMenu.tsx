/**
 * BatchMenu - Menu content for batch actions
 *
 * Shows Start/Pause/Resume actions based on batch status,
 * plus Labels (mirrors session menu), Duplicate and Delete.
 * Uses MenuComponents context for dropdown/context menu rendering.
 */

import * as React from 'react'
import { Play, Pause, RotateCcw, Copy, Trash2, FlaskConical, Tag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useMenuComponents } from '@/components/ui/menu-context'
import { LabelMenuItems } from '@/components/app-shell/SessionMenuParts'
import { extractLabelId } from '@craft-agent/shared/labels'
import type { BatchStatus } from '@craft-agent/shared/batches'
import type { LabelConfig } from '@craft-agent/shared/labels'

export interface BatchMenuProps {
  batchId: string
  status?: BatchStatus
  /** Workspace label tree (for the Labels submenu). Omit to hide the section. */
  labels?: LabelConfig[]
  /** Currently applied labels on this batch (bare IDs or "id::value" entries). */
  batchLabels?: string[]
  /** Called when a label is toggled — receives the updated full labels array. */
  onLabelsChange?: (labels: string[]) => void
  onStart?: () => void
  onPause?: () => void
  onResume?: () => void
  onTest?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
}

export function BatchMenu({
  batchId: _batchId,
  status = 'pending',
  labels,
  batchLabels,
  onLabelsChange,
  onStart,
  onPause,
  onResume,
  onTest,
  onDuplicate,
  onDelete,
}: BatchMenuProps) {
  const { t } = useTranslation()
  const { MenuItem, Separator, Sub, SubTrigger, SubContent } = useMenuComponents()

  const appliedLabelIds = React.useMemo(() => {
    return new Set((batchLabels ?? []).map(extractLabelId))
  }, [batchLabels])

  const handleLabelToggle = React.useCallback((labelId: string) => {
    if (!onLabelsChange) return
    const current = batchLabels ?? []
    const isApplied = appliedLabelIds.has(labelId)
    const next = isApplied
      ? current.filter(entry => extractLabelId(entry) !== labelId)
      : [...current, labelId]
    onLabelsChange(next)
  }, [batchLabels, appliedLabelIds, onLabelsChange])

  const showLabelsSubmenu = !!labels && labels.length > 0 && !!onLabelsChange

  return (
    <>
      {/* Start - only available when pending (not yet run) */}
      {status === 'pending' && onStart && (
        <MenuItem onClick={onStart}>
          <Play className="h-3.5 w-3.5" />
          <span className="flex-1">{t('batches.menuStart')}</span>
        </MenuItem>
      )}

      {/* Pause - available when running */}
      {status === 'running' && onPause && (
        <MenuItem onClick={onPause}>
          <Pause className="h-3.5 w-3.5" />
          <span className="flex-1">{t('batches.menuPause')}</span>
        </MenuItem>
      )}

      {/* Resume - available when paused */}
      {status === 'paused' && onResume && (
        <MenuItem onClick={onResume}>
          <RotateCcw className="h-3.5 w-3.5" />
          <span className="flex-1">{t('batches.menuResume')}</span>
        </MenuItem>
      )}

      {/* Test - available in all states except running */}
      {status !== 'running' && onTest && (
        <MenuItem onClick={onTest}>
          <FlaskConical className="h-3.5 w-3.5" />
          <span className="flex-1">{t('batches.menuTest')}</span>
        </MenuItem>
      )}

      {/* Labels submenu — hierarchical workspace label tree, shared with sessions */}
      {showLabelsSubmenu && (
        <Sub>
          <SubTrigger className="pr-2">
            <Tag className="h-3.5 w-3.5" />
            <span className="flex-1">{t('batches.menuLabels')}</span>
            {appliedLabelIds.size > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums -mr-2.5">
                {appliedLabelIds.size}
              </span>
            )}
          </SubTrigger>
          <SubContent>
            <LabelMenuItems
              labels={labels!}
              appliedLabelIds={appliedLabelIds}
              onToggle={handleLabelToggle}
              menu={{ MenuItem, Separator, Sub, SubTrigger, SubContent }}
            />
          </SubContent>
        </Sub>
      )}

      {/* Duplicate */}
      {onDuplicate && (
        <MenuItem onClick={onDuplicate}>
          <Copy className="h-3.5 w-3.5" />
          <span className="flex-1">{t('batches.menuDuplicate')}</span>
        </MenuItem>
      )}

      <Separator />

      {/* Delete */}
      {onDelete && (
        <MenuItem onClick={onDelete} variant="destructive">
          <Trash2 className="h-3.5 w-3.5" />
          <span className="flex-1">{t('batches.menuDelete')}</span>
        </MenuItem>
      )}
    </>
  )
}
