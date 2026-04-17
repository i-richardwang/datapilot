import type { PlatformServices } from '../runtime/platform'
import type { ISessionManager } from './session-manager-interface'
import type { IOAuthFlowStore } from './oauth-flow-store-interface'
import type { IBrowserPaneManager } from './browser-pane-manager-interface'
import type { IWindowManager } from './window-manager-interface'

/**
 * Narrow dep bag for handlers that only touch platform services.
 *
 * Handlers that accept this type today: labels, sources, skills,
 * permissions, statuses, transfer, onboarding. None of these reach into
 * SessionManager / WindowManager / BrowserPaneManager / OAuthFlowStore,
 * so Phase 3's embedded CLI can register them without pulling in the
 * heavyweight managers (which carry Electron / browser-pane /
 * agent-runtime weight that doesn't belong in a one-shot CLI process).
 *
 * Everything else — automations, batches, oauth, resources, server,
 * sessions, workspace (core) — takes the full `HandlerDeps` because the
 * handlers genuinely need SessionManager (executePromptAutomation,
 * ensureBatchProcessor, workspace registry, reinitializeAuth, …) or
 * OAuthFlowStore. The five `RpcServer`-requiring handlers (auth, files,
 * llm-connections, settings, system) also take `HandlerDeps` because
 * they need sessionManager or windowManager in addition to the WS
 * client-capability surface.
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
