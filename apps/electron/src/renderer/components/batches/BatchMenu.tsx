/**
 * BatchMenu - Menu content for batch actions
 *
 * Shows Start/Pause/Resume actions based on batch status,
 * plus Enable/Disable, Duplicate, and Delete management actions.
 * Uses MenuComponents context for dropdown/context menu rendering.
 */

import { Play, Pause, RotateCcw, Power, PowerOff, Copy, Trash2 } from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'
import type { BatchStatus } from '@craft-agent/shared/batches'

export interface BatchMenuProps {
  batchId: string
  status?: BatchStatus
  enabled?: boolean
  onStart?: () => void
  onPause?: () => void
  onResume?: () => void
  onToggleEnabled?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
}

export function BatchMenu({
  batchId,
  status = 'pending',
  enabled = true,
  onStart,
  onPause,
  onResume,
  onToggleEnabled,
  onDuplicate,
  onDelete,
}: BatchMenuProps) {
  const { MenuItem, Separator } = useMenuComponents()

  return (
    <>
      {/* Start - available when pending, completed, or failed */}
      {(status === 'pending' || status === 'completed' || status === 'failed') && onStart && (
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

      {/* Toggle enabled/disabled */}
      {onToggleEnabled && (
        <MenuItem onClick={onToggleEnabled}>
          {enabled ? (
            <PowerOff className="h-3.5 w-3.5" />
          ) : (
            <Power className="h-3.5 w-3.5" />
          )}
          <span className="flex-1">{enabled ? 'Disable' : 'Enable'}</span>
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
