import { afterEach, describe, expect, it } from 'bun:test';
import { TinyFishFetchProvider } from './tinyfish.ts';

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

describe('TinyFishFetchProvider', () => {
  it('posts urls + format and returns markdown from results[0].text', async () => {
    let capturedBody: any;
    let capturedHeaders: Record<string, string> | undefined;
    installFetchMock((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe('https://api.fetch.tinyfish.ai');
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(
        JSON.stringify({
          results: [
            {
              url: 'https://example.com',
              final_url: 'https://example.com/landing',
              title: 'Example',
              text: '# Hello\n\nWorld.',
              format: 'markdown',
            },
          ],
        }),
        { status: 200 },
      );
    });

    const provider = new TinyFishFetchProvider({ apiKey: 'tf-secret-marker' });
    const result = await provider.fetchHtml('https://example.com');

    expect(capturedHeaders?.['X-API-Key']).toBe('tf-secret-marker');
    expect(capturedHeaders?.['Authorization']).toBeUndefined();
    expect(capturedBody).toEqual({ urls: ['https://example.com'], format: 'markdown' });
    expect(result.markdown).toBe('# Hello\n\nWorld.');
    expect(result.finalUrl).toBe('https://example.com/landing');
  });

  it('falls back to the request URL when final_url is absent', async () => {
    installFetchMock(() =>
      new Response(
        JSON.stringify({ results: [{ url: 'https://x', text: 'content' }] }),
        { status: 200 },
      ),
    );
    const provider = new TinyFishFetchProvider({ apiKey: 'tf' });
    const result = await provider.fetchHtml('https://x');
    expect(result.finalUrl).toBe('https://x');
  });

  it('throws HTTP-status-only error on non-2xx (no body in message)', async () => {
    const SECRET_BODY = 'TINYFISH_FETCH_BODY_WITH_KEY_FRAGMENT_DO_NOT_LEAK';
    installFetchMock(() => new Response(SECRET_BODY, { status: 401 }));

    const provider = new TinyFishFetchProvider({ apiKey: 'tf' });
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

  it('throws when per-URL errors[] surfaces a failure (e.g. bot_blocked)', async () => {
    installFetchMock(() =>
      new Response(
        JSON.stringify({
          results: [],
          errors: [{ url: 'https://x', error: 'bot_blocked', status: 403 }],
        }),
        { status: 200 },
      ),
    );
    const provider = new TinyFishFetchProvider({ apiKey: 'tf' });
    await expect(provider.fetchHtml('https://x')).rejects.toThrow(/bot_blocked/);
  });

  it('throws when results array is empty', async () => {
    installFetchMock(() => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const provider = new TinyFishFetchProvider({ apiKey: 'tf' });
    await expect(provider.fetchHtml('https://x')).rejects.toThrow(/no results/i);
  });

  it('throws when markdown is empty/whitespace', async () => {
    installFetchMock(() =>
      new Response(
        JSON.stringify({ results: [{ url: 'https://x', text: '   \n  ' }] }),
        { status: 200 },
      ),
    );
    const provider = new TinyFishFetchProvider({ apiKey: 'tf' });
    await expect(provider.fetchHtml('https://x')).rejects.toThrow(/empty markdown/i);
  });

});
