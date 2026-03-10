/**
 * Batch UI Types
 *
 * UI-specific types for the batches components.
 */

import type { BadgeColor } from '@/components/info/Info_Badge'
import type { BatchConfig, BatchProgress, BatchStatus } from '@craft-agent/shared/batches'
import type { PermissionMode } from '../../../shared/types'

// ============================================================================
// List Item
// ============================================================================

/** A batch config enriched with live progress data for list display. */
export type BatchListItem = BatchConfig & { progress?: BatchProgress }

// ============================================================================
// Filter
// ============================================================================

export type BatchFilterKind = 'all' | 'pending' | 'running' | 'paused' | 'completed' | 'failed'

export interface BatchListFilter {
  kind: BatchFilterKind
}

/** Maps batch status to filter kind */
export const BATCH_STATUS_TO_FILTER_KIND: Record<string, BatchFilterKind> = {
  pending: 'pending',
  running: 'running',
  paused: 'paused',
  completed: 'completed',
  failed: 'failed',
}

// ============================================================================
// Display Names & Colors
// ============================================================================

export const BATCH_STATUS_DISPLAY: Record<BatchStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
}

/** Color mapping for MicroBadge and BatchAvatar (raw bg/text classes). */
export const BATCH_STATUS_COLOR: Record<BatchStatus, { bg: string; text: string }> = {
  pending: { bg: 'bg-foreground/8', text: 'text-foreground/60' },
  running: { bg: 'bg-info/10', text: 'text-info' },
  paused: { bg: 'bg-warning/10', text: 'text-warning' },
  completed: { bg: 'bg-success/10', text: 'text-success' },
  failed: { bg: 'bg-destructive/10', text: 'text-destructive' },
}

/** Color mapping for Info_Badge usage in detail pages. */
export const BATCH_STATUS_BADGE_COLOR: Record<BatchStatus, BadgeColor> = {
  pending: 'muted',
  running: 'warning',
  paused: 'default',
  completed: 'success',
  failed: 'destructive',
}

// ============================================================================
// Permission Display (shared with automations)
// ============================================================================

const PERMISSION_DISPLAY_NAMES: Record<PermissionMode, string> = {
  'safe':      'Explore',
  'ask':       'Ask',
  'allow-all': 'Execute',
}

export function getPermissionDisplayName(mode?: PermissionMode): string {
  if (!mode) return 'Explore'
  return PERMISSION_DISPLAY_NAMES[mode] ?? mode
}
