import { createContext, useContext } from "react"
import type { LabelConfig } from "@craft-agent/shared/labels"
import type { SessionStatusId, SessionStatus } from "@/config/session-status-config"
import type { SessionMeta } from "@/atoms/sessions"

/**
 * Shared, low-frequency state for SessionItem rows.
 *
 * Keep this context limited to stable callbacks and rarely-changing config:
 * every value change re-renders ALL rows (context consumers bypass
 * React.memo). High-frequency data — search query, content search results,
 * active chat match info, pending-prompt state — is passed to each
 * SessionItem as per-row scalar props (searchQuery / chatMatchCount /
 * hasPendingPrompt) so the row memo comparator can compare scalars.
 */
export interface SessionListContextValue {
  // Session action callbacks (shared across all items)
  onRenameClick: (sessionId: string, currentName: string) => void
  onSessionStatusChange: (sessionId: string, state: SessionStatusId) => void
  onFlag?: (sessionId: string) => void
  onUnflag?: (sessionId: string) => void
  onArchive?: (sessionId: string) => void
  onUnarchive?: (sessionId: string) => void
  onMarkUnread: (sessionId: string) => void
  onDelete: (sessionId: string, skipConfirmation?: boolean) => Promise<boolean>
  onLabelsChange?: (sessionId: string, labels: string[]) => void
  /** Set or clear the project binding for a session (null = unbind) */
  onSetProjectId?: (sessionId: string, projectId: string | null) => void
  /** Available workspace projects for the context-menu submenu */
  projects?: Array<{ id: string; slug: string; name: string; color?: string }>
  onSelectSessionById: (sessionId: string) => void
  onOpenInNewWindow: (item: SessionMeta) => void
  onSendToWorkspace?: (sessionIds: string[]) => void
  onFocusZone: () => void
  onKeyDown: (e: React.KeyboardEvent, item: SessionMeta) => void

  // Shared config
  sessionStatuses: SessionStatus[]
  flatLabels: LabelConfig[]
  labels: LabelConfig[]
  isMultiSelectActive: boolean
}

const SessionListContext = createContext<SessionListContextValue | null>(null)

export function useSessionListContext(): SessionListContextValue {
  const ctx = useContext(SessionListContext)
  if (!ctx) throw new Error("useSessionListContext must be used within SessionList")
  return ctx
}

export const SessionListProvider = SessionListContext.Provider
