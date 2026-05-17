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
import { TinyFishFetchProvider } from './providers/tinyfish.ts';
import { FirecrawlFetchProvider } from './providers/firecrawl.ts';
import { TavilyFetchProvider } from './providers/tavily.ts';
import { ExaFetchProvider } from './providers/exa.ts';

export interface ResolveHtmlFetchProvidersOptions {
  /** Override env lookup (test injection). */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

function readKey(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  name: string,
): string | undefined {
  const raw = env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the active HTML-fetch provider cascade based on environment variables.
 * Returns an empty array when no keys are configured — the caller MUST treat that
 * as "skip cascade, go straight to local fetch."
 */
export function resolveHtmlFetchProviders(
  options: ResolveHtmlFetchProvidersOptions = {},
): HtmlFetchProvider[] {
  const env = options.env ?? process.env;
  const chain: HtmlFetchProvider[] = [];

  const tinyfishKey = readKey(env, 'TINYFISH_API_KEY');
  if (tinyfishKey) {
    chain.push(new TinyFishFetchProvider({ apiKey: tinyfishKey }));
  }

  const firecrawlKey = readKey(env, 'FIRECRAWL_API_KEY');
  if (firecrawlKey) {
    chain.push(new FirecrawlFetchProvider({ apiKey: firecrawlKey }));
  }

  const tavilyKey = readKey(env, 'TAVILY_API_KEY');
  if (tavilyKey) {
    chain.push(new TavilyFetchProvider({ apiKey: tavilyKey }));
  }

  const exaKey = readKey(env, 'EXA_API_KEY');
  if (exaKey) {
    chain.push(new ExaFetchProvider({ apiKey: exaKey }));
  }

  return chain;
}
