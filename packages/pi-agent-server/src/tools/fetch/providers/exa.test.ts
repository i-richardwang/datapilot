import { afterEach, describe, expect, it } from 'bun:test';
import { ExaFetchProvider } from './exa.ts';

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

describe('ExaFetchProvider', () => {
  it('posts urls + text option and returns text as markdown', async () => {
    let capturedBody: any;
    let capturedHeaders: Record<string, string> | undefined;
    installFetchMock((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe('https://api.exa.ai/contents');
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(
        JSON.stringify({
          results: [
            { url: 'https://example.com', title: 'Example', text: 'page body text' },
          ],
          statuses: [{ source: 'cache', status: 'success' }],
        }),
        { status: 200 },
      );
    });

    const provider = new ExaFetchProvider({ apiKey: 'exa-secret-marker' });
    const result = await provider.fetchHtml('https://example.com');

    expect(capturedHeaders?.['x-api-key']).toBe('exa-secret-marker');
    expect(capturedHeaders?.['Authorization']).toBeUndefined();
    expect(capturedBody?.urls).toEqual(['https://example.com']);
    expect(capturedBody?.text).toBe(true);
    expect(result.markdown).toBe('page body text');
    expect(result.finalUrl).toBe('https://example.com');
  });

  it('throws HTTP-status-only error on non-2xx (no body in message)', async () => {
    const SECRET_BODY = 'EXA_FETCH_BODY_WITH_KEY_FRAGMENT_DO_NOT_LEAK';
    installFetchMock(() => new Response(SECRET_BODY, { status: 402 }));

    const provider = new ExaFetchProvider({ apiKey: 'exa' });
    let err: Error | undefined;
    try {
      await provider.fetchHtml('https://x');
    } catch (e) {
      err = e as Error;
    }

    expect(err).toBeDefined();
    expect(err!.message).toContain('HTTP 402');
    expect(err!.message).not.toContain(SECRET_BODY);
  });

  it('throws when statuses[0] reports a non-success state', async () => {
    installFetchMock(() =>
      new Response(
        JSON.stringify({
          results: [],
          statuses: [
            { source: 'live', status: 'error', error: { tag: 'CRAWL_NOT_FOUND', httpStatusCode: 404 } },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new ExaFetchProvider({ apiKey: 'exa' });
    await expect(provider.fetchHtml('https://x')).rejects.toThrow(/CRAWL_NOT_FOUND/);
  });

  it('throws when results array is empty', async () => {
    installFetchMock(() => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const provider = new ExaFetchProvider({ apiKey: 'exa' });
    await expect(provider.fetchHtml('https://x')).rejects.toThrow(/no results/i);
  });

  it('throws when text is empty/whitespace', async () => {
    installFetchMock(() =>
      new Response(
        JSON.stringify({ results: [{ url: 'https://x', text: '   \n  ' }] }),
        { status: 200 },
      ),
    );
    const provider = new ExaFetchProvider({ apiKey: 'exa' });
    await expect(provider.fetchHtml('https://x')).rejects.toThrow(/empty text/i);
  });
});
