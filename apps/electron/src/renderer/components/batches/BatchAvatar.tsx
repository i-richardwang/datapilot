/**
 * BatchAvatar
 *
 * Small icon component for batches. Shows a Layers icon with color based on status.
 */

import * as React from 'react'
import { Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BatchStatus } from '@craft-agent/shared/batches'
import { BATCH_STATUS_COLOR } from './types'

// ============================================================================
// Size Configuration
// ============================================================================

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg'

const sizeConfig: Record<AvatarSize, { container: string; icon: string }> = {
  xs: { container: 'h-3.5 w-3.5', icon: 'h-2 w-2' },
  sm: { container: 'h-4 w-4', icon: 'h-2.5 w-2.5' },
  md: { container: 'h-5 w-5', icon: 'h-3 w-3' },
  lg: { container: 'h-6 w-6', icon: 'h-3.5 w-3.5' },
}

// ============================================================================
// Component
// ============================================================================

export interface BatchAvatarProps {
  status?: BatchStatus
  size?: AvatarSize
  /** Fill parent container (h-full w-full). Overrides size. */
  fluid?: boolean
  className?: string
}

export function BatchAvatar({ status = 'pending', size = 'md', fluid, className }: BatchAvatarProps) {
  const colors = BATCH_STATUS_COLOR[status]
  const sizes = sizeConfig[size]

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-sm ring-1 ring-border/30 shrink-0',
        fluid ? 'h-full w-full' : sizes.container,
        colors.bg,
        className
      )}
    >
      <Layers className={cn(fluid ? 'h-[60%] w-[60%]' : sizes.icon, colors.text)} />
    </span>
  )
}
