/**
 * Centralized branding assets for DataPilot
 * Used by OAuth callback pages
 */

export const DATAPILOT_LOGO = [
  '  ████████ █████████    ██████   ██████████ ██████████',
  '██████████ ██████████ ██████████ █████████  ██████████',
  '██████     ██████████ ██████████ ████████   ██████████',
  '██████████ ████████   ██████████ ███████      ██████  ',
  '  ████████ ████  ████ ████  ████ █████        ██████  ',
] as const;

/** Logo as a single string for HTML templates */
export const DATAPILOT_LOGO_HTML = DATAPILOT_LOGO.map((line) => line.trimEnd()).join('\n');

/** Session viewer base URL (override with DATAPILOT_VIEWER_URL env var for self-hosted deployments) */
export const VIEWER_URL = process.env.DATAPILOT_VIEWER_URL ?? 'https://agents.craft.do';
