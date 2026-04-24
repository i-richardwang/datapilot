/**
 * Web UI confirm dialog — imperative API backed by a Radix Dialog host.
 *
 * The adapter (web-api.ts) can't render React itself, so it calls
 * `requestConfirmDialog(...)` which resolves once the user picks an option in
 * the host component mounted near the app root. Visually this matches the
 * project's other Radix Dialog confirmations (e.g. delete-automation) — same
 * overlay, sizing, buttons, focus/ESC behavior.
 */

import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface ConfirmDialogOptions {
  /** Already-translated title text shown in the dialog header. */
  title: string
  /** Already-translated label for the confirm button. */
  confirmLabel: string
  /** If true, the confirm button uses the destructive variant. */
  destructive?: boolean
}

interface ConfirmRequest extends ConfirmDialogOptions {
  resolve: (value: boolean) => void
}

let currentRequest: ConfirmRequest | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ConfirmRequest | null {
  return currentRequest
}

function notify(): void {
  for (const listener of listeners) listener()
}

function settle(value: boolean): void {
  const req = currentRequest
  if (!req) return
  currentRequest = null
  notify()
  req.resolve(value)
}

export function requestConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  // Only one confirm dialog at a time — if another request is already pending,
  // treat it as cancelled so its caller doesn't hang.
  if (currentRequest) {
    const prev = currentRequest
    currentRequest = null
    prev.resolve(false)
  }
  return new Promise<boolean>((resolve) => {
    currentRequest = { ...options, resolve }
    notify()
  })
}

export function ConfirmDialogHost() {
  const request = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const { t } = useTranslation()

  const open = request !== null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false)
      }}
    >
      <DialogContent showCloseButton={false} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{request?.title ?? ''}</DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => settle(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={request?.destructive ? 'destructive' : 'default'}
            onClick={() => settle(true)}
          >
            {request?.confirmLabel ?? ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
