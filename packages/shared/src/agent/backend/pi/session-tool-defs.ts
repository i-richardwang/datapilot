/**
 * Pi Session Tool Proxy Definitions
 *
 * Thin wrapper around the canonical tool definitions in @craft-agent/session-tools-core.
 * Adds the `mcp__session__` prefix that the Pi SDK expects.
 */

import {
  getToolDefsAsJsonSchema,
  SESSION_TOOL_NAMES,
  type JsonSchemaToolDef,
} from '@craft-agent/session-tools-core';
import { FEATURE_FLAGS } from '../../../feature-flags.ts';

export type SessionToolProxyDef = JsonSchemaToolDef;

export { SESSION_TOOL_NAMES };

export function getSessionToolProxyDefs(opts?: { includeBatchOutput?: boolean; batchMode?: boolean }): SessionToolProxyDef[] {
  return getToolDefsAsJsonSchema({
    prefix: 'mcp__session__',
    includeDeveloperFeedback: FEATURE_FLAGS.developerFeedback,
    includeBatchOutput: opts?.includeBatchOutput,
    batchMode: opts?.batchMode,
    disableOauth: FEATURE_FLAGS.disableOauth,
    disableBrowser: FEATURE_FLAGS.disableBrowser,
    disableValidation: FEATURE_FLAGS.disableValidation,
    disableTemplates: FEATURE_FLAGS.disableTemplates,
  });
}
