/**
 * [fork] Exa /contents provider — semantic-search-grade content extraction.
 *
 * Endpoint: POST https://api.exa.ai/contents
 * Auth:     x-api-key header (key from EXA_API_KEY env — same key as search)
 * Body:     { urls: [url], text: true }
 * Response: { results: [{ url, title, text, ... }], statuses: [{ source, status, error? }] }
 *
 * `text: true` returns the page content "formatted as markdown" with main-content
 * extraction (filters out navigation, popups, sidebars) per the official docs.
 *
 * Exa's contents API is cache-first with automatic live-crawl fallback. It returns
 * cleaned page text suitable for LLM consumption. Distinct from /search — this
 * endpoint takes URLs (not queries) and returns content.
 *
 * Like TinyFish, the upstream response body is NEVER included in thrown errors —
 * Exa's error JSON may echo the API key.
 */
// [fork] new file

import type { HtmlFetchProvider, HtmlFetchResult } from '../types.ts';
import { pickKey } from '../../shared/key-pool.ts';

interface ExaContentsResultItem {
  url?: string;
  title?: string;
  text?: string;
  summary?: string;
}

interface ExaContentsStatusItem {
  source?: string;
  status?: string;
  error?: { tag?: string; httpStatusCode?: number };
}

interface ExaContentsResponse {
  results?: ExaContentsResultItem[];
  statuses?: ExaContentsStatusItem[];
}

export interface ExaFetchConfig {
  /** One key, or many for per-request random load-spreading (see shared/key-pool.ts). */
  apiKey: string | string[];
  endpoint?: string;
  /** Per-request timeout in ms (default 45s — live-crawl fallback can take time). */
  timeoutMs?: number;
}

const DEFAULT_ENDPOINT = 'https://api.exa.ai/contents';
const DEFAULT_TIMEOUT_MS = 45_000;

export class ExaFetchProvider implements HtmlFetchProvider {
  name = 'Exa';

  constructor(private config: ExaFetchConfig) {}

  async fetchHtml(url: string): Promise<HtmlFetchResult> {
    const apiKey = pickKey(this.config.apiKey);
    const response = await fetch(this.config.endpoint || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ urls: [url], text: true }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Intentionally do NOT include response body — see comment in tinyfish.ts.
      throw new Error(`Exa fetch failed (HTTP ${response.status})`);
    }

    const data = (await response.json()) as ExaContentsResponse;

    const status = Array.isArray(data.statuses) ? data.statuses[0] : undefined;
    if (status && status.status && status.status !== 'success') {
      const tag = status.error?.tag || status.status;
      throw new Error(`Exa per-URL status: ${tag}`);
    }

    const item = Array.isArray(data.results) ? data.results[0] : undefined;
    if (!item) {
      throw new Error('Exa returned no results');
    }

    const markdown = typeof item.text === 'string' ? item.text : '';
    if (!markdown.trim()) {
      throw new Error('Exa returned empty text');
    }

    return {
      markdown,
      finalUrl: typeof item.url === 'string' && item.url ? item.url : url,
    };
  }
}
