/**
 * [fork] Builds an ordered cascade of HTML-fetch providers for web_fetch.
 *
 * Cascade order: TinyFish → Firecrawl → Tavily → Exa
 *   - Each is included only when its API key env var is set.
 *   - Empty cascade is valid: when no key is configured, web_fetch falls back
 *     to its local fetch+Turndown path (handled in web-fetch.ts), so the
 *     pre-fork behavior is preserved bit-for-bit.
 *
 * Unlike the search cascade (`tools/search/resolve-provider.ts`), there is no
 * universal in-process fallback in this list. The local-fetch path lives inside
 * the web_fetch orchestrator because it also handles PDF / image / JSON / plain
 * text — content types the remote backends cannot return. Treating it as just
 * another HTML provider would lose that asymmetry.
 *
 * Env keys are shared with the corresponding search providers (one key per
 * vendor covers both search and fetch):
 *   TINYFISH_API_KEY, FIRECRAWL_API_KEY, TAVILY_API_KEY, EXA_API_KEY.
 */
// [fork] new file

import type { HtmlFetchProvider } from './types.ts';
import { parseKeys } from '../shared/key-pool.ts';
import { TinyFishFetchProvider } from './providers/tinyfish.ts';
import { FirecrawlFetchProvider } from './providers/firecrawl.ts';
import { TavilyFetchProvider } from './providers/tavily.ts';
import { ExaFetchProvider } from './providers/exa.ts';

export interface ResolveHtmlFetchProvidersOptions {
  /** Override env lookup (test injection). */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

/**
 * Resolve the active HTML-fetch provider cascade based on environment variables.
 * Returns an empty array when no keys are configured — the caller MUST treat that
 * as "skip cascade, go straight to local fetch."
 *
 * Each key var may hold a comma-separated list of keys (`parseKeys`); the vendor
 * is added to the cascade once and picks one key per request at random (see
 * `shared/key-pool.ts`). A single key behaves exactly as before.
 */
export function resolveHtmlFetchProviders(
  options: ResolveHtmlFetchProvidersOptions = {},
): HtmlFetchProvider[] {
  const env = options.env ?? process.env;
  const chain: HtmlFetchProvider[] = [];

  const tinyfishKeys = parseKeys(env.TINYFISH_API_KEY);
  if (tinyfishKeys.length > 0) {
    chain.push(new TinyFishFetchProvider({ apiKey: tinyfishKeys }));
  }

  const firecrawlKeys = parseKeys(env.FIRECRAWL_API_KEY);
  if (firecrawlKeys.length > 0) {
    chain.push(new FirecrawlFetchProvider({ apiKey: firecrawlKeys }));
  }

  const tavilyKeys = parseKeys(env.TAVILY_API_KEY);
  if (tavilyKeys.length > 0) {
    chain.push(new TavilyFetchProvider({ apiKey: tavilyKeys }));
  }

  const exaKeys = parseKeys(env.EXA_API_KEY);
  if (exaKeys.length > 0) {
    chain.push(new ExaFetchProvider({ apiKey: exaKeys }));
  }

  return chain;
}
