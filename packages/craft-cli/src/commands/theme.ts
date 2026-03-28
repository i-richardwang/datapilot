/**
 * Theme commands — 8 subcommands
 *
 * Storage: Filesystem JSON (theme.json, config.json)
 */

import { existsSync, unlinkSync } from 'node:fs'
import { ok, fail } from '../envelope.ts'
import { strFlag } from '../args.ts'
import { parseInput } from '../input.ts'
import {
  resolveTheme,
  type ThemeOverrides,
} from '@craft-agent/shared/config'
import {
  loadAppTheme,
  saveAppTheme,
  getAppThemePath,
  loadPresetThemes,
  loadPresetTheme,
  getColorTheme,
  setColorTheme,
} from '@craft-agent/shared/config'
import { loadWorkspaceConfig, saveWorkspaceConfig } from '@craft-agent/shared/workspaces'

export function routeTheme(
  ws: string,
  action: string | undefined,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): void {
  if (!action) fail('USAGE_ERROR', 'Missing action', 'datapilot theme <get|validate|list-presets|get-preset|set-color-theme|set-workspace-color-theme|set-override|reset-override>')

  switch (action) {
    case 'get': return cmdGet(ws)
    case 'validate': return cmdValidate(flags)
    case 'list-presets': return cmdListPresets()
    case 'get-preset': return cmdGetPreset(positionals)
    case 'set-color-theme': return cmdSetColorTheme(positionals)
    case 'set-workspace-color-theme': return cmdSetWorkspaceColorTheme(ws, positionals)
    case 'set-override': return cmdSetOverride(flags)
    case 'reset-override': return cmdResetOverride()
    default:
      fail('USAGE_ERROR', `Unknown theme action: ${action}`)
  }
}

// ─── get ─────────────────────────────────────────────────────────────────────

function cmdGet(ws: string): void {
  const appTheme = loadAppTheme()
  const resolved = resolveTheme(appTheme ?? undefined)
  const appColorTheme = getColorTheme()

  // Get workspace colorTheme override
  const wsConfig = loadWorkspaceConfig(ws)
  const wsColorTheme = wsConfig?.defaults?.colorTheme

  ok({
    appColorTheme,
    workspaceColorTheme: wsColorTheme ?? null,
    appOverridePath: getAppThemePath(),
    hasAppOverride: appTheme !== null,
    resolved,
  })
}

// ─── validate ────────────────────────────────────────────────────────────────

function cmdValidate(flags: Record<string, string | boolean | string[]>): void {
  const presetId = strFlag(flags, 'preset')

  if (presetId) {
    // Validate a preset
    const preset = loadPresetTheme(presetId)
    if (!preset) fail('NOT_FOUND', `Preset '${presetId}' not found`)
    const errors = validateThemeOverrides(preset.theme as ThemeOverrides)
    ok({ valid: errors.length === 0, preset: presetId, errors })
    return
  }

  // Validate app override
  const appTheme = loadAppTheme()
  if (!appTheme) {
    ok({ valid: true, note: 'No app override file' })
    return
  }

  const errors = validateThemeOverrides(appTheme)
  ok({ valid: errors.length === 0, path: getAppThemePath(), errors })
}

// ─── list-presets ────────────────────────────────────────────────────────────

function cmdListPresets(): void {
  const presets = loadPresetThemes()
  ok(presets.map(p => ({
    id: p.id,
    path: p.path,
  })))
}

// ─── get-preset ──────────────────────────────────────────────────────────────

function cmdGetPreset(positionals: string[]): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing preset id', 'datapilot theme get-preset <id>')

  const preset = loadPresetTheme(id)
  if (!preset) fail('NOT_FOUND', `Preset '${id}' not found`)
  ok(preset)
}

// ─── set-color-theme ─────────────────────────────────────────────────────────

function cmdSetColorTheme(positionals: string[]): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing preset id', 'datapilot theme set-color-theme <id>')

  // Validate preset exists (unless 'default')
  if (id !== 'default') {
    const preset = loadPresetTheme(id)
    if (!preset) fail('NOT_FOUND', `Preset '${id}' not found`)
  }

  setColorTheme(id)
  ok({ colorTheme: id })
}

// ─── set-workspace-color-theme ───────────────────────────────────────────────

function cmdSetWorkspaceColorTheme(ws: string, positionals: string[]): void {
  const id = positionals[0]
  if (!id) fail('USAGE_ERROR', 'Missing preset id', 'datapilot theme set-workspace-color-theme <id|default>')

  const wsConfig = loadWorkspaceConfig(ws)
  if (!wsConfig) fail('INTERNAL_ERROR', 'Could not load workspace config')

  // 'default' means clear the override (inherit from app)
  if (id === 'default') {
    if (wsConfig.defaults) {
      delete wsConfig.defaults.colorTheme
    }
  } else {
    // Validate preset exists
    const preset = loadPresetTheme(id)
    if (!preset) fail('NOT_FOUND', `Preset '${id}' not found`)

    if (!wsConfig.defaults) wsConfig.defaults = {}
    wsConfig.defaults.colorTheme = id
  }

  saveWorkspaceConfig(ws, wsConfig)
  ok({ workspaceColorTheme: id === 'default' ? null : id })
}

// ─── set-override ────────────────────────────────────────────────────────────

function cmdSetOverride(flags: Record<string, string | boolean | string[]>): void {
  const input = parseInput(flags)
  if (!input) fail('USAGE_ERROR', 'Missing --json', 'datapilot theme set-override --json \'{...}\'')

  const theme = input as ThemeOverrides
  const errors = validateThemeOverrides(theme)
  if (errors.length > 0) {
    fail('VALIDATION_ERROR', `Invalid theme: ${errors.join(', ')}`)
  }

  saveAppTheme(theme)
  ok({ path: getAppThemePath(), theme })
}

// ─── reset-override ──────────────────────────────────────────────────────────

function cmdResetOverride(): void {
  const path = getAppThemePath()
  if (!existsSync(path)) {
    ok({ reset: false, note: 'No override file to reset' })
    return
  }

  unlinkSync(path)
  ok({ reset: true, path })
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const CSS_COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|rgb\(|rgba\(|hsl\(|hsla\(|oklch\(|[a-z]+$)/

function validateThemeOverrides(theme: ThemeOverrides): string[] {
  const errors: string[] = []
  const colorKeys = ['background', 'foreground', 'accent', 'info', 'success', 'destructive', 'paper', 'navigator', 'input', 'popover', 'popoverSolid'] as const

  for (const key of colorKeys) {
    const value = (theme as Record<string, unknown>)[key]
    if (value !== undefined && typeof value === 'string' && !CSS_COLOR_PATTERN.test(value)) {
      errors.push(`Invalid CSS color for ${key}: ${value}`)
    }
  }

  // Validate dark overrides
  if (theme.dark) {
    for (const key of colorKeys) {
      const value = (theme.dark as Record<string, unknown>)[key]
      if (value !== undefined && typeof value === 'string' && !CSS_COLOR_PATTERN.test(value)) {
        errors.push(`Invalid CSS color for dark.${key}: ${value}`)
      }
    }
  }

  return errors
}
