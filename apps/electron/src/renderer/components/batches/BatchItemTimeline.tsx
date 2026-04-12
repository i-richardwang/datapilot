/**
 * BatchItemTimeline
 *
 * Compact timeline showing batch item processing results.
 * Displayed as a section within BatchInfoPage.
 * Follows the AutomationEventTimeline pattern.
 *
 * Items are paginated at the data layer (50 per page via getBatchItems RPC),
 * so this component always receives a small slice — no virtualization needed.
 */

import { CheckCircle2, XCircle, Loader2, Clock, MinusCircle, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useNavigation } from '@/contexts/NavigationContext'
import type { BatchItemState, BatchItemStatus } from '@craft-agent/shared/batches'

// ============================================================================
// Helpers
// ============================================================================

const statusConfig: Record<BatchItemStatus, { icon: React.ElementType; classes: string }> = {
  completed: { icon: CheckCircle2, classes: 'text-success' },
  failed:    { icon: XCircle,      classes: 'text-destructive' },
  running:   { icon: Loader2,      classes: 'text-info animate-spin' },
  pending:   { icon: Clock,        classes: 'text-muted-foreground' },
  skipped:   { icon: MinusCircle,  classes: 'text-muted-foreground' },
}

// ============================================================================
// Component
// ============================================================================

export interface BatchItemTimelineProps {
  items: Record<string, BatchItemState>
  onRetryItem?: (itemId: string) => void
  className?: string
}

export function BatchItemTimeline({ items, onRetryItem, className }: BatchItemTimelineProps) {
  const { t } = useTranslation()
  const { navigateToSession } = useNavigation()
  const entries = Object.entries(items)

  if (entries.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
        {t('batches.noItemsProcessed')}
      </div>
    )
  }

  return (
    <div className={cn('divide-y divide-border/30', className)}>
      {entries.map(([itemId, item]) => {
        const config = statusConfig[item.status] ?? statusConfig.pending
        const StatusIcon = config.icon

        return (
          <div key={itemId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            {/* Status icon */}
            <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', config.classes)} />

            {/* Item ID */}
            <span className="text-xs font-mono text-foreground/70 w-24 shrink-0 truncate">
              {itemId}
            </span>

            {/* Summary or error */}
            <span className="flex-1 min-w-0 truncate text-xs text-foreground/70">
              {item.error || item.summary || '—'}
            </span>

            {/* Retry completed/failed/skipped item */}
            {(item.status === 'failed' || item.status === 'completed' || item.status === 'skipped') && onRetryItem && (
              <button
                className="shrink-0 text-[11px] text-accent hover:underline cursor-pointer flex items-center gap-0.5"
                onClick={() => onRetryItem(itemId)}
              >
                <RotateCw className="h-3 w-3" />
                {t('common.retry')}
              </button>
            )}

            {/* Session deep link */}
            {item.sessionId && (
              <button
                className="shrink-0 text-[11px] text-accent hover:underline cursor-pointer"
                onClick={() => navigateToSession(item.sessionId!)}
              >
                {t('batches.openSession')}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
