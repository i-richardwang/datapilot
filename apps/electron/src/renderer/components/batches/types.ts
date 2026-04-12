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
// Display Keys & Colors
// ============================================================================

/**
 * i18n key lookup for batch status display text.
 * Resolve with `t(BATCH_STATUS_DISPLAY_KEY[status])` in components.
 */
export const BATCH_STATUS_DISPLAY_KEY: Record<BatchStatus, string> = {
  pending: 'batches.statusPending',
  running: 'batches.statusRunning',
  paused: 'batches.statusPaused',
  completed: 'batches.statusCompleted',
  failed: 'batches.statusFailed',
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
// Permission Display (delegates to shared mode.* i18n keys)
// ============================================================================

/**
 * Returns the i18n key for a permission mode's display name.
 * Resolve with `t(getPermissionModeKey(mode))` in components.
 * Keys live in the shared `mode.*` namespace already populated by upstream.
 */
export function getPermissionModeKey(mode?: PermissionMode): string {
  switch (mode) {
    case 'safe': return 'mode.safe'
    case 'ask': return 'mode.ask'
    case 'allow-all': return 'mode.allow-all'
    default: return 'mode.safe'
  }
}
