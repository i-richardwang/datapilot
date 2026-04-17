import type { PlatformServices } from '../runtime/platform'
import type { ISessionManager } from './session-manager-interface'
import type { IOAuthFlowStore } from './oauth-flow-store-interface'
import type { IBrowserPaneManager } from './browser-pane-manager-interface'
import type { IWindowManager } from './window-manager-interface'

/**
 * Narrow dep bag for handlers that only touch platform services.
 *
 * Entity handlers (labels, sources, automations, batches, skills,
 * permissions, statuses, transfer, llm-connections, onboarding, auth)
 * accept this. Embedded transports can build it without pulling in
 * SessionManager / WindowManager / BrowserPaneManager — those carry
 * Electron / browser-pane / agent-runtime weight that doesn't belong in
 * a one-shot CLI process.
 *
 * Hosts that need only the entity surface should populate just `platform`.
 */
export interface EntityHandlerDeps {
  platform: PlatformServices
}

/**
 * Full handler dependency bag.
 *
 * Concrete hosts specialize the generics to their runtime implementations;
 * Electron narrows them to its concrete classes, while headless server-core
 * keeps the interface defaults.
 *
 * Handlers that genuinely need the session manager (sessions, settings,
 * automations executor, batches), the window manager (files, sessions,
 * system, workspace), the browser pane manager, or the OAuth flow store
 * (oauth) accept this richer shape.
 */
export interface HandlerDeps<
  TSessionManager extends ISessionManager = ISessionManager,
  TOAuthFlowStore extends IOAuthFlowStore = IOAuthFlowStore,
  TWindowManager extends IWindowManager = IWindowManager,
  TBrowserPaneManager extends IBrowserPaneManager = IBrowserPaneManager,
> extends EntityHandlerDeps {
  sessionManager: TSessionManager
  windowManager?: TWindowManager
  browserPaneManager?: TBrowserPaneManager
  oauthFlowStore: TOAuthFlowStore
}
