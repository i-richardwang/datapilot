/**
 * [fork] HTML-fetch provider contract used by the web_fetch tool's HTML cascade.
 *
 * Mirrors the shape of `tools/search/types.ts` so the env-driven cascade pattern
 * stays uniform across web_search and web_fetch. Providers are HTML-only — the
 * web_fetch tool itself still owns PDF / image / JSON / plain-text dispatch,
 * because the remote backends (TinyFish Fetch, Exa /contents) only return text
 * content (markdown / HTML / JSON metadata).
 */

export interface HtmlFetchResult {
  /** Page content rendered as markdown (the contract of every provider). */
  markdown: string;
  /** URL after redirects, as observed by the provider. Falls back to the request URL. */
  finalUrl: string;
}

export interface HtmlFetchProvider {
  /** Display name shown in result attribution (e.g. "TinyFish", "Exa", "Local"). */
  name: string;
  /**
   * Fetch the URL and return markdown.
   *
   * Implementations MUST throw on failure (HTTP error, empty body, per-URL error,
   * timeout) so the orchestrator can cascade to the next provider. Error messages
   * MUST NOT include the upstream response body — error bodies often echo the
   * API key and would leak fragments into the LLM context.
   */
  fetchHtml(url: string): Promise<HtmlFetchResult>;
}
