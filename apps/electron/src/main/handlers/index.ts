import type { HandlerDeps } from './handler-deps'
import type { RpcServer } from '@craft-agent/server-core/transport'
import {
  registerServerCoreRpcHandlers,
  type ServerHandlerContext,
} from '@craft-agent/server-core/handlers/rpc'
export { registerServerCoreRpcHandlers }

// GUI-only handlers remain local (Electron-specific imports)
import { registerSystemGuiHandlers } from './system'
import { registerWorkspaceGuiHandlers } from './workspace'
import { registerBrowserHandlers } from './browser'
import { registerSettingsGuiHandlers } from './settings'

export function registerGuiRpcHandlers(server: RpcServer, deps: HandlerDeps): void {
  registerSystemGuiHandlers(server, deps)
  registerWorkspaceGuiHandlers(server, deps)
  registerBrowserHandlers(server, deps)
  registerSettingsGuiHandlers(server, deps)
}

export function registerAllRpcHandlers(server: RpcServer, deps: HandlerDeps, serverCtx?: ServerHandlerContext): void {
  registerServerCoreRpcHandlers(server, deps, serverCtx)
  registerGuiRpcHandlers(server, deps)
}
