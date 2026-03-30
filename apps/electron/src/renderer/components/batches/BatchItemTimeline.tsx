/**
 * BatchItemTimeline
 *
 * Compact timeline showing batch item processing results.
 * Displayed as a section within BatchInfoPage.
 *
 * Uses @tanstack/react-virtual for large lists (>100 items) to avoid
 * rendering thousands of DOM nodes. Auto-scrolls to the first "running"
 * item so the user sees the execution frontier immediately.
 */

import { useRef, useMemo, useEffect } from 'react'
import { CheckCircle2, XCircle, Loader2, Clock, MinusCircle } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'
import { useNavigation } from '@/contexts/NavigationContext'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { BatchItemState, BatchItemStatus } from '@craft-agent/shared/batches'

// ============================================================================
// Constants
// ============================================================================

const statusConfig: Record<BatchItemStatus, { icon: React.ElementType; classes: string }> = {
  completed: { icon: CheckCircle2, classes: 'text-success' },
  failed:    { icon: XCircle,      classes: 'text-destructive' },
  running:   { icon: Loader2,      classes: 'text-info animate-spin' },
  pending:   { icon: Clock,        classes: 'text-muted-foreground' },
  skipped:   { icon: MinusCircle,  classes: 'text-muted-foreground' },
}

/** Height of each item row in pixels (px-4 py-2.5 + text-sm ≈ 40px) */
const ITEM_HEIGHT = 40

/** Only virtualize when item count exceeds this threshold */
const VIRTUALIZE_THRESHOLD = 100

/** Max visible height of the virtualized container (px). ~15 visible rows. */
const MAX_CONTAINER_HEIGHT = 600

/** Number of items to render beyond the visible area */
const OVERSCAN = 10

// ============================================================================
// Shared item renderer
// ============================================================================

function ItemRow({
  itemId,
  item,
  navigateToSession,
}: {
  itemId: string
  item: BatchItemState
  navigateToSession: (sessionId: string) => void
}) {
  const config = statusConfig[item.status] ?? statusConfig.pending
  const StatusIcon = config.icon

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', config.classes)} />
      <span className="text-xs font-mono text-foreground/70 w-24 shrink-0 truncate">
        {itemId}
      </span>
      <span className="flex-1 min-w-0 truncate text-xs text-foreground/70">
        {item.error || item.summary || '—'}
      </span>
      {item.sessionId && (
        <button
          className="shrink-0 text-[11px] text-accent hover:underline cursor-pointer"
          onClick={() => navigateToSession(item.sessionId!)}
        >
          Open session
        </button>
      )}
    </div>
  )
}

// ============================================================================
// Virtualized list (extracted so hooks are not called conditionally)
// ============================================================================

function VirtualizedList({
  entries,
  navigateToSession,
  className,
}: {
  entries: [string, BatchItemState][]
  navigateToSession: (sessionId: string) => void
  className?: string
}) {
  const viewportRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: entries.length,
    estimateSize: () => ITEM_HEIGHT,
    getScrollElement: () => viewportRef.current,
    overscan: OVERSCAN,
  })

  // Auto-scroll to the first "running" item on mount
  const hasScrolledRef = useRef(false)
  useEffect(() => {
    if (hasScrolledRef.current) return
    hasScrolledRef.current = true
    const firstRunningIdx = entries.findIndex(([, item]) => item.status === 'running')
    if (firstRunningIdx !== -1) {
      virtualizer.scrollToIndex(firstRunningIdx, { align: 'start' })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ScrollArea
      viewportRef={viewportRef}
      className={className}
      style={{ maxHeight: MAX_CONTAINER_HEIGHT }}
    >
      <div
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const [itemId, item] = entries[virtualRow.index]
          const isLast = virtualRow.index === entries.length - 1
          return (
            <div
              key={itemId}
              data-index={virtualRow.index}
              className={cn(
                'absolute left-0 top-0 w-full',
                !isLast && 'border-b border-border/30',
              )}
              style={{
                height: `${ITEM_HEIGHT}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <ItemRow
                itemId={itemId}
                item={item}
                navigateToSession={navigateToSession}
              />
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

// ============================================================================
// Public component
// ============================================================================

export interface BatchItemTimelineProps {
  items: Record<string, BatchItemState>
  className?: string
}

export function BatchItemTimeline({ items, className }: BatchItemTimelineProps) {
  const { navigateToSession } = useNavigation()
  const entries = useMemo(() => Object.entries(items), [items])

  if (entries.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
        No items processed yet.
      </div>
    )
  }

  if (entries.length > VIRTUALIZE_THRESHOLD) {
    return (
      <VirtualizedList
        entries={entries}
        navigateToSession={navigateToSession}
        className={className}
      />
    )
  }

  return (
    <div className={cn('divide-y divide-border/30', className)}>
      {entries.map(([itemId, item]) => (
        <ItemRow
          key={itemId}
          itemId={itemId}
          item={item}
          navigateToSession={navigateToSession}
        />
      ))}
    </div>
  )
}
