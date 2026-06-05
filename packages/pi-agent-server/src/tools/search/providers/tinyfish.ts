/**
 * [fork] TinyFish search provider — paid premium tier in the cascade.
 *
 * Endpoint: GET https://api.search.tinyfish.ai?query=...
 * Auth:     X-API-Key header (key from TINYFISH_API_KEY env)
 * Response: { results: [{ position, site_name, title, snippet, url }], total_results }
 *
 * Default rate limit is 5 req/min; on 429 we throw and let the cascade fall through
 * to Exa/DDG rather than blocking the agent on a 15s backoff. We do NOT include the
 * upstream response body in the thrown error message — only status code — so a key
 * fragment leaked in TinyFish's error JSON cannot reach the LLM context.
 */
// [fork] new file

import type { WebSearchProvider, WebSearchResult } from '../types.ts';
import { pickKey } from '../../shared/key-pool.ts';

interface TinyFishApiResult {
  position?: number;
  site_name?: string;
  title?: string;
  snippet?: string;
  url?: string;
}

interface TinyFishApiResponse {
  query?: string;
  results?: TinyFishApiResult[];
  total_results?: number;
}

export interface TinyFishSearchConfig {
  /** One key, or many for per-request random load-spreading (see shared/key-pool.ts). */
  apiKey: string | string[];
  endpoint?: string;
  location?: string;
  language?: string;
}

const DEFAULT_ENDPOINT = 'https://api.search.tinyfish.ai';

export class TinyFishSearchProvider implements WebSearchProvider {
  name = 'TinyFish';

  constructor(private config: TinyFishSearchConfig) {}

  async search(query: string, count: number): Promise<WebSearchResult[]> {
    const url = new URL(this.config.endpoint || DEFAULT_ENDPOINT);
    url.searchParams.set('query', query);
    if (this.config.location) url.searchParams.set('location', this.config.location);
    if (this.config.language) url.searchParams.set('language', this.config.language);

    const apiKey = pickKey(this.config.apiKey);
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      // Intentionally do NOT include response body — error JSON may echo the API key.
      throw new Error(`TinyFish search failed (HTTP ${response.status})`);
    }

    const data = (await response.json()) as TinyFishApiResponse;
    const items = Array.isArray(data.results) ? data.results : [];

    const out: WebSearchResult[] = [];
    for (const item of items) {
      if (out.length >= count) break;
      if (typeof item.url !== 'string' || typeof item.title !== 'string') continue;
      out.push({
        title: item.title,
        url: item.url,
        description: typeof item.snippet === 'string' ? item.snippet : '',
      });
    }

    if (out.length === 0) {
      throw new Error('TinyFish returned no results');
    }

    return out;
  }
}
