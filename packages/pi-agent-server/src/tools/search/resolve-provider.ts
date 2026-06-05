/**
 * [fork] Builds an ordered cascade of web search providers.
 *
 * Cascade order: TinyFish → Firecrawl → Tavily → Exa → DuckDuckGo
 *   - TinyFish / Firecrawl / Tavily / Exa are included only when their API key
 *     env var is set.
 *   - DuckDuckGo is always the final fallback (no key required).
 *
 * The cascade is consumed by `createSearchTool(providers[])`, which tries each
 * provider in order and returns the first successful result. Errors at any tier
 * are logged server-side; the LLM only sees the successful provider's output via
 * the `(via <name>)` attribution line.
 *
 * Upstream parity (commented out below): the original `resolveSearchProvider`
 * routed to LLM-native search (OpenAI Responses API / ChatGPT backend / Google
 * Gemini grounding) based on `piAuthProvider`. The fork retires that path because:
 *   1. Custom OpenAI-compat gateways set `piAuthProvider='openai'` for wire routing
 *      but the API key is for the gateway, not api.openai.com — sending it leaks
 *      key fragments via 401 responses (see commit 08177d4c).
 *   2. Dedicated search APIs (Tavily/TinyFish/Exa) give better quality at lower
 *      LLM token cost than running web_search through the LLM provider's tool.
 *
 * The provider implementation files (providers/openai.ts, chatgpt.ts, google.ts,
 * responses-api-parser.ts) are kept on disk but no longer imported, so re-enabling
 * the LLM-native cascade is a small, traceable diff against this file.
 */

import type { WebSearchProvider } from './types.ts';
import { parseKeys } from '../shared/key-pool.ts';
import { DDGSearchProvider } from './providers/ddg.ts';
import { TinyFishSearchProvider } from './providers/tinyfish.ts';
import { FirecrawlSearchProvider } from './providers/firecrawl.ts';
import { TavilySearchProvider } from './providers/tavily.ts';
import { ExaSearchProvider } from './providers/exa.ts';

// [fork] Upstream-parity legacy imports — used only by the commented-out
// `resolveSearchProvider` below. Re-enable alongside that function if the
// LLM-native cascade is ever restored.
// import { ResponsesApiSearchProvider } from './providers/openai.ts';
// import { ChatGPTBackendSearchProvider, extractChatGptAccountId } from './providers/chatgpt.ts';
// import { GoogleSearchProvider } from './providers/google.ts';

export interface ResolveSearchProvidersOptions {
  /** Override env lookup (test injection). */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

/**
 * Resolve the active search-provider cascade based on environment variables.
 * Always returns a non-empty array (DDG is the universal fallback).
 *
 * Each key var may hold a comma-separated list of keys (`parseKeys`); the vendor
 * is added to the cascade once and picks one key per request at random (see
 * `shared/key-pool.ts`). A single key behaves exactly as before.
 */
export function resolveSearchProviders(
  options: ResolveSearchProvidersOptions = {},
): WebSearchProvider[] {
  const env = options.env ?? process.env;
  const chain: WebSearchProvider[] = [];

  const tinyfishKeys = parseKeys(env.TINYFISH_API_KEY);
  if (tinyfishKeys.length > 0) {
    chain.push(new TinyFishSearchProvider({ apiKey: tinyfishKeys }));
  }

  const firecrawlKeys = parseKeys(env.FIRECRAWL_API_KEY);
  if (firecrawlKeys.length > 0) {
    chain.push(new FirecrawlSearchProvider({ apiKey: firecrawlKeys }));
  }

  const tavilyKeys = parseKeys(env.TAVILY_API_KEY);
  if (tavilyKeys.length > 0) {
    chain.push(new TavilySearchProvider({ apiKey: tavilyKeys }));
  }

  const exaKeys = parseKeys(env.EXA_API_KEY);
  if (exaKeys.length > 0) {
    chain.push(new ExaSearchProvider({ apiKey: exaKeys }));
  }

  chain.push(new DDGSearchProvider());
  return chain;
}

// =============================================================================
// [fork] Legacy upstream resolver — retired in this fork. Kept for upstream
// rebase visibility. See module docstring for the rationale.
// =============================================================================
//
// export type SearchProviderCredential =
//   | { type: 'api_key'; key: string }
//   | { type: 'oauth'; access: string; refresh: string; expires: number }
//   | { type: string; key?: string; access?: string };
//
// export interface SearchProviderAuthConfig {
//   provider?: string;
//   credential?: SearchProviderCredential;
//   /**
//    * [fork] Custom endpoint base URL — flagged custom OpenAI/Anthropic-compat
//    * gateways so the resolver could skip the LLM-native branch and avoid leaking
//    * gateway keys to api.openai.com. Moot now that LLM-native is retired entirely.
//    */
//   baseUrl?: string;
// }
//
// function getApiKey(piAuth?: SearchProviderAuthConfig): string | undefined {
//   if (piAuth?.credential?.type !== 'api_key') return undefined;
//   return typeof piAuth.credential.key === 'string' && piAuth.credential.key.length > 0
//     ? piAuth.credential.key
//     : undefined;
// }
//
// function getOAuthAccess(piAuth?: SearchProviderAuthConfig): string | undefined {
//   if (piAuth?.credential?.type !== 'oauth') return undefined;
//   const access = (piAuth.credential as { access?: string }).access;
//   return typeof access === 'string' && access.length > 0 ? access : undefined;
// }
//
// function getOpenAiCodexAccessToken(piAuth?: SearchProviderAuthConfig): string | undefined {
//   if (piAuth?.provider !== 'openai-codex') return undefined;
//   return getOAuthAccess(piAuth) ?? getApiKey(piAuth);
// }
//
// export function resolveSearchProvider(piAuth?: SearchProviderAuthConfig): WebSearchProvider {
//   const provider = piAuth?.provider;
//   const apiKey = getApiKey(piAuth);
//   const openAiCodexAccess = getOpenAiCodexAccessToken(piAuth);
//   const hasCustomEndpoint =
//     typeof piAuth?.baseUrl === 'string' && piAuth.baseUrl.trim().length > 0;
//   if (hasCustomEndpoint) return new DDGSearchProvider();
//   if (provider === 'openai' && apiKey) {
//     return new ResponsesApiSearchProvider({
//       apiBase: 'https://api.openai.com/v1',
//       apiKey,
//     });
//   }
//   if (provider === 'openai-codex' && openAiCodexAccess) {
//     const accountId = extractChatGptAccountId(openAiCodexAccess);
//     if (accountId) return new ChatGPTBackendSearchProvider(openAiCodexAccess, accountId);
//   }
//   if (provider === 'openrouter' && apiKey) {
//     return new ResponsesApiSearchProvider({
//       apiBase: 'https://openrouter.ai/api/v1',
//       apiKey,
//       model: 'openai/gpt-4o-mini',
//     });
//   }
//   if (provider === 'google' && apiKey) return new GoogleSearchProvider(apiKey);
//   return new DDGSearchProvider();
// }
