import { afterEach, describe, expect, it } from 'bun:test';
import { TavilyFetchProvider } from './tavily.ts';

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

describe('TavilyFetchProvider', () => {
  it('posts urls + format=markdown and returns results[0].raw_content', async () => {
    let capturedBody: any;
    let capturedHeaders: Record<string, string> | undefined;
    installFetchMock((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe('https://api.tavily.com/extract');
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(
        JSON.stringify({
          results: [{ url: 'https://example.com', raw_content: '# Hello\n\nWorld.' }],
          failed_results: [],
          response_time: 0.5,
        }),
        { status: 200 },
      );
    });

    const provider = new TavilyFetchProvider({ apiKey: 'tvly-secret-marker' });
    const result = await provider.fetchHtml('https://example.com');

    expect(capturedHeaders?.['Authorization']).toBe('Bearer tvly-secret-marker');
    expect(capturedBody).toEqual({ urls: ['https://example.com'], format: 'markdown' });
    expect(result.markdown).toBe('# Hello\n\nWorld.');
    expect(result.finalUrl).toBe('https://example.com');
  });

  it('falls back to the request URL when results[0].url is absent', async () => {
    installFetchMock(() =>
      new Response(
        JSON.stringify({ results: [{ raw_content: 'content' }] }),
        { status: 200 },
      ),
    );
    const provider = new TavilyFetchProvider({ apiKey: 'tvly' });
    const result = await provider.fetchHtml('https://x');
    expect(result.finalUrl).toBe('https://x');
  });

  it('throws HTTP-status-only error on non-2xx (no body in message)', async () => {
    const SECRET_BODY = 'TAVILY_FETCH_BODY_WITH_KEY_FRAGMENT_DO_NOT_LEAK';
    installFetchMock(() => new Response(SECRET_BODY, { status: 401 }));

    const provider = new TavilyFetchProvider({ apiKey: 'tvly' });
    let err: Error | undefined;
    try {
      await provider.fetchHtml('https://x');
    } catch (e) {
      err = e as Error;
    }

    expect(err).toBeDefined();
    expect(err!.message).toContain('HTTP 401');
    expect(err!.message).not.toContain(SECRET_BODY);
  });

  it('throws when failed_results[] surfaces a per-URL failure', async () => {
    installFetchMock(() =>
      new Response(
        JSON.stringify({
          results: [],
          failed_results: [{ url: 'https://x', error: 'URL_NOT_REACHABLE' }],
        }),
        { status: 200 },
      ),
    );
    const provider = new TavilyFetchProvider({ apiKey: 'tvly' });
    await expect(provider.fetchHtml('https://x')).rejects.toThrow(/URL_NOT_REACHABLE/);
  });

  it('throws when results array is empty', async () => {
    installFetchMock(() => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const provider = new TavilyFetchProvider({ apiKey: 'tvly' });
    await expect(provider.fetchHtml('https://x')).rejects.toThrow(/no results/i);
  });

  it('throws when raw_content is empty/whitespace', async () => {
    installFetchMock(() =>
      new Response(
        JSON.stringify({ results: [{ url: 'https://x', raw_content: '   \n  ' }] }),
        { status: 200 },
      ),
    );
    const provider = new TavilyFetchProvider({ apiKey: 'tvly' });
    await expect(provider.fetchHtml('https://x')).rejects.toThrow(/empty raw_content/i);
  });
});
