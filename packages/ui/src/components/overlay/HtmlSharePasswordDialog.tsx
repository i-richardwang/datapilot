/**
 * HtmlSharePasswordDialog — set, change, or remove the password on a shared
 * HTML artifact.
 *
 * Mirrors the session-level SharePasswordDialog (apps/electron/src/renderer/
 * components/app-shell/SharePasswordDialog.tsx) so the two share flows feel
 * symmetric. Two flows:
 *  - 'share':  artifact is not yet shared. Triggers `onShareHtml` with the
 *              entered password in one round-trip.
 *  - 'change': artifact is already shared (with or without a password).
 *              Triggers `onSetHtmlSharePassword` to set / rotate / clear.
 *
 * Lives in packages/ui (not apps/electron) because HTMLPreviewOverlay is a
 * cross-platform component and any future web-viewer surface will need the
 * same dialog. Backend interaction goes through PlatformActions, never
 * `window.electronAPI` directly.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import * as Dialog from '@radix-ui/react-dialog'
import { Lock, LockOpen, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'
import { usePlatform } from '../../context/PlatformContext'

export type HtmlSharePasswordMode = 'share' | 'change'

export interface HtmlSharePasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: HtmlSharePasswordMode
  /** Used by both flows. */
  sessionId: string
  /** Required when `mode === 'share'` — the HTML body to upload + protect. */
  html?: string
  /** Required when `mode === 'change'` — identifies the existing artifact. */
  sharedId?: string
  /**
   * Whether the existing artifact already has a password. Only meaningful in
   * 'change' mode; 'share' mode always starts from no-password state.
   */
  hasExistingPassword?: boolean
  /** Submit handler for the 'share' flow. */
  onShareHtml?: (sessionId: string, html: string, password: string) => Promise<{ sharedUrl: string; sharedId: string; hasPassword: boolean }>
  /** Submit handler for the 'change' flow. */
  onSetHtmlSharePassword?: (
    sessionId: string,
    sharedId: string,
    args: { currentPassword?: string; newPassword: string | null },
  ) => Promise<{ hasPassword: boolean }>
  /** Called after a successful submit (closes dialog, triggers parent refresh). */
  onComplete?: (result: { hasPassword: boolean; sharedUrl?: string }) => void
}

