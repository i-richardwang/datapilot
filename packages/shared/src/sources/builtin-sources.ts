/**
 * Built-in Sources
 *
 * Previously hosted the craft-agents-docs built-in source, then it became an
 * always-available MCP server in claude-agent.ts. That MCP has now also been
 * disabled. This file is kept as a no-op for backwards compatibility — all
 * functions return empty/false. Safe to delete once all callers are removed.
 */

import type { LoadedSource, FolderSourceConfig } from './types.ts';

/**
 * Get all built-in sources for a workspace.
 *
 * Returns empty array - no built-in sources exist anymore.
 *
 * @param _workspaceId - The workspace ID (unused)
 * @param _workspaceRootPath - Absolute path to workspace root folder (unused)
 * @returns Empty array (no built-in sources)
 */
export function getBuiltinSources(_workspaceId: string, _workspaceRootPath: string): LoadedSource[] {
  return [];
}

/**
 * Get the built-in DataPilot docs source.
 *
 * @deprecated craft-agents-docs MCP has been disabled. This function is kept
 * for backwards compatibility but returns an unreachable placeholder
 * (isBuiltinSource returns false, so this is never called).
 */
export function getDocsSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  // Return a placeholder - this shouldn't be called anymore
  const placeholderConfig: FolderSourceConfig = {
    id: 'builtin-craft-agents-docs',
    name: 'DataPilot Docs',
    slug: 'craft-agents-docs',
    enabled: false,
    provider: 'mintlify',
    type: 'mcp',
    mcp: {
      transport: 'http',
      url: 'https://agents.craft.do/docs/mcp',
      authType: 'none',
    },
    tagline: 'Search DataPilot documentation and source setup guides',
    icon: '📚',
    isAuthenticated: true,
    connectionStatus: 'connected',
  };

  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '',
    config: placeholderConfig,
    guide: { raw: '' },
    isBuiltin: true,
  };
}

/**
 * Check if a source slug is a built-in source.
 *
 * Returns false unconditionally — there are no built-in sources anymore.
 *
 * @param _slug - Source slug to check (unused)
 * @returns false (no built-in sources)
 */
export function isBuiltinSource(_slug: string): boolean {
  return false;
}
