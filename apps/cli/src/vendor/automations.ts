/**
 * Valid automation event names, vendored from `@craft-agent/shared/automations`.
 *
 * Keep in sync with `packages/shared/src/automations/types.ts` (APP_EVENTS +
 * AGENT_EVENTS) and `schemas.ts` (DEPRECATED_EVENT_ALIASES keys). This is only
 * used to render the error message when `datapilot automation create` is
 * invoked without a valid `--event`.
 */

export const VALID_EVENTS: readonly string[] = [
  // App events
  'LabelAdd',
  'LabelRemove',
  'LabelConfigChange',
  'PermissionModeChange',
  'FlagChange',
  'SessionStatusChange',
  'SchedulerTick',
  // Agent events
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PermissionRequest',
  'Setup',
  // Deprecated aliases (still accepted for backward compatibility)
  'TodoStateChange',
]
