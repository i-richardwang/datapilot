export type PresetKey = string

/**
 * Preset keys that are regional variants of a canonical Pi auth provider.
 * The Pi SDK recognizes both 'minimax' and 'minimax-cn' as separate providers
 * with distinct base URLs (api.minimax.io vs api.minimaxi.com), so only
 * 'minimax-global' needs aliasing — 'minimax-cn' maps 1:1 to the Pi SDK provider.
 */
const PI_AUTH_PROVIDER_ALIASES: Record<string, string> = {
  'minimax-global': 'minimax',
}

export function resolvePiAuthProviderForSubmit(
  activePreset: PresetKey,
  lastNonCustomPreset: PresetKey | null
): string | undefined {
  if (activePreset === 'custom') {
    // Pi SDK needs a provider hint for auth header formatting even when
    // the URL is user-provided — default to anthropic as the safest baseline.
    const resolved = lastNonCustomPreset && lastNonCustomPreset !== 'custom'
      ? lastNonCustomPreset
      : 'anthropic'
    return PI_AUTH_PROVIDER_ALIASES[resolved] ?? resolved
  }

  return PI_AUTH_PROVIDER_ALIASES[activePreset] ?? activePreset
}

export function resolvePresetStateForBaseUrlChange(params: {
  matchedPreset: PresetKey
  activePreset: PresetKey
  lastNonCustomPreset: PresetKey | null
}): { activePreset: PresetKey; lastNonCustomPreset: PresetKey | null } {
  const { matchedPreset, activePreset, lastNonCustomPreset } = params

  if (matchedPreset !== 'custom') {
    return {
      activePreset: matchedPreset,
      lastNonCustomPreset: matchedPreset,
    }
  }

  // When URL doesn't match any known preset, keep the current preset.
  // Switching to 'custom' would drop piAuthProvider routing metadata
  // (e.g. editing the OpenRouter URL to a proxy would lose the 'openrouter' provider hint).
  return {
    activePreset,
    lastNonCustomPreset,
  }
}
