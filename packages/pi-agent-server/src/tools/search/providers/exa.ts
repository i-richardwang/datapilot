/**
 * [fork] Exa search provider — semantic search tier in the cascade.
 *
 * Endpoint: POST https://api.exa.ai/search
 * Auth:     x-api-key header (key from EXA_API_KEY env)
 * Body:     { query, type: 'auto', numResults, contents: { text: { maxCharacters } } }
 * Response: { results: [{ title, url, score, publishedDate, text }] }
 *
 * Exa returns full extracted text by default (up to 10K chars). We cap to ~500 chars
 * to keep the snippet comparable to other providers and avoid blowing up LLM context.
 * Agents that need full content should call web_fetch on the returned URL.
 *
 * As with TinyFish, we never include the upstream response body in thrown errors —
 * only HTTP status — to prevent any echoed-key leakage into the LLM context.
 */
// [fork] new file

import type { WebSearchProvider, WebSearchResult } from '../types.ts';
import { pickKey } from '../../shared/key-pool.ts';

interface ExaApiResult {
  title?: string;
  url?: string;
  score?: number;
  publishedDate?: string;
  text?: string;
  summary?: string;
}

interface ExaApiResponse {
  results?: ExaApiResult[];
}

export interface ExaSearchConfig {
  /** One key, or many for per-request random load-spreading (see shared/key-pool.ts). */
  apiKey: string | string[];
  endpoint?: string;
  /** Max characters per result text snippet (default 500) */
  snippetMaxChars?: number;
  /** Search type passed to Exa (default 'auto') */
  type?: 'auto' | 'neural' | 'keyword' | 'hybrid';
}

const DEFAULT_ENDPOINT = 'https://api.exa.ai/search';
const DEFAULT_SNIPPET_MAX = 500;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export class ExaSearchProvider implements WebSearchProvider {
  name = 'Exa';

  constructor(private config: ExaSearchConfig) {}

  async search(query: string, count: number): Promise<WebSearchResult[]> {
    const snippetMax = this.config.snippetMaxChars ?? DEFAULT_SNIPPET_MAX;

    const apiKey = pickKey(this.config.apiKey);
    const response = await fetch(this.config.endpoint || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query,
        type: this.config.type || 'auto',
        numResults: count,
        contents: {
          text: { maxCharacters: snippetMax },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      // Intentionally do NOT include response body — see comment in tinyfish.ts.
      throw new Error(`Exa search failed (HTTP ${response.status})`);
    }

    const data = (await response.json()) as ExaApiResponse;
    const items = Array.isArray(data.results) ? data.results : [];

    const out: WebSearchResult[] = [];
    for (const item of items) {
      if (out.length >= count) break;
      if (typeof item.url !== 'string' || typeof item.title !== 'string') continue;

      const rawSnippet =
        (typeof item.text === 'string' && item.text) ||
        (typeof item.summary === 'string' && item.summary) ||
        '';
      const description = rawSnippet ? truncate(normalizeWhitespace(rawSnippet), snippetMax) : '';

      out.push({
        title: item.title,
        url: item.url,
        description,
      });
    }

    if (out.length === 0) {
      throw new Error('Exa returned no results');
    }

    return out;
  }
}
