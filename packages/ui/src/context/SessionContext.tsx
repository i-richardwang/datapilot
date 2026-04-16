/**
 * SessionContext — scopes rendered UI (Markdown, HTMLPreviewOverlay, etc.)
 * to a specific chat session so components can dispatch session-scoped
 * commands (HTML sharing, …) without prop-drilling.
 *
 * Wrapping is optional: components that can render outside a chat (e.g.
 * web viewer, standalone previews) should hide or degrade their
 * session-scoped actions when the context is missing.
 */

import { createContext, useContext, type ReactNode } from 'react'

/** One shared HTML artifact entry. */
export interface HtmlShareEntry {
  sharedUrl: string
  sharedId: string
}

export interface SessionContextValue {
  /** ID of the session this subtree is rendering. */
  sessionId: string
  /**
   * Shared HTML artifacts for this session, keyed by sha256(html) content hash.
   * Defaults to an empty object when the session has no shares.
   */
  htmlShares: Record<string, HtmlShareEntry>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export interface SessionProviderProps {
  value: SessionContextValue
  children: ReactNode
}

export function SessionProvider({ value, children }: SessionProviderProps) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/** Returns the ambient session context, or null if none is provided. */
export function useSessionContext(): SessionContextValue | null {
  return useContext(SessionContext)
}

export default SessionContext
