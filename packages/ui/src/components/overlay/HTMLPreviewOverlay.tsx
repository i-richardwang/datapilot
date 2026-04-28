/**
 * HTMLPreviewOverlay - Fullscreen overlay for viewing rendered HTML content.
 *
 * Uses PreviewOverlay as the base for consistent modal/fullscreen behavior.
 * Renders HTML in a sandboxed iframe with `allow-scripts` so interactive
 * reports (ECharts, D3, Plotly, etc.) work; `allow-same-origin` is
 * deliberately omitted so the iframe cannot reach into the parent app's DOM.
 * Links open in the system browser via Electron's will-navigate handler
 * (`allow-top-navigation-by-user-activation`).
 *
 * Supports multiple items with arrow navigation in the header.
 *
 * Iframe height: previously read `contentDocument.scrollHeight` to fit content.
 * That path requires same-origin and is now blocked by the cross-origin
 * sandbox — the read still runs in a try/catch and falls back to a
 * viewport-relative default (`calc(100vh - 200px)`), which is fine for the
 * fullscreen overlay's "use the whole viewport" intent.
 */

import * as React from 'react'
import { Globe, Copy, RefreshCw, Link2Off, Info, Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PreviewOverlay } from './PreviewOverlay'
import { CopyButton } from './CopyButton'
import { ItemNavigator } from './ItemNavigator'
import { HtmlSharePasswordDialog, type HtmlSharePasswordMode } from './HtmlSharePasswordDialog'
import { usePlatform } from '../../context/PlatformContext'
import { useSessionContext } from '../../context/SessionContext'
import { ShareCloudIconButton, ShareCloudMenuIcon } from '../ui/ShareCloudIconButton'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '../ui/StyledDropdown'

const SHARE_LEARN_MORE_URL = 'https://agents.craft.do/docs/go-further/sharing'

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
 * Compute a hex-encoded SHA-256 hash of a UTF-8 string using SubtleCrypto.
 * Same algorithm as the server-side createHash('sha256').digest('hex') so
 * content hashes line up across the RPC boundary.
 */
async function computeSha256Hex(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data)
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/** React hook that computes the SHA-256 hash of `content` asynchronously. */
function useContentHash(content: string): string | null {
  const [hash, setHash] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!content) {
      setHash(null)
      return
    }
    let cancelled = false
    computeSha256Hex(content)
      .then(h => { if (!cancelled) setHash(h) })
      .catch(() => { if (!cancelled) setHash(null) })
    return () => { cancelled = true }
  }, [content])
  return hash
}

/**
 * ShareLinkButton — two-state share control for HTML previews.
 *
 * Requires a SessionContext (sessionId + current htmlShares map) and at least
 * the `onShareHtml` PlatformAction. Without both, renders nothing so web-viewer
 * / detached overlays don't advertise a feature they can't perform.
 *
 * Mirrors ChatPage's session share button: a single DropdownMenu in both
 * states (never a direct-action click) built from ShareCloudIconButton +
 * radix DropdownMenu + StyledDropdownMenu*, so the two buttons are visually
 * and interactively indistinguishable.
 *
 * Visual state is derived from whichever `htmlShares` entry is anchored to
 * this button instance:
 *   - No anchor yet and `htmlShares[hash(html)]` does not exist → idle.
 *     Adopts the matching entry if one appears while the button is mounted
 *     (e.g. another window shared the same bytes).
 *   - Anchor set → shared. Stays shared across content edits so the user can
 *     still reach the popover (Update share / Stop sharing) when the bytes
 *     drift away from what was originally uploaded.
 */
