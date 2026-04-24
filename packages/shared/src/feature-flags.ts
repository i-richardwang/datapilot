/**
 * Feature flags for controlling experimental or in-development features.
 */

/** Safe accessor for process.env — returns undefined in browser/renderer contexts. */
function getEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) return process.env[key];
  return undefined;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

/**
 * Shared runtime detector for development/debug environments.
 *
 * Use this instead of app-specific debug flags (e.g., Electron main isDebugMode)
 * so behavior stays consistent across shared code and subprocess backends.
 */
export function isDevRuntime(): boolean {
  const nodeEnv = (getEnv('NODE_ENV') || '').toLowerCase();
  return nodeEnv === 'development' || nodeEnv === 'dev' || getEnv('DATAPILOT_DEBUG') === '1';
}

/**
 * Runtime-evaluated check for developer feedback feature.
 * Explicit env override has precedence over dev-runtime defaults.
 */
export function isDeveloperFeedbackEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('CRAFT_FEATURE_DEVELOPER_FEEDBACK'));
  if (override !== undefined) return override;
  return isDevRuntime();
}

/**
 * Runtime-evaluated check for embedded server settings page.
 *
 * Defaults to disabled. Override with CRAFT_FEATURE_EMBEDDED_SERVER=1|0.
 */
export function isEmbeddedServerEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('CRAFT_FEATURE_EMBEDDED_SERVER'));
  if (override !== undefined) return override;
  return false;
}

/**
 * Build-time check: disable OAuth provider tools and onboarding options.
 *
 * Removes the 4 OAuth trigger tools, hides GitHub Copilot from onboarding,
 * and suppresses OAuth-related system prompt guidance. Useful for internal
 * deployments that don't use SaaS OAuth flows.
 * Defaults to disabled. Set DATAPILOT_DISABLE_OAUTH=0 to re-enable.
 */
export function isOauthDisabled(): boolean {
  const override = parseBooleanEnv(process.env.DATAPILOT_DISABLE_OAUTH);
  if (override !== undefined) return override;
  return true;
}

/**
 * Build-time check: disable in-app browser tool.
 *
 * Removes browser_tool and its system prompt reference.
 * Set DATAPILOT_DISABLE_BROWSER=1 at build time to enable.
 */
export function isBrowserDisabled(): boolean {
  const override = parseBooleanEnv(process.env.DATAPILOT_DISABLE_BROWSER);
  if (override !== undefined) return override;
  return false;
}

/**
 * Build-time check: disable validation tools (mermaid_validate, skill_validate).
 *
 * Set DATAPILOT_DISABLE_VALIDATION=1 at build time to enable.
 */
export function isValidationDisabled(): boolean {
  const override = parseBooleanEnv(process.env.DATAPILOT_DISABLE_VALIDATION);
  if (override !== undefined) return override;
  return false;
}

/**
 * Build-time check: disable template tools (render_template, and — when
 * DATAPILOT_DISABLE_SANDBOX is also unset — script_sandbox).
 *
 * Set DATAPILOT_DISABLE_TEMPLATES=1 at build time to enable.
 */
export function isTemplatesDisabled(): boolean {
  const override = parseBooleanEnv(process.env.DATAPILOT_DISABLE_TEMPLATES);
  if (override !== undefined) return override;
  return false;
}

/**
 * Build-time check: disable sandbox tool (script_sandbox).
 *
 * Allows script_sandbox to be disabled independently of render_template.
 * When either disableSandbox or disableTemplates is true, script_sandbox
 * is filtered from the tool list (OR logic).
 *
 * Set DATAPILOT_DISABLE_SANDBOX=1 to disable. Defaults to enabled.
 */
export function isSandboxDisabled(): boolean {
  const override = parseBooleanEnv(process.env.DATAPILOT_DISABLE_SANDBOX);
  if (override !== undefined) return override;
  return false;
}

/**
 * Build-time check: enable streamlined UI.
 *
 * Hides non-essential UI elements (What's New, Help menu) and
 * removes extra default statuses (Backlog, Needs Review).
 * Defaults to enabled. Set DATAPILOT_LITE_UI=0 to disable.
 */
export function isLiteUi(): boolean {
  const override = parseBooleanEnv(process.env.DATAPILOT_LITE_UI);
  if (override !== undefined) return override;
  return true;
}

export const FEATURE_FLAGS = {
  /** Enable Opus 4.7 fast mode (speed:"fast" + beta header). 6x pricing. */
  fastMode: false,
  /**
   * Enable agent developer feedback tool.
   *
   * Defaults to enabled in explicit development runtimes; disabled otherwise.
   * Override with CRAFT_FEATURE_DEVELOPER_FEEDBACK=1|0.
   */
  get developerFeedback(): boolean {
    return isDeveloperFeedbackEnabled();
  },
  /** Disable OAuth provider tools and onboarding options. */
  get disableOauth(): boolean {
    return isOauthDisabled();
  },
  /** Disable in-app browser tool. */
  get disableBrowser(): boolean {
    return isBrowserDisabled();
  },
  /** Disable validation tools (mermaid_validate, skill_validate). */
  get disableValidation(): boolean {
    return isValidationDisabled();
  },
  /** Disable template tools (render_template, and — when disableSandbox is also unset — script_sandbox). */
  get disableTemplates(): boolean {
    return isTemplatesDisabled();
  },
  /** Disable sandbox tool (script_sandbox) independently of templates. */
  get disableSandbox(): boolean {
    return isSandboxDisabled();
  },
  /** Streamlined UI — hides non-essential elements and extra statuses. */
  get liteUi(): boolean {
    return isLiteUi();
  },
  /**
   * Enable embedded server settings page.
   *
   * Defaults to disabled. Override with CRAFT_FEATURE_EMBEDDED_SERVER=1|0.
   */
  get embeddedServer(): boolean {
    return isEmbeddedServerEnabled();
  },
} as const;
