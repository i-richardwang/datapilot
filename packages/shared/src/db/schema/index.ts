/**
 * Schema Index
 *
 * Re-exports all table definitions for use in Drizzle queries and migrations.
 */

// Workspace config
export { workspaceConfig } from './workspace-config.sql.ts';

// Statuses
export { statuses, statusMeta } from './statuses.sql.ts';

// Labels
export { labelConfig } from './labels.sql.ts';

// Views
export { viewsConfig } from './views.sql.ts';

// Sources
export { sources } from './sources.sql.ts';

// Sessions
export { sessions, messages, turnUsage } from './sessions.sql.ts';

// Automations
export { automationHistory } from './automations.sql.ts';

// Batches
export { batchState, batchTestResults } from './batches.sql.ts';
