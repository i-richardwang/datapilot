/**
 * HTMLPreviewOverlay - Fullscreen overlay for viewing rendered HTML content.
 *
 * Uses PreviewOverlay as the base for consistent modal/fullscreen behavior.
 * Renders HTML in a sandboxed iframe (no script execution).
 * Links open in the system browser via Electron's will-navigate handler.
 *
 * Supports multiple items with arrow navigation in the header.
 * The iframe auto-sizes to its content height by reading contentDocument.scrollHeight
 * on load (possible because allow-same-origin is set).
 */

import * as React from 'react'
import { Globe, Share2, Check, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PreviewOverlay } from './PreviewOverlay'
import { CopyButton } from './CopyButton'
import { ItemNavigator } from './ItemNavigator'
import { usePlatform } from '../../context/PlatformContext'
import { cn } from '../../lib/utils'

/**
 * Inject `<base target="_top">` so link clicks navigate the top frame,
 * which Electron's will-navigate handler intercepts → system browser.
 */
function injectBaseTarget(html: string): string {
  if (/<base\s/i.test(html)) return html
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, '$1<base target="_top">')
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, '$1<head><base target="_top"></head>')
  }
  return `<head><base target="_top"></head>${html}`
}

interface PreviewItem {
  src: string
  label?: string
}

/**
 * ShareLinkButton — uploads the current HTML to viewer-server and copies the
 * returned URL to the clipboard. Toast feedback (success/error) is the host
 * platform's responsibility (see PlatformActions.onShareHtml).
 */
function ShareLinkButton({
  html,
  className,
}: {
  html: string
  className?: string
}) {
  const { t } = useTranslation()
  const { onShareHtml } = usePlatform()
  const [state, setState] = React.useState<'idle' | 'sharing' | 'shared'>('idle')

  const handleShare = React.useCallback(async () => {
    if (!onShareHtml || state === 'sharing' || !html) return
    setState('sharing')
    try {
      await onShareHtml(html)
      setState('shared')
      setTimeout(() => setState('idle'), 2000)
    } catch {
      // Platform reports the error via toast; just reset the button state.
      setState('idle')
    }
  }, [onShareHtml, state, html])

  if (!onShareHtml) return null

  const tooltip = state === 'sharing'
    ? t('tooltip.sharing')
    : state === 'shared'
      ? t('tooltip.linkCopied')
      : t('tooltip.shareLink')

  return (
    <button
      type="button"
      onClick={handleShare}
      disabled={state === 'sharing' || !html}
      title={tooltip}
      className={cn(
        'flex items-center justify-center w-7 h-7 rounded-md transition-colors shrink-0 select-none',
        state === 'shared'
          ? 'text-success'
          : 'text-muted-foreground hover:text-foreground hover:bg-foreground/5',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:opacity-60 disabled:cursor-default',
        className,
      )}
    >
      {state === 'sharing'
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
        : state === 'shared'
          ? <Check className="w-3.5 h-3.5" />
          : <Share2 className="w-3.5 h-3.5" />}
    </button>
  )
}

export interface HTMLPreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean
  /** Callback when the overlay should close */
  onClose: () => void
  /** Single HTML content (backward compat for link interceptor usage) */
  html?: string
  /** Multiple items for tabbed navigation */
  items?: PreviewItem[]
  /** Pre-loaded content cache (src → html string) */
  contentCache?: Record<string, string>
  /** Callback to load content for uncached items */
  onLoadContent?: (src: string) => Promise<string>
  /** Initial active item index (defaults to 0) */
  initialIndex?: number
  /** Optional title for the overlay header */
  title?: string
  /** Theme mode for dark/light styling */
  theme?: 'light' | 'dark'
}

