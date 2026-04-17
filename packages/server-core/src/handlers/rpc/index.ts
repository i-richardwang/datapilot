import type { RpcDispatcher } from '@craft-agent/rpc-engine'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

import { registerAuthHandlers } from './auth'
import { registerAutomationsHandlers } from './automations'
import { registerBatchesHandlers } from './batches'
import { registerFilesHandlers } from './files'
import { registerLabelsHandlers } from './labels'
import { registerLlmConnectionsHandlers } from './llm-connections'
import { registerOAuthHandlers } from './oauth'
import { registerPermissionsHandlers } from './permissions'
import { registerResourcesHandlers } from './resources'
import { registerOnboardingHandlers } from './onboarding'
import { registerSessionsHandlers } from './sessions'
export { registerSessionsHandlers, cleanupSessionFileWatchForClient } from './sessions'
import { registerServerHandlers } from './server'
import type { ServerHandlerContext } from '../../bootstrap/headless-start'
export type { ServerHandlerContext } from '../../bootstrap/headless-start'
export { getHealthCheck } from './server'
import { registerSettingsHandlers } from './settings'
import { registerSkillsHandlers } from './skills'
import { registerSourcesHandlers } from './sources'
import { registerStatusesHandlers } from './statuses'
import { registerSystemCoreHandlers } from './system'
import { registerTransferHandlers } from './transfer'
import { registerWorkspaceCoreHandlers } from './workspace'

/**
 * Register all handlers whose implementations only need the
 * transport-agnostic `RpcDispatcher` facade — no `RpcServer` dependency
 * and no WS-only capabilities. Handlers that call back into clients via
 * `invokeClient` live in `registerClientCapabilityHandlers`.
 */
export function registerCoreRpcHandlers(
  dispatcher: RpcDispatcher,
  deps: HandlerDeps,
  serverCtx?: ServerHandlerContext,
): void {
  registerAutomationsHandlers(dispatcher, deps)
  registerBatchesHandlers(dispatcher, deps)
  registerLabelsHandlers(dispatcher, deps)
  registerOAuthHandlers(dispatcher, deps)
  registerOnboardingHandlers(dispatcher, deps)
  registerPermissionsHandlers(dispatcher, deps)
  registerResourcesHandlers(dispatcher, deps)
  registerSessionsHandlers(dispatcher, deps)
  if (serverCtx) registerServerHandlers(dispatcher, deps, serverCtx)
  registerSkillsHandlers(dispatcher, deps)
  registerSourcesHandlers(dispatcher, deps)
  registerStatusesHandlers(dispatcher, deps)
  registerTransferHandlers(dispatcher)
  registerWorkspaceCoreHandlers(dispatcher, deps)
}

/**
 * Register handlers that depend on the WS transport's client-capability
 * surface (native confirm / open / save dialogs, open-external URL,
 * client-scoped `invokeClient`). Kept separate so the shared
 * registration entry stays typed against `RpcDispatcher`.
 */
export function registerClientCapabilityHandlers(
  server: RpcServer,
  deps: HandlerDeps,
): void {
  registerAuthHandlers(server, deps)
  registerFilesHandlers(server, deps)
  registerLlmConnectionsHandlers(server, deps)
  registerSettingsHandlers(server, deps)
  registerSystemCoreHandlers(server, deps)
}
