/**
 * CompactBatchMenu
 *
 * Bottom-sheet replacement for the desktop `BatchMenu` (rendered as a Radix
 * DropdownMenu inside `EntityRow`'s touch-revealed "..." button) when the
 * app-shell width is below the compact threshold. The desktop menu's
 * `Labels` Radix Sub gets clipped by the panel container query on narrow
 * viewports, same problem `CompactSessionMenu` already solved for sessions.
 *
 * Pattern mirrors `CompactSessionMenu`:
 *  - Self-contained: trigger button + Drawer in one component.
 *  - View stack (`'root'` + `'labels'`) instead of nested Radix submenus.
 *  - iOS-style drill-in (back chevron in DrawerHeader).
 *  - Leaf actions close the drawer; label toggles do NOT close (lets the
 *    user apply multiple labels in one pass).
 *
 * Designed to be plugged into `EntityRow.overlay` in compact mode so it
 * sits where the row's built-in MoreHorizontal button normally lives.
 * Consumer should NOT also pass `menuContent` in compact mode — that would
 * stack two triggers on top of each other.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
  Tag,
  Trash2,
} from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { LabelIcon } from '@/components/ui/label-icon'
import {
  createLabelMenuItems,
  type LabelMenuItem,
} from '@/components/ui/label-menu-utils'
import { extractLabelId, type LabelConfig } from '@craft-agent/shared/labels'
import type { BatchStatus } from '@craft-agent/shared/batches'

type View = 'root' | 'labels'

export interface CompactBatchMenuProps {
  /** Used as the drawer title in the root pane + aria-label on the trigger. */
  batchName: string
  status?: BatchStatus
  /** Workspace label tree (for the Labels sub-pane). Empty/absent hides the row. */
  labels?: LabelConfig[]
  /** Currently applied labels on this batch (bare IDs or "id::value" entries). */
  batchLabels?: string[]
  /** Called when a label is toggled — receives the updated full labels array. */
  onLabelsChange?: (labels: string[]) => void
  onStart?: () => void
  onPause?: () => void
  onResume?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
}