export function HTMLPreviewOverlay({
  isOpen,
  onClose,
  html,
  items,
  contentCache: externalCache,
  onLoadContent,
  initialIndex = 0,
  title,
  theme,
}: HTMLPreviewOverlayProps) {
  // Normalize: single html prop → single item, or use items array
  const resolvedItems = React.useMemo<PreviewItem[]>(() => {
    if (items && items.length > 0) return items
    if (html) return [{ src: '__single__' }]
    return []
  }, [items, html])

  const [activeIdx, setActiveIdx] = React.useState(initialIndex)
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const [contentSize, setContentSize] = React.useState<{ width: number; height: number } | null>(null)

  // Internal content cache (merges external + locally loaded)
  const [internalCache, setInternalCache] = React.useState<Record<string, string>>({})
  const [loadingItem, setLoadingItem] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  // Merge caches — external takes precedence, plus single html prop
  const mergedCache = React.useMemo(() => {
    const merged: Record<string, string> = { ...internalCache }
    if (externalCache) Object.assign(merged, externalCache)
    if (html) merged['__single__'] = html
    return merged
  }, [internalCache, externalCache, html])

  const activeItem = resolvedItems[activeIdx]
  const activeContent = activeItem ? mergedCache[activeItem.src] : undefined

  // Reset index when overlay opens
  React.useEffect(() => {
    if (isOpen) {
      setActiveIdx(initialIndex)
      setContentSize(null)
    }
  }, [isOpen, initialIndex])

  // Reset size when active item changes
  React.useEffect(() => {
    setContentSize(null)
    setLoadError(null)
  }, [activeIdx])

  // Load content for active item if not cached
  React.useEffect(() => {
    if (!isOpen || !activeItem?.src) return
    if (mergedCache[activeItem.src]) return
    if (!onLoadContent) return

    setLoadingItem(true)
    setLoadError(null)
    onLoadContent(activeItem.src)
      .then((content) => {
        setInternalCache((prev) => ({ ...prev, [activeItem.src]: content }))
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load content')
      })
      .finally(() => setLoadingItem(false))
  }, [isOpen, activeItem?.src, mergedCache, onLoadContent])

  // Preprocess active HTML
  const processedHtml = React.useMemo(
    () => activeContent ? injectBaseTarget(activeContent) : null,
    [activeContent]
  )

  // Read iframe content dimensions after it loads
  const handleLoad = React.useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    try {
      const doc = iframe.contentDocument
      if (!doc?.body) return
      doc.documentElement.style.overflow = 'hidden'
      doc.body.style.overflow = 'hidden'
      const origWidth = doc.body.style.width
      doc.body.style.width = 'fit-content'
      const naturalWidth = doc.body.scrollWidth
      doc.body.style.width = origWidth
      const height = doc.body.scrollHeight
      setContentSize({ width: naturalWidth, height })
    } catch {
      // Cross-origin access denied
    }
  }, [])

  const iframeHeight = contentSize
    ? `${contentSize.height}px`
    : 'calc(100vh - 200px)'

  const measured = contentSize !== null

  // Header actions: item navigation + share + copy button
  const headerActions = (
    <div className="flex items-center gap-2">
      <ItemNavigator items={resolvedItems} activeIndex={activeIdx} onSelect={setActiveIdx} size="md" />
      <ShareLinkButton html={activeContent || ''} className="bg-background shadow-minimal" />
      <CopyButton content={activeContent || ''} label="Copy HTML" className="bg-background shadow-minimal" />
    </div>
  )

  return (
    <PreviewOverlay
      isOpen={isOpen}
      onClose={onClose}
      theme={theme}
      typeBadge={{
        icon: Globe,
        label: 'HTML',
        variant: 'blue',
      }}
      title={title || activeItem?.label || 'HTML Preview'}
      headerActions={headerActions}
    >
      <div className="px-6 pb-6">
        {loadingItem && !activeContent && (
          <div className="py-12 text-center text-muted-foreground text-sm">Loading...</div>
        )}
        {loadError && !activeContent && (
          <div className="py-12 text-center text-destructive/70 text-sm">{loadError}</div>
        )}
        {processedHtml && (
          <div
            className="bg-white rounded-xl overflow-hidden shadow-minimal mx-auto"
            style={{
              maxWidth: contentSize?.width ? `${contentSize.width + 128}px` : undefined,
              padding: '24px 64px 36px',
              opacity: measured ? 1 : 0,
              transition: 'opacity 200ms ease-in',
            }}
          >
            <iframe
              ref={iframeRef}
              sandbox="allow-same-origin allow-top-navigation-by-user-activation"
              srcDoc={processedHtml}
              onLoad={handleLoad}
              title={activeItem?.label || title || 'HTML Preview'}
              className="w-full border-0"
              style={{ height: iframeHeight, minHeight: '400px' }}
            />
          </div>
        )}
      </div>
    </PreviewOverlay>
  )
}
