/**
 * Workspace root resolution for datapilot CLI.
 *
 * Resolution order:
 * 1. --workspace-root <path> CLI flag (explicit)
 * 2. CRAFT_WORKSPACE_PATH env var (injected by SessionManager for every agent bash session)
 * 3. CRAFT_AGENT_WORKSPACE_ROOT env var (manual override)
 * 4. Walk up from CWD looking for .datapilot/ dir
 * 5. Fall back to CWD
 */

import { existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

export function resolveWorkspaceRoot(explicitFlag?: string): string {
  if (explicitFlag) {
    return resolve(explicitFlag)
  }

  const craftWorkspacePath = process.env['CRAFT_WORKSPACE_PATH']
  if (craftWorkspacePath) {
    return resolve(craftWorkspacePath)
  }

  const envVar = process.env['CRAFT_AGENT_WORKSPACE_ROOT']
  if (envVar) {
    return resolve(envVar)
  }

  // Walk up from CWD
  let dir = process.cwd()
  while (true) {
    if (existsSync(join(dir, '.datapilot')) || existsSync(join(dir, 'batches.json'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return process.cwd()
}
