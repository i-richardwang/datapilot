import type { PlatformServices } from '../runtime/platform'
import type { ISessionManager } from './session-manager-interface'
import type { IOAuthFlowStore } from './oauth-flow-store-interface'
import type { IBrowserPaneManager } from './browser-pane-manager-interface'
import type { IWindowManager } from './window-manager-interface'
import type { IMessagingGatewayRegistry } from './messaging-registry-interface'

/**
 * Narrow dep bag for handlers that only touch platform services.
 *
 * Handlers that accept this type today: labels, sources, skills,
 * permissions, statuses, transfer, onboarding. None of them reach into
 * SessionManager / WindowManager / BrowserPaneManager / OAuthFlowStore.
 *
 * Everything else — automations, batches, oauth, resources, server,
 * sessions, workspace (core), auth, files, llm-connections, settings,
 * system — takes the full `HandlerDeps`.
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
  messagingRegistry?: IMessagingGatewayRegistry
}
