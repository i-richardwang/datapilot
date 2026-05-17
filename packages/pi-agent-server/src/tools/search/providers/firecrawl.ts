/**
 * [fork] Firecrawl /v2/search provider — managed web search.
 *
 * Endpoint: POST https://api.firecrawl.dev/v2/search
 * Auth:     Authorization: Bearer <key> (key from FIRECRAWL_API_KEY env — same key as scrape)
 * Body:     { query, limit }   (sources defaults to [{ type: 'web' }])
 * Response (success):
 *   {
 *     success: true,
 *     data: { web: [{ url, title, description, ... }] }
 *   }
 * Response (failure): { success: false, error, code }
 *
 * As with the other providers, the upstream response body is NEVER included in
 * thrown errors — only HTTP status and (for envelope failures) the enum-like
 * `code` field — to prevent any echoed-key leakage into the LLM context.
 */
// [fork] new file

import type { WebSearchProvider, WebSearchResult } from '../types.ts';

interface FirecrawlWebResultItem {
  url?: string;
  title?: string;
  description?: string;
}

interface FirecrawlSearchData {
  web?: FirecrawlWebResultItem[];
}

interface FirecrawlSearchResponse {
  success?: boolean;
  data?: FirecrawlSearchData;
  code?: string;
}

export interface FirecrawlSearchConfig {
  apiKey: string;
  endpoint?: string;
  timeoutMs?: number;
}

const DEFAULT_ENDPOINT = 'https://api.firecrawl.dev/v2/search';
const DEFAULT_TIMEOUT_MS = 30_000;

export class FirecrawlSearchProvider implements WebSearchProvider {
  name = 'Firecrawl';

  constructor(private config: FirecrawlSearchConfig) {}

  async search(query: string, count: number): Promise<WebSearchResult[]> {
    const response = await fetch(this.config.endpoint || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, limit: count }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Intentionally do NOT include response body — error JSON may echo the API key.
      throw new Error(`Firecrawl search failed (HTTP ${response.status})`);
    }

    const data = (await response.json()) as FirecrawlSearchResponse;

    if (data.success === false) {
      throw new Error(`Firecrawl per-request error: ${data.code ?? 'UNKNOWN'}`);
    }

    const items = Array.isArray(data.data?.web) ? data.data.web : [];

    const out: WebSearchResult[] = [];
    for (const item of items) {
      if (out.length >= count) break;
      if (typeof item.url !== 'string' || typeof item.title !== 'string') continue;
      out.push({
        title: item.title,
        url: item.url,
        description: typeof item.description === 'string' ? item.description : '',
      });
    }

    if (out.length === 0) {
      throw new Error('Firecrawl returned no results');
    }

    return out;
  }
}
