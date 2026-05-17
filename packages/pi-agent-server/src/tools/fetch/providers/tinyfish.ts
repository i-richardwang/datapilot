/**
 * [fork] TinyFish Fetch provider — real-browser-rendered HTML → markdown.
 *
 * Endpoint: POST https://api.fetch.tinyfish.ai
 * Auth:     X-API-Key header (key from TINYFISH_API_KEY env — same key as search)
 * Body:     { urls: [url], format: 'markdown' }
 * Response: { results: [{ url, final_url, title, text, ... }], errors: [{ url, error }] }
 *
 * The endpoint renders pages in a stealth Chromium fleet, so it can extract content
 * from SPAs and JS-rendered sites that the local fetch+Turndown path returns as
 * empty shells. Free tier permits 25 URLs/min; we send one URL per call.
 *
 * As with the search providers, the upstream response body is NEVER included in
 * thrown errors — TinyFish's error JSON may echo the API key fragment.
 */
// [fork] new file

import type { HtmlFetchProvider, HtmlFetchResult } from '../types.ts';

interface TinyFishFetchResultItem {
  url?: string;
  final_url?: string;
  title?: string;
  text?: string;
  format?: string;
}

interface TinyFishFetchErrorItem {
  url?: string;
  error?: string;
  status?: number;
}

interface TinyFishFetchResponse {
  results?: TinyFishFetchResultItem[];
  errors?: TinyFishFetchErrorItem[];
}

export interface TinyFishFetchConfig {
  apiKey: string;
  endpoint?: string;
  /** Per-request timeout in ms (default 45s — JS rendering needs the headroom). */
  timeoutMs?: number;
}

const DEFAULT_ENDPOINT = 'https://api.fetch.tinyfish.ai';
const DEFAULT_TIMEOUT_MS = 45_000;

export class TinyFishFetchProvider implements HtmlFetchProvider {
  name = 'TinyFish';

  constructor(private config: TinyFishFetchConfig) {}

  async fetchHtml(url: string): Promise<HtmlFetchResult> {
    const response = await fetch(this.config.endpoint || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-API-Key': this.config.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ urls: [url], format: 'markdown' }),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Intentionally do NOT include response body — error JSON may echo the API key.
      throw new Error(`TinyFish fetch failed (HTTP ${response.status})`);
    }

    const data = (await response.json()) as TinyFishFetchResponse;

    const errorItem = Array.isArray(data.errors) ? data.errors[0] : undefined;
    if (errorItem?.error) {
      // Per-URL error (bot_blocked / target_unreachable / empty_content / …).
      // Surface only the error code — never any upstream body fragment.
      throw new Error(`TinyFish per-URL error: ${errorItem.error}`);
    }

    const item = Array.isArray(data.results) ? data.results[0] : undefined;
    if (!item) {
      throw new Error('TinyFish returned no results');
    }

    const markdown = typeof item.text === 'string' ? item.text : '';
    if (!markdown.trim()) {
      throw new Error('TinyFish returned empty markdown');
    }

    return {
      markdown,
      finalUrl: typeof item.final_url === 'string' && item.final_url ? item.final_url : url,
    };
  }
}
