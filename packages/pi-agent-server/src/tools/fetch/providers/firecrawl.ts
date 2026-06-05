/**
 * [fork] Firecrawl /v2/scrape provider — managed scrape with markdown extraction.
 *
 * Endpoint: POST https://api.firecrawl.dev/v2/scrape
 * Auth:     Authorization: Bearer <key> (key from FIRECRAWL_API_KEY env — same key as search)
 * Body:     { url, formats: [{ type: 'markdown' }], onlyMainContent: true }
 * Response (success):
 *   {
 *     success: true,
 *     data: {
 *       markdown: string,
 *       metadata: { url, sourceURL, statusCode, error, ... }
 *     }
 *   }
 * Response (failure): { success: false, error, code } — surface only `code`, never
 * the `error` text or upstream body, to avoid leaking key fragments into LLM context.
 *
 * `formats` defaults to `[{type:'markdown'}]` and `onlyMainContent` defaults to true
 * per the docs; we send them explicitly as self-documenting grounding (not as a
 * defense against the default drifting).
 */
// [fork] new file

import type { HtmlFetchProvider, HtmlFetchResult } from '../types.ts';
import { pickKey } from '../../shared/key-pool.ts';

interface FirecrawlScrapeMetadata {
  url?: string;
  sourceURL?: string;
  statusCode?: number;
  error?: string | null;
}

interface FirecrawlScrapeData {
  markdown?: string;
  metadata?: FirecrawlScrapeMetadata;
}

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: FirecrawlScrapeData;
  error?: string;
  code?: string;
}

export interface FirecrawlFetchConfig {
  /** One key, or many for per-request random load-spreading (see shared/key-pool.ts). */
  apiKey: string | string[];
  endpoint?: string;
  /** Per-request timeout in ms (default 45s — managed scrape can include live crawl). */
  timeoutMs?: number;
}

const DEFAULT_ENDPOINT = 'https://api.firecrawl.dev/v2/scrape';
const DEFAULT_TIMEOUT_MS = 45_000;

export class FirecrawlFetchProvider implements HtmlFetchProvider {
  name = 'Firecrawl';

  constructor(private config: FirecrawlFetchConfig) {}

  async fetchHtml(url: string): Promise<HtmlFetchResult> {
    const apiKey = pickKey(this.config.apiKey);
    const response = await fetch(this.config.endpoint || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: [{ type: 'markdown' }],
        onlyMainContent: true,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Intentionally do NOT include response body — error JSON may echo the API key.
      throw new Error(`Firecrawl fetch failed (HTTP ${response.status})`);
    }

    const data = (await response.json()) as FirecrawlScrapeResponse;

    if (data.success === false) {
      // Surface only the enum-like `code` field — never the free-form `error` text.
      throw new Error(`Firecrawl per-request error: ${data.code ?? 'UNKNOWN'}`);
    }

    const markdown = typeof data.data?.markdown === 'string' ? data.data.markdown : '';
    if (!markdown.trim()) {
      throw new Error('Firecrawl returned empty markdown');
    }

    const finalUrl =
      typeof data.data?.metadata?.url === 'string' && data.data.metadata.url
        ? data.data.metadata.url
        : url;

    return { markdown, finalUrl };
  }
}
