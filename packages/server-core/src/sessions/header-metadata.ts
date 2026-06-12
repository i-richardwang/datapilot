import type { SessionHeader } from '@craft-agent/shared/sessions'

/**
 * Whether an incoming session header differs from the in-memory session state
 * on any of the fields applyExternalSessionMetadata would apply (labels,
 * isFlagged, sessionStatus, name). Comparison semantics mirror that method
 * exactly.
 *
 * Used to drop persistence echoes in DB mode: the DB adapter has no write
 * signatures (getLastWrittenSignature returns undefined), so every save —
 * including our own turn-end persists — comes back through the watcher as a
 * potential "external" change. An echo that matches memory must be a no-op:
 * deferring it into pendingExternalMetadata during the post-set_session_status
 * write-guard window would block hibernation forever when no later turn runs
 * to clear it (the stuck-subprocess leak observed in production).
 */
export function headerMetadataDiffers(
  current: { labels?: string[]; isFlagged?: boolean; sessionStatus?: string; name?: string },
  header: SessionHeader,
): boolean {
  return (
    JSON.stringify(current.labels ?? []) !== JSON.stringify(header.labels ?? []) ||
    (current.isFlagged ?? false) !== (header.isFlagged ?? false) ||
    current.sessionStatus !== header.sessionStatus ||
    current.name !== header.name
  )
}
