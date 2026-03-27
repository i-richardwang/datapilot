/**
 * Centralized branding assets for DataPilot
 * Used by OAuth callback pages
 */

export const CRAFT_LOGO = [
  '  ████████ █████████    ██████   ██████████ ██████████',
  '██████████ ██████████ ██████████ █████████  ██████████',
  '██████     ██████████ ██████████ ████████   ██████████',
  '██████████ ████████   ██████████ ███████      ██████  ',
  '  ████████ ████  ████ ████  ████ █████        ██████  ',
] as const;

/** Logo as a single string for HTML templates */
export const CRAFT_LOGO_HTML = CRAFT_LOGO.map((line) => line.trimEnd()).join('\n');

/** Session viewer base URL (override with CRAFT_VIEWER_URL env var for self-hosted deployments) */
export const VIEWER_URL = process.env.CRAFT_VIEWER_URL ?? 'https://agents.craft.do';