function ShareLinkButton({
  html,
  className,
}: {
  html: string
  className?: string
}) {
  const { t } = useTranslation()
  const session = useSessionContext()
  const { onShareHtml, onUpdateHtmlShare, onRevokeHtmlShare, onSetHtmlSharePassword, onOpenUrl } = usePlatform()
  const [anchorSharedId, setAnchorSharedId] = React.useState<string | null>(null)
  const [passwordDialog, setPasswordDialog] = React.useState<{ open: boolean; mode: HtmlSharePasswordMode }>({
    open: false,
    mode: 'share',
  })

  const currentHash = useContentHash(html)
  const htmlShares = session?.htmlShares

  // Reset anchor whenever the button is re-mounted for a different html item
  // so navigating the overlay's ItemNavigator doesn't carry state across items.
  React.useEffect(() => {
    setAnchorSharedId(null)
  }, [html])

  // If the server revokes the anchored share (e.g. via another window), drop
  // our anchor so the button flips back to idle.
  React.useEffect(() => {
    if (!anchorSharedId || !htmlShares) return
    const stillExists = Object.values(htmlShares).some(e => e.sharedId === anchorSharedId)
    if (!stillExists) setAnchorSharedId(null)
  }, [htmlShares, anchorSharedId])

  // Auto-adopt a matching existing share when the current bytes line up.
  // This is the html-preview-specific behavior (cross-window sync on content
  // hash match) — the session share button does not have an equivalent.
  React.useEffect(() => {
    if (!htmlShares || anchorSharedId || !currentHash) return
    const match = htmlShares[currentHash]
    if (match) setAnchorSharedId(match.sharedId)
  }, [htmlShares, currentHash, anchorSharedId])

  const anchorEntry = React.useMemo(() => {
    if (!anchorSharedId || !htmlShares) return null
    for (const [hash, entry] of Object.entries(htmlShares)) {
      if (entry.sharedId === anchorSharedId) return { hash, ...entry }
    }
    return null
  }, [anchorSharedId, htmlShares])

  const isShared = anchorEntry !== null

  // Guard: without a session or the share action, rendering this button is
  // confusing (no-op clicks, stale state). Hide it in those environments.
  if (!session || !onShareHtml) return null

  const handleShare = async () => {
    if (!html) return
    try {
      const result = await onShareHtml(session.sessionId, html)
      setAnchorSharedId(result.sharedId)
    } catch {
      // PlatformAction implementations surface their own errors (toast).
    }
  }

  const openPasswordDialog = (mode: HtmlSharePasswordMode) => {
    setPasswordDialog({ open: true, mode })
  }

  const handlePasswordDialogComplete = (result: { hasPassword: boolean; sharedUrl?: string }) => {
    // For 'share' mode the dialog drove the upload; adopt the new sharedId so
    // the button flips to the post-share state. For 'change' mode the
    // sharedId is unchanged, but the htmlShares map will refresh its
    // passwordSet flag via the session_html_shares_changed event.
    if (result.sharedUrl) {
      // Find the new entry by URL — anchorEntry will follow once htmlShares
      // updates from the server event. As a fallback for immediate UI flip,
      // walk the map to pick up the matching sharedId.
      const map = session?.htmlShares
      if (map) {
        for (const entry of Object.values(map)) {
          if (entry.sharedUrl === result.sharedUrl) {
            setAnchorSharedId(entry.sharedId)
            break
          }
        }
      }
    }
  }

  const handleCopyLink = async () => {
    if (!anchorEntry) return
    await navigator.clipboard.writeText(anchorEntry.sharedUrl)
    toast.success(t('toast.linkCopied'))
  }

  const handleOpenInBrowser = () => {
    if (!anchorEntry || !onOpenUrl) return
    onOpenUrl(anchorEntry.sharedUrl)
  }

  const handleUpdateShare = async () => {
    if (!anchorEntry || !onUpdateHtmlShare) return
    try {
      await onUpdateHtmlShare(session.sessionId, anchorEntry.sharedId, html)
    } catch {
      // Platform surfaces the error; leave anchor in place.
    }
  }

  const handleRevokeShare = async () => {
    if (!anchorEntry || !onRevokeHtmlShare) return
    try {
      await onRevokeHtmlShare(session.sessionId, anchorEntry.sharedId)
      setAnchorSharedId(null)
    } catch {
      // Leave anchor in place on failure so user can retry.
    }
  }

  const handleLearnMore = () => {
    onOpenUrl?.(SHARE_LEARN_MORE_URL)
  }

  const tooltip = isShared ? t('htmlShare.shared') : t('htmlShare.share')
  const passwordSet = anchorEntry?.passwordSet === true
  // onShareHtml is always defined past the guard above; password flows
  // additionally need onSetHtmlSharePassword to set / change / clear it.
  const canShareWithPassword = !!onSetHtmlSharePassword
  const canChangePassword = !!onSetHtmlSharePassword && passwordSet

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <ShareCloudIconButton
            isShared={isShared}
            title={tooltip}
            aria-label={tooltip}
            className={className}
          />
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="end" sideOffset={8} style={{ zIndex: 'var(--z-floating-menu, 400)' }}>
          {isShared ? (
            <>
              {onOpenUrl && (
                <StyledDropdownMenuItem onClick={handleOpenInBrowser}>
                  <Globe className="h-3.5 w-3.5" />
                  <span className="flex-1">{t('htmlShare.openInBrowser')}</span>
                </StyledDropdownMenuItem>
              )}
              <StyledDropdownMenuItem onClick={handleCopyLink}>
                <Copy className="h-3.5 w-3.5" />
                <span className="flex-1">{t('htmlShare.copyLink')}</span>
              </StyledDropdownMenuItem>
              {onUpdateHtmlShare && (
                <StyledDropdownMenuItem onClick={handleUpdateShare}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span className="flex-1">{t('htmlShare.updateShare')}</span>
                </StyledDropdownMenuItem>
              )}
              {canChangePassword && (
                <StyledDropdownMenuItem onClick={() => openPasswordDialog('change')}>
                  <Lock className="h-3.5 w-3.5" />
                  <span className="flex-1">{t('htmlShare.changeSharePassword')}</span>
                </StyledDropdownMenuItem>
              )}
              {onRevokeHtmlShare && (
                <>
                  <StyledDropdownMenuSeparator />
                  <StyledDropdownMenuItem onClick={handleRevokeShare} variant="destructive">
                    <Link2Off className="h-3.5 w-3.5" />
                    <span className="flex-1">{t('htmlShare.stopSharing')}</span>
                  </StyledDropdownMenuItem>
                </>
              )}
              {onOpenUrl && (
                <>
                  <StyledDropdownMenuSeparator />
                  <StyledDropdownMenuItem onClick={handleLearnMore}>
                    <Info className="h-3.5 w-3.5" />
                    <span className="flex-1">{t('chat.learnMore')}</span>
                  </StyledDropdownMenuItem>
                </>
              )}
            </>
          ) : (
            <>
              <StyledDropdownMenuItem onClick={handleShare} disabled={!html}>
                <ShareCloudMenuIcon />
                <span className="flex-1">{t('chat.shareOnline')}</span>
              </StyledDropdownMenuItem>
              {canShareWithPassword && (
                <StyledDropdownMenuItem onClick={() => openPasswordDialog('share')} disabled={!html}>
                  <Lock className="h-3.5 w-3.5" />
                  <span className="flex-1">{t('htmlShare.shareWithPassword')}</span>
                </StyledDropdownMenuItem>
              )}
              {onOpenUrl && (
                <>
                  <StyledDropdownMenuSeparator />
                  <StyledDropdownMenuItem onClick={handleLearnMore}>
                    <Info className="h-3.5 w-3.5" />
                    <span className="flex-1">{t('chat.learnMore')}</span>
                  </StyledDropdownMenuItem>
                </>
              )}
            </>
          )}
        </StyledDropdownMenuContent>
      </DropdownMenu>
      <HtmlSharePasswordDialog
        open={passwordDialog.open}
        onOpenChange={(next) => setPasswordDialog((prev) => ({ ...prev, open: next }))}
        mode={passwordDialog.mode}
        sessionId={session.sessionId}
        html={html}
        sharedId={anchorEntry?.sharedId}
        hasExistingPassword={passwordSet}
        onShareHtml={onShareHtml ? (sid, body, password) => onShareHtml(sid, body, password) : undefined}
        onSetHtmlSharePassword={onSetHtmlSharePassword}
        onComplete={handlePasswordDialogComplete}
      />
    </>
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
  const { t } = useTranslation()
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
      <ShareLinkButton html={activeContent || ''} />
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
          <div className="py-12 text-center text-muted-foreground text-sm">{t('common.loading')}</div>
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
              sandbox="allow-scripts allow-top-navigation-by-user-activation"
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
