/**
 * [fork] Tavily /extract provider — managed extraction with markdown output.
 *
 * Endpoint: POST https://api.tavily.com/extract
 * Auth:     Authorization: Bearer <key> (key from TAVILY_API_KEY env — same key as search)
 * Body:     { urls: [url], format: 'markdown' }
 * Response (success):
 *   {
 *     results: [{ url, raw_content, images?, favicon? }],
 *     failed_results: [{ url, error }],
 *     response_time: number,
 *     ...
 *   }
 *
 * Tavily extract uses a 200 OK envelope even for per-URL failures — the failed URL
 * appears in `failed_results` instead of `results`. We surface only the `error`
 * code/string from `failed_results[0]` and HTTP status — never any upstream body
 * fragment, since 4xx error bodies are `{ detail: { error: "..." } }` and could
 * conceivably echo request data.
 */
// [fork] new file

import type { HtmlFetchProvider, HtmlFetchResult } from '../types.ts';

interface TavilyExtractResultItem {
  url?: string;
  raw_content?: string;
}

interface TavilyExtractFailedItem {
  url?: string;
  error?: string;
}

interface TavilyExtractResponse {
  results?: TavilyExtractResultItem[];
  failed_results?: TavilyExtractFailedItem[];
}

export interface TavilyFetchConfig {
  apiKey: string;
  endpoint?: string;
  /** Per-request timeout in ms (default 45s — basic extraction is fast, advanced can be slower). */
  timeoutMs?: number;
}

const DEFAULT_ENDPOINT = 'https://api.tavily.com/extract';
const DEFAULT_TIMEOUT_MS = 45_000;

export class TavilyFetchProvider implements HtmlFetchProvider {
  name = 'Tavily';

  constructor(private config: TavilyFetchConfig) {}

  async fetchHtml(url: string): Promise<HtmlFetchResult> {
    const response = await fetch(this.config.endpoint || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ urls: [url], format: 'markdown' }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Intentionally do NOT include response body — error JSON may echo request data.
      throw new Error(`Tavily fetch failed (HTTP ${response.status})`);
    }

    const data = (await response.json()) as TavilyExtractResponse;

    const failed = Array.isArray(data.failed_results) ? data.failed_results[0] : undefined;
    if (failed?.error) {
      throw new Error(`Tavily per-URL error: ${failed.error}`);
    }

    const item = Array.isArray(data.results) ? data.results[0] : undefined;
    if (!item) {
      throw new Error('Tavily returned no results');
    }

    const markdown = typeof item.raw_content === 'string' ? item.raw_content : '';
    if (!markdown.trim()) {
      throw new Error('Tavily returned empty raw_content');
    }

    return {
      markdown,
      finalUrl: typeof item.url === 'string' && item.url ? item.url : url,
    };
  }
}
