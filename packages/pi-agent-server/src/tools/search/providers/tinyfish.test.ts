import { afterEach, describe, expect, it } from 'bun:test';
import { TinyFishSearchProvider } from './tinyfish.ts';

const ORIGINAL_FETCH = globalThis.fetch;

function installFetchMock(handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((input: any, init?: any) => Promise.resolve(handler(input, init))) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('TinyFishSearchProvider', () => {
  it('parses response and maps snippet → description', async () => {
    installFetchMock((input) => {
      const url = typeof input === 'string' ? new URL(input) : input instanceof URL ? input : new URL(input.url);
      expect(url.searchParams.get('query')).toBe('craft');
      return new Response(
        JSON.stringify({
          query: 'craft',
          results: [
            { position: 1, site_name: 'a.com', title: 'Title A', snippet: 'Snippet A', url: 'https://a.com' },
            { position: 2, site_name: 'b.com', title: 'Title B', snippet: 'Snippet B', url: 'https://b.com' },
          ],
          total_results: 2,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const provider = new TinyFishSearchProvider({ apiKey: 'tf-test' });
    const results = await provider.search('craft', 10);

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: 'Title A', url: 'https://a.com', description: 'Snippet A' });
    expect(results[1]).toEqual({ title: 'Title B', url: 'https://b.com', description: 'Snippet B' });
  });

  it('sends X-API-Key header (not Authorization Bearer)', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    installFetchMock((_input, init) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return new Response(
        JSON.stringify({ results: [{ title: 't', url: 'https://x', snippet: 's' }] }),
        { status: 200 },
      );
    });

    const provider = new TinyFishSearchProvider({ apiKey: 'tf-secret-marker' });
    await provider.search('q', 1);

    expect(capturedHeaders?.['X-API-Key']).toBe('tf-secret-marker');
    expect(capturedHeaders?.['Authorization']).toBeUndefined();
  });

  it('caps results at the requested count', async () => {
    installFetchMock(() =>
      new Response(
        JSON.stringify({
          results: Array.from({ length: 10 }, (_, i) => ({
            title: `t${i}`,
            url: `https://x${i}`,
            snippet: `s${i}`,
          })),
        }),
        { status: 200 },
      ),
    );

    const provider = new TinyFishSearchProvider({ apiKey: 'tf' });
    const results = await provider.search('q', 3);
    expect(results).toHaveLength(3);
  });

  it('throws HTTP-status-only error on non-2xx (no body in message)', async () => {
    const SECRET_BODY = 'TINYFISH_RESPONSE_BODY_WITH_KEY_FRAGMENT_DO_NOT_LEAK';
    installFetchMock(() => new Response(SECRET_BODY, { status: 401 }));

    const provider = new TinyFishSearchProvider({ apiKey: 'tf' });

    let err: Error | undefined;
    try {
      await provider.search('q', 5);
    } catch (e) {
      err = e as Error;
    }

    expect(err).toBeDefined();
    expect(err!.message).toContain('HTTP 401');
    expect(err!.message).not.toContain(SECRET_BODY);
  });

  it('throws when results array is empty', async () => {
    installFetchMock(() => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const provider = new TinyFishSearchProvider({ apiKey: 'tf' });
    await expect(provider.search('q', 5)).rejects.toThrow(/no results/i);
  });
});
