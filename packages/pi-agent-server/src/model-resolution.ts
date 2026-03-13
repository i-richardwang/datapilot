import type { ModelRegistry as PiModelRegistry } from '@mariozechner/pi-coding-agent';

// Re-export the PiModel type used by callers
type PiModel<T = any> = ReturnType<PiModelRegistry['find']>;

/**
 * Resolve a Pi SDK model from the registry, with optional custom-endpoint precedence.
 *
 * Resolution order:
 * 1. If `preferCustomEndpoint` is true, try `'custom-endpoint'` provider first
 * 2. Exact provider+model lookup via `piAuthProvider`
 * 3. Full `getAll()` scan by id/name
 * 4. Common provider fallback list (includes 'custom-endpoint')
 */
export function resolvePiModel(
  modelRegistry: PiModelRegistry,
  modelId: string,
  piAuthProvider?: string,
  preferCustomEndpoint?: boolean,
): PiModel | undefined {
  // Strip Craft's pi/ prefix — Pi SDK uses bare model IDs (e.g. "claude-sonnet-4-6")
  const bareId = modelId.startsWith('pi/') ? modelId.slice(3) : modelId;

  // Custom-endpoint takes precedence when configured
  if (preferCustomEndpoint) {
    const custom = modelRegistry.find('custom-endpoint', bareId);
    if (custom) return custom;
  }

  // If we know the auth provider, do an exact provider+model lookup first.
  // This avoids the getAll() ambiguity where the same model ID exists under
  // multiple providers (e.g., "gpt-5.2" under both "openai" and
  // "azure-openai-responses") and the wrong one matches first.
  if (piAuthProvider) {
    const exact = modelRegistry.find(piAuthProvider, bareId);
    if (exact) {
      // MiniMax CN API rejects model IDs with the 'MiniMax-' prefix (e.g. 500 for
      // 'MiniMax-M2.5-highspeed') but accepts bare names ('M2.5-highspeed').
      if (piAuthProvider === 'minimax-cn' && exact.id.startsWith('MiniMax-')) {
        return { ...exact, id: exact.id.slice('MiniMax-'.length) };
      }
      return exact;
    }
  }

  // Fallback: search all available models
  const allModels = modelRegistry.getAll();
  const match = allModels.find(m => m.id === bareId || m.name === bareId);
  if (match) return match;

  // Try common providers with the model ID
  const providers = ['custom-endpoint', 'anthropic', 'openai', 'google'];
  for (const provider of providers) {
    const model = modelRegistry.find(provider, bareId);
    if (model) return model;
  }

  return undefined;
}
