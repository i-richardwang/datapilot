import { afterEach, describe, expect, it } from 'bun:test';
import { TavilySearchProvider } from './tavily.ts';

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

describe('TavilySearchProvider', () => {
  it('posts query + max_results and maps results[] to WebSearchResult', async () => {
    let capturedBody: any;
    let capturedHeaders: Record<string, string> | undefined;
    installFetchMock((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe('https://api.tavily.com/search');
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(
        JSON.stringify({
          query: 'hello',
          results: [
            { title: 'A', url: 'https://a.example', content: 'desc-a', score: 0.9 },
            { title: 'B', url: 'https://b.example', content: 'desc-b', score: 0.7 },
          ],
        }),
        { status: 200 },
      );
    });

    const provider = new TavilySearchProvider({ apiKey: 'tvly-secret-marker' });
    const results = await provider.search('hello', 2);

    expect(capturedHeaders?.['Authorization']).toBe('Bearer tvly-secret-marker');
    expect(capturedBody).toEqual({ query: 'hello', max_results: 2 });
    expect(results).toEqual([
      { title: 'A', url: 'https://a.example', description: 'desc-a' },
      { title: 'B', url: 'https://b.example', description: 'desc-b' },
    ]);
  });

  it('caps results to requested count', async () => {
    installFetchMock(() =>
      new Response(
        JSON.stringify({
          results: [
            { title: 'A', url: 'https://a', content: '' },
            { title: 'B', url: 'https://b', content: '' },
            { title: 'C', url: 'https://c', content: '' },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new TavilySearchProvider({ apiKey: 'tvly' });
    const results = await provider.search('q', 2);
    expect(results.length).toBe(2);
  });

  it('throws HTTP-status-only error on non-2xx (no body in message)', async () => {
    const SECRET_BODY = 'TAVILY_SEARCH_BODY_WITH_KEY_FRAGMENT_DO_NOT_LEAK';
    installFetchMock(() => new Response(SECRET_BODY, { status: 432 }));

    const provider = new TavilySearchProvider({ apiKey: 'tvly' });
    let err: Error | undefined;
    try {
      await provider.search('q', 5);
    } catch (e) {
      err = e as Error;
    }

    expect(err).toBeDefined();
    expect(err!.message).toContain('HTTP 432');
    expect(err!.message).not.toContain(SECRET_BODY);
  });

  it('throws when results is empty', async () => {
    installFetchMock(() =>
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    const provider = new TavilySearchProvider({ apiKey: 'tvly' });
    await expect(provider.search('q', 5)).rejects.toThrow(/no results/i);
  });
});
