/**
 * [fork] Tavily /search provider — managed web search with relevance scoring.
 *
 * Endpoint: POST https://api.tavily.com/search
 * Auth:     Authorization: Bearer <key> (key from TAVILY_API_KEY env — same key as extract)
 * Body:     { query, max_results }
 * Response (success):
 *   {
 *     query: string,
 *     results: [{ title, url, content, score, ... }],
 *     response_time: number,
 *     ...
 *   }
 *
 * `content` is Tavily's short description per the docs — that's what we map to
 * `WebSearchResult.description`. `score` / `images` / `answer` / `raw_content`
 * are intentionally ignored (raw_content would require opt-in and bloats LLM
 * context; the agent should call web_fetch for full content).
 *
 * Error responses use `{ detail: { error: '...' } }` and may carry request data,
 * so the upstream body is NEVER included in thrown errors — only HTTP status.
 */
// [fork] new file

import type { WebSearchProvider, WebSearchResult } from '../types.ts';

interface TavilySearchResultItem {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilySearchResponse {
  results?: TavilySearchResultItem[];
}

export interface TavilySearchConfig {
  apiKey: string;
  endpoint?: string;
  timeoutMs?: number;
}

const DEFAULT_ENDPOINT = 'https://api.tavily.com/search';
const DEFAULT_TIMEOUT_MS = 30_000;

export class TavilySearchProvider implements WebSearchProvider {
  name = 'Tavily';

  constructor(private config: TavilySearchConfig) {}

  async search(query: string, count: number): Promise<WebSearchResult[]> {
    const response = await fetch(this.config.endpoint || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, max_results: count }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Intentionally do NOT include response body — error JSON may echo the API key.
      throw new Error(`Tavily search failed (HTTP ${response.status})`);
    }

    const data = (await response.json()) as TavilySearchResponse;
    const items = Array.isArray(data.results) ? data.results : [];

    const out: WebSearchResult[] = [];
    for (const item of items) {
      if (out.length >= count) break;
      if (typeof item.url !== 'string' || typeof item.title !== 'string') continue;
      out.push({
        title: item.title,
        url: item.url,
        description: typeof item.content === 'string' ? item.content : '',
      });
    }

    if (out.length === 0) {
      throw new Error('Tavily returned no results');
    }

    return out;
  }
}
