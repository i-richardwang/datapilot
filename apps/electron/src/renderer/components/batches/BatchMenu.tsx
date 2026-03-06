/**
 * BatchMenu - Menu content for batch actions
 *
 * Shows Start/Pause/Resume actions based on batch status,
 * plus Duplicate and Delete management actions.
 * Uses MenuComponents context for dropdown/context menu rendering.
 */

import { Play, Pause, RotateCcw, Copy, Trash2 } from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'
import type { BatchStatus } from '@craft-agent/shared/batches'

export interface BatchMenuProps {
  batchId: string
  status?: BatchStatus
  onStart?: () => void
  onPause?: () => void
  onResume?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
}

export function BatchMenu({
  batchId,
  status = 'pending',
  onStart,
  onPause,
  onResume,
  onDuplicate,
  onDelete,
}: BatchMenuProps) {
  const { MenuItem, Separator } = useMenuComponents()

  return (
    <>
      {/* Start - only available when pending (not yet run) */}
      {status === 'pending' && onStart && (
        <MenuItem onClick={onStart}>
          <Play className="h-3.5 w-3.5" />
          <span className="flex-1">Start</span>
        </MenuItem>
      )}

      {/* Pause - available when running */}
      {status === 'running' && onPause && (
        <MenuItem onClick={onPause}>
          <Pause className="h-3.5 w-3.5" />
          <span className="flex-1">Pause</span>
        </MenuItem>
      )}

      {/* Resume - available when paused */}
      {status === 'paused' && onResume && (
        <MenuItem onClick={onResume}>
          <RotateCcw className="h-3.5 w-3.5" />
          <span className="flex-1">Resume</span>
        </MenuItem>
      )}

      {/* Duplicate */}
      {onDuplicate && (
        <MenuItem onClick={onDuplicate}>
          <Copy className="h-3.5 w-3.5" />
          <span className="flex-1">Duplicate</span>
        </MenuItem>
      )}

      <Separator />

      {/* Delete */}
      {onDelete && (
        <MenuItem onClick={onDelete} variant="destructive">
          <Trash2 className="h-3.5 w-3.5" />
          <span className="flex-1">Delete</span>
        </MenuItem>
      )}
    </>
  )
}