export function CompactBatchMenu({
  batchName,
  status = 'pending',
  labels,
  batchLabels,
  onLabelsChange,
  onStart,
  onPause,
  onResume,
  onDuplicate,
  onDelete,
}: CompactBatchMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [view, setView] = React.useState<View>('root')

  // Reset to root when drawer closes — next open shouldn't surprise the user
  // with a sub-pane left over from a prior session.
  React.useEffect(() => {
    if (!open) setView('root')
  }, [open])

  const appliedLabelIds = React.useMemo(
    () => new Set((batchLabels ?? []).map(extractLabelId)),
    [batchLabels],
  )

  const handleLabelToggle = React.useCallback(
    (labelId: string) => {
      if (!onLabelsChange) return
      const current = batchLabels ?? []
      const isApplied = appliedLabelIds.has(labelId)
      const next = isApplied
        ? current.filter((entry) => extractLabelId(entry) !== labelId)
        : [...current, labelId]
      onLabelsChange(next)
    },
    [batchLabels, appliedLabelIds, onLabelsChange],
  )

  const flatLabelItems = React.useMemo(
    (): LabelMenuItem[] => createLabelMenuItems(labels ?? []),
    [labels],
  )

  const showLabels = !!labels && labels.length > 0 && !!onLabelsChange

  // Wrap a callback to also close the drawer after invoking it.
  const closeAfter = React.useCallback(
    (fn?: () => void) => {
      if (!fn) return undefined
      return () => {
        fn()
        setOpen(false)
      }
    },
    [],
  )

  const headerTitle =
    view === 'labels' ? t('batches.menuLabels') : batchName

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          data-touch-reveal="true"
          className={cn(
            'absolute right-2 top-2 z-10 p-1.5 rounded-md',
            'hover:bg-foreground/10 active:bg-foreground/15 transition-colors',
            'data-[state=open]:bg-foreground/10',
            'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
          aria-label={batchName}
          // Stop propagation so the underlying row's onMouseDown (selection)
          // doesn't fire when the user taps the trigger.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
        </button>
      </DrawerTrigger>

      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="!flex flex-row items-center gap-2 !text-left pr-3">
          {view !== 'root' && (
            <button
              type="button"
              onClick={() => setView('root')}
              className="-ml-1 h-8 w-8 rounded-md flex items-center justify-center hover:bg-foreground/5 active:bg-foreground/10 transition-colors text-foreground/50"
              aria-label={t('common.back')}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          <DrawerTitle className="flex-1 min-w-0 truncate">{headerTitle}</DrawerTitle>
        </DrawerHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-6">
          {view === 'root' && (
            <div className="flex flex-col">
              {status === 'pending' && onStart && (
                <Row icon={<Play className="h-4 w-4" />} label={t('batches.menuStart')} onTap={closeAfter(onStart)} />
              )}
              {status === 'running' && onPause && (
                <Row icon={<Pause className="h-4 w-4" />} label={t('batches.menuPause')} onTap={closeAfter(onPause)} />
              )}
              {status === 'paused' && onResume && (
                <Row icon={<RotateCcw className="h-4 w-4" />} label={t('batches.menuResume')} onTap={closeAfter(onResume)} />
              )}
              {showLabels && (
                <Row
                  icon={<Tag className="h-4 w-4" />}
                  label={t('batches.menuLabels')}
                  trailing={appliedLabelIds.size > 0 ? <CountBadge count={appliedLabelIds.size} /> : undefined}
                  chevron
                  onTap={() => setView('labels')}
                />
              )}

              {onDuplicate && (
                <Row icon={<Copy className="h-4 w-4" />} label={t('batches.menuDuplicate')} onTap={closeAfter(onDuplicate)} />
              )}

              {onDelete && (
                <>
                  <Separator />
                  <Row
                    icon={<Trash2 className="h-4 w-4" />}
                    label={t('batches.menuDelete')}
                    destructive
                    onTap={closeAfter(onDelete)}
                  />
                </>
              )}
            </div>
          )}

          {view === 'labels' && (
            <div className="flex flex-col">
              {flatLabelItems.map((item) => {
                const isApplied = appliedLabelIds.has(item.id)
                return (
                  <Row
                    key={item.id}
                    icon={<LabelIcon label={item.config} size="lg" />}
                    label={
                      item.parentPath ? (
                        <>
                          <span className="text-foreground/50">{item.parentPath}</span>
                          {item.label}
                        </>
                      ) : (
                        item.label
                      )
                    }
                    radioSelected={isApplied}
                    onTap={() => handleLabelToggle(item.id)}
                  />
                )
              })}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

// ---------------------------------------------------------------------------
// Primitives (kept local; identical shape to CompactSessionMenu so the two
// drawers visually match. If a third compact menu appears, lift these to
// a shared module.)
// ---------------------------------------------------------------------------

interface RowProps {
  icon: React.ReactNode
  label: React.ReactNode
  trailing?: React.ReactNode
  chevron?: boolean
  radioSelected?: boolean
  destructive?: boolean
  onTap?: () => void
}

function Row({ icon, label, trailing, chevron, radioSelected, destructive, onTap }: RowProps) {
  if (!onTap) return null
  return (
    <button
      type="button"
      onClick={onTap}
      className={cn(
        'flex items-center gap-3 w-full px-3 py-3 rounded-xl text-left transition-colors',
        'hover:bg-foreground/5 active:bg-foreground/10',
        destructive && 'text-destructive hover:bg-destructive/10 active:bg-destructive/15',
      )}
    >
      <span className="shrink-0 inline-flex items-center justify-center h-5 w-5">{icon}</span>
      <span className="flex-1 min-w-0 text-sm truncate">{label}</span>
      {trailing}
      {radioSelected && <Check className="h-4 w-4 shrink-0 text-foreground/70" />}
      {chevron && <ChevronRight className="h-4 w-4 shrink-0 text-foreground/50" />}
    </button>
  )
}

function Separator() {
  return <div className="my-1 mx-3 h-px bg-foreground/[0.06]" />
}

function CountBadge({ count }: { count: number }) {
  return <span className="text-[11px] tabular-nums text-foreground/50">{count}</span>
}
