import { afterEach, describe, expect, it } from 'bun:test';
import { FirecrawlSearchProvider } from './firecrawl.ts';

const ORIGINAL_FETCH = globalThis.fetch;

function installFetchMock(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
) {
  globalThis.fetch = ((input: any, init?: any) =>
    Promise.resolve(handler(input, init))) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('FirecrawlSearchProvider', () => {
  it('posts query + limit and maps data.web items to WebSearchResult', async () => {
    let capturedBody: any;
    let capturedHeaders: Record<string, string> | undefined;
    installFetchMock((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe('https://api.firecrawl.dev/v2/search');
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            web: [
              { url: 'https://a.example', title: 'A', description: 'desc-a' },
              { url: 'https://b.example', title: 'B', description: 'desc-b' },
            ],
          },
        }),
        { status: 200 },
      );
    });

    const provider = new FirecrawlSearchProvider({ apiKey: 'fc-secret-marker' });
    const results = await provider.search('hello', 2);

    expect(capturedHeaders?.['Authorization']).toBe('Bearer fc-secret-marker');
    expect(capturedBody).toEqual({ query: 'hello', limit: 2 });
    expect(results).toEqual([
      { title: 'A', url: 'https://a.example', description: 'desc-a' },
      { title: 'B', url: 'https://b.example', description: 'desc-b' },
    ]);
  });

  it('caps results to requested count', async () => {
    installFetchMock(() =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            web: [
              { url: 'https://a', title: 'A' },
              { url: 'https://b', title: 'B' },
              { url: 'https://c', title: 'C' },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const provider = new FirecrawlSearchProvider({ apiKey: 'fc' });
    const results = await provider.search('q', 2);
    expect(results.length).toBe(2);
  });

  it('throws HTTP-status-only error on non-2xx (no body in message)', async () => {
    const SECRET_BODY = 'FIRECRAWL_SEARCH_BODY_WITH_KEY_FRAGMENT_DO_NOT_LEAK';
    installFetchMock(() => new Response(SECRET_BODY, { status: 429 }));

    const provider = new FirecrawlSearchProvider({ apiKey: 'fc' });
    let err: Error | undefined;
    try {
      await provider.search('q', 5);
    } catch (e) {
      err = e as Error;
    }

    expect(err).toBeDefined();
    expect(err!.message).toContain('HTTP 429');
    expect(err!.message).not.toContain(SECRET_BODY);
  });

  it('throws using `code` only when success=false', async () => {
    const SECRET_ERROR_TEXT = 'FIRECRAWL_SEARCH_ERROR_MAY_ECHO_KEY';
    installFetchMock(() =>
      new Response(
        JSON.stringify({ success: false, code: 'UNKNOWN_ERROR', error: SECRET_ERROR_TEXT }),
        { status: 200 },
      ),
    );
    const provider = new FirecrawlSearchProvider({ apiKey: 'fc' });
    let err: Error | undefined;
    try {
      await provider.search('q', 5);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).toContain('UNKNOWN_ERROR');
    expect(err!.message).not.toContain(SECRET_ERROR_TEXT);
  });

  it('throws when data.web is empty', async () => {
    installFetchMock(() =>
      new Response(JSON.stringify({ success: true, data: { web: [] } }), { status: 200 }),
    );
    const provider = new FirecrawlSearchProvider({ apiKey: 'fc' });
    await expect(provider.search('q', 5)).rejects.toThrow(/no results/i);
  });
});