export function HtmlSharePasswordDialog({
  open,
  onOpenChange,
  mode,
  sessionId,
  html,
  sharedId,
  hasExistingPassword,
  onShareHtml,
  onSetHtmlSharePassword,
  onComplete,
}: HtmlSharePasswordDialogProps) {
  const { t } = useTranslation()
  const { onOpenUrl } = usePlatform()
  const [currentPassword, setCurrentPassword] = React.useState('')
  const [newPassword, setNewPassword] = React.useState('')
  const [isBusy, setIsBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      setCurrentPassword('')
      setNewPassword('')
      setIsBusy(false)
    }
  }, [open])

  // 'change' on an artifact that already has a password requires the current
  // password as authorisation. 'change' from no-password state (i.e. adding a
  // password to an existing public share) does not.
  const needsCurrent = mode === 'change' && hasExistingPassword === true
  // Only meaningful when there's something to clear.
  const allowClear = mode === 'change' && hasExistingPassword === true

  const titleKey = mode === 'share'
    ? 'htmlShare.passwordDialog.shareTitle'
    : 'htmlShare.passwordDialog.changeTitle'
  const descriptionKey = mode === 'share'
    ? 'htmlShare.passwordDialog.shareDescription'
    : 'htmlShare.passwordDialog.changeDescription'

  const submit = React.useCallback(async () => {
    if (newPassword.length === 0) return
    setIsBusy(true)
    try {
      if (mode === 'share') {
        if (!html || !onShareHtml) return
        try {
          const result = await onShareHtml(sessionId, html, newPassword)
          await navigator.clipboard.writeText(result.sharedUrl).catch(() => undefined)
          toast.success(t('toast.linkCopied'), {
            description: result.sharedUrl,
            ...(onOpenUrl && {
              action: {
                label: t('sendToWorkspace.open'),
                onClick: () => onOpenUrl(result.sharedUrl),
              },
            }),
          })
          onComplete?.({ hasPassword: result.hasPassword, sharedUrl: result.sharedUrl })
          onOpenChange(false)
        } catch (error) {
          toast.error(t('htmlShare.failedToShare'), {
            description: error instanceof Error ? error.message : t('toast.unknownError'),
          })
        }
      } else {
        if (!sharedId || !onSetHtmlSharePassword) return
        try {
          const result = await onSetHtmlSharePassword(sessionId, sharedId, {
            currentPassword: needsCurrent ? currentPassword : undefined,
            newPassword,
          })
          toast.success(t('htmlShare.passwordUpdated'))
          onComplete?.({ hasPassword: result.hasPassword })
          onOpenChange(false)
        } catch (error) {
          toast.error(t('htmlShare.failedToUpdatePassword'), {
            description: error instanceof Error ? error.message : t('toast.unknownError'),
          })
        }
      }
    } finally {
      setIsBusy(false)
    }
  }, [mode, sessionId, html, sharedId, currentPassword, newPassword, needsCurrent, onShareHtml, onSetHtmlSharePassword, onComplete, onOpenChange, t])

  const removePassword = React.useCallback(async () => {
    if (!allowClear || !sharedId || !onSetHtmlSharePassword) return
    if (currentPassword.length === 0) return
    setIsBusy(true)
    try {
      const result = await onSetHtmlSharePassword(sessionId, sharedId, {
        currentPassword,
        newPassword: null,
      })
      toast.success(t('htmlShare.passwordRemoved'))
      onComplete?.({ hasPassword: result.hasPassword })
      onOpenChange(false)
    } catch (error) {
      toast.error(t('htmlShare.failedToUpdatePassword'), {
        description: error instanceof Error ? error.message : t('toast.unknownError'),
      })
    } finally {
      setIsBusy(false)
    }
  }, [allowClear, sharedId, sessionId, currentPassword, onSetHtmlSharePassword, onComplete, onOpenChange, t])

  const submitDisabled =
    isBusy ||
    newPassword.length === 0 ||
    (needsCurrent && currentPassword.length === 0)

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!isBusy) onOpenChange(next) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[var(--z-dialog-overlay,500)]" />
        <Dialog.Content
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-[95vw] max-w-sm rounded-lg border bg-background shadow-lg',
            'p-5 outline-none',
          )}
          style={{ zIndex: 'var(--z-dialog, 510)' }}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-1.5">
              <Dialog.Title className="flex items-center gap-2 text-base font-semibold">
                <Lock className="h-4 w-4" />
                {t(titleKey)}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                {t(descriptionKey)}
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="text-muted-foreground hover:text-foreground"
              disabled={isBusy}
              aria-label={t('common.close')}
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); void submit() }}
            className="flex flex-col gap-3 py-4"
          >
            {needsCurrent && (
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">
                  {t('htmlShare.passwordDialog.currentLabel')}
                </span>
                <input
                  type="password"
                  autoFocus
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder={t('htmlShare.passwordDialog.currentPlaceholder')}
                  className="px-3 py-2 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                  disabled={isBusy}
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                {t('htmlShare.passwordDialog.newLabel')}
              </span>
              <input
                type="password"
                autoFocus={!needsCurrent}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('htmlShare.passwordDialog.newPlaceholder')}
                className="px-3 py-2 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                disabled={isBusy}
              />
            </label>
          </form>

          <div className="flex items-center gap-2 justify-between">
            {allowClear ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50 disabled:hover:bg-transparent"
                disabled={isBusy || currentPassword.length === 0}
                onClick={() => void removePassword()}
              >
                <LockOpen className="h-3.5 w-3.5" />
                {t('htmlShare.passwordDialog.remove')}
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent disabled:opacity-50"
                onClick={() => onOpenChange(false)}
                disabled={isBusy}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                onClick={() => void submit()}
                disabled={submitDisabled}
              >
                {mode === 'share'
                  ? t('htmlShare.passwordDialog.shareAction')
                  : t('htmlShare.passwordDialog.saveAction')}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
