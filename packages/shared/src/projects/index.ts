/**
 * Projects Module
 *
 * Public exports for project management.
 */

export type {
  ProjectConfig,
  ProjectAsset,
  CreateProjectInput,
  LoadedProject,
  ProjectPromptContext,
} from './types.ts';

// SQLite-backed storage (storage.db.ts) is the active implementation.
// Configs live in the workspace.db projects table; assets/ and MEMORY.md stay
// on disk under the project folder. storage.ts is the upstream file-based
// implementation, kept as-is for cheap merges — port semantic changes to
// storage.db.ts instead of editing call sites.
export {
  // Path utilities
  ensureProjectsDir,
  ensureProjectAssetsDir,
  getWorkspaceProjectsPath,
  getProjectPath,
  getProjectAssetsPath,
  getProjectMemoryPath,
  MEMORY_FILENAME,
  // Config operations
  loadProjectConfig,
  saveProjectConfig,
  // Memory operations
  loadProjectMemory,
  // Load operations
  loadProject,
  loadProjectById,
  loadWorkspaceProjects,
  // Create/update/delete
  generateProjectSlug,
  createProject,
  updateProject,
  deleteProject,
  projectExists,
  // Asset operations
  listProjectAssets,
  uploadProjectAsset,
  deleteProjectAsset,
  sanitizeAssetFilename,
} from './storage.ts';

export type { UploadProjectAssetInput } from './storage.ts';
