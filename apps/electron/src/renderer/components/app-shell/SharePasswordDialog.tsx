/**
 * SharePasswordDialog — set, change, or remove the share password.
 *
 * Three flows:
 *  - 'share':  shared starts NOW with a password (combines shareToViewer + password)
 *  - 'set':    already shared, add a password for the first time
 *  - 'change': already shared with password, rotate it or clear it
 */

import * as React from 'react'
import { useTranslation } from "react-i18next"
import { useState, useCallback, useEffect } from 'react'
import { Lock, LockOpen } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export type SharePasswordMode = 'share' | 'set' | 'change'

export interface SharePasswordDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: SharePasswordMode
  sessionId: string
  /** Called after the operation completes successfully (url only returned for 'share' mode). */
  onComplete?: (result: { url?: string; hasPassword: boolean }) => void
}

export function SharePasswordDialog({
  open,
  onOpenChange,
  mode,
  sessionId,
  onComplete,
}: SharePasswordDialogProps) {
  const { t } = useTranslation()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      setCurrentPassword('')
      setNewPassword('')
      setIsBusy(false)
    }
  }, [open])

  const needsCurrent = mode === 'change'
  const allowClear = mode === 'change'

  const titleKey = mode === 'share'
    ? 'dialog.sharePassword.shareTitle'
    : mode === 'set'
      ? 'dialog.sharePassword.setTitle'
      : 'dialog.sharePassword.changeTitle'
  const descriptionKey = mode === 'share'
    ? 'dialog.sharePassword.shareDescription'
    : mode === 'set'
      ? 'dialog.sharePassword.setDescription'
      : 'dialog.sharePassword.changeDescription'

  const submit = useCallback(async () => {
    if (newPassword.length === 0) return
    setIsBusy(true)
    try {
      if (mode === 'share') {
        const result = await window.electronAPI.sessionCommand(sessionId, {
          type: 'shareToViewer',
          password: newPassword,
        }) as { success: boolean; url?: string; error?: string; hasPassword?: boolean } | undefined
        if (result?.success && result.url) {
          await navigator.clipboard.writeText(result.url)
          toast.success(t('toast.linkCopied'), {
            description: result.url,
            action: {
              label: t('sendToWorkspace.open'),
              onClick: () => window.electronAPI.openUrl(result.url!),
            },
          })
          onComplete?.({ url: result.url, hasPassword: result.hasPassword === true })
          onOpenChange(false)
        } else {
          toast.error(t('toast.failedToShare'), { description: result?.error ?? t('toast.unknownError') })
        }
      } else {
        const result = await window.electronAPI.sessionCommand(sessionId, {
          type: 'setSharePassword',
          currentPassword: needsCurrent ? currentPassword : undefined,
          newPassword: newPassword,
        }) as { success: boolean; error?: string; hasPassword?: boolean } | undefined
        if (result?.success) {
          toast.success(t('toast.sharePasswordUpdated'))
          onComplete?.({ hasPassword: result.hasPassword === true })
          onOpenChange(false)
        } else {
          toast.error(t('toast.failedToUpdateSharePassword'), {
            description: result?.error ?? t('toast.unknownError'),
          })
        }
      }
    } finally {
      setIsBusy(false)
    }
  }, [mode, sessionId, currentPassword, newPassword, needsCurrent, onComplete, onOpenChange, t])

  const removePassword = useCallback(async () => {
    if (!allowClear) return
    if (currentPassword.length === 0) return
    setIsBusy(true)
    try {
      const result = await window.electronAPI.sessionCommand(sessionId, {
        type: 'setSharePassword',
        currentPassword: currentPassword,
        newPassword: null,
      }) as { success: boolean; error?: string; hasPassword?: boolean } | undefined
      if (result?.success) {
        toast.success(t('toast.sharePasswordRemoved'))
        onComplete?.({ hasPassword: false })
        onOpenChange(false)
      } else {
        toast.error(t('toast.failedToUpdateSharePassword'), {
          description: result?.error ?? t('toast.unknownError'),
        })
      }
    } finally {
      setIsBusy(false)
    }
  }, [allowClear, currentPassword, sessionId, onComplete, onOpenChange, t])

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isBusy) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            {t(titleKey)}
          </DialogTitle>
          <DialogDescription>{t(descriptionKey)}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => { e.preventDefault(); void submit() }}
          className="flex flex-col gap-3 py-1"
        >
          {needsCurrent && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">
                {t('dialog.sharePassword.currentLabel')}
              </span>
              <input
                type="password"
                autoFocus
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={t('dialog.sharePassword.currentPlaceholder')}
                className="px-3 py-2 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
                disabled={isBusy}
              />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              {t('dialog.sharePassword.newLabel')}
            </span>
            <input
              type="password"
              autoFocus={!needsCurrent}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('dialog.sharePassword.newPlaceholder')}
              className="px-3 py-2 rounded-md border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent"
              disabled={isBusy}
            />
          </label>
        </form>

        <DialogFooter className="flex items-center gap-2 sm:justify-between">
          {allowClear ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={isBusy || currentPassword.length === 0}
              onClick={() => void removePassword()}
            >
              <LockOpen className="h-3.5 w-3.5 mr-1" />
              {t('dialog.sharePassword.remove')}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isBusy}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={
                isBusy ||
                newPassword.length === 0 ||
                (needsCurrent && currentPassword.length === 0)
              }
            >
              {mode === 'share'
                ? t('dialog.sharePassword.shareAction')
                : t('dialog.sharePassword.saveAction')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
