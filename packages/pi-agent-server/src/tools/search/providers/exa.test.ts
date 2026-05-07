import { afterEach, describe, expect, it } from 'bun:test';
import { ExaSearchProvider } from './exa.ts';

const ORIGINAL_FETCH = globalThis.fetch;

function installFetchMock(handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((input: any, init?: any) => Promise.resolve(handler(input, init))) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('ExaSearchProvider', () => {
  it('parses response and maps text → description (truncated)', async () => {
    const longText = 'A'.repeat(2000);
    installFetchMock(() =>
      new Response(
        JSON.stringify({
          results: [
            { title: 'T1', url: 'https://a.example', text: longText },
            { title: 'T2', url: 'https://b.example', summary: 'short summary' },
          ],
        }),
        { status: 200 },
      ),
    );

    const provider = new ExaSearchProvider({ apiKey: 'exa', snippetMaxChars: 100 });
    const results = await provider.search('craft', 10);

    expect(results).toHaveLength(2);
    expect(results[0]!.title).toBe('T1');
    expect(results[0]!.url).toBe('https://a.example');
    expect(results[0]!.description.length).toBeLessThanOrEqual(100);
    expect(results[1]!.description).toBe('short summary');
  });

  it('posts body with x-api-key header (not Authorization Bearer)', async () => {
    let capturedInit: RequestInit | undefined;
    installFetchMock((_input, init) => {
      capturedInit = init;
      return new Response(
        JSON.stringify({ results: [{ title: 't', url: 'https://x', text: 'snip' }] }),
        { status: 200 },
      );
    });

    const provider = new ExaSearchProvider({ apiKey: 'exa-secret-marker' });
    await provider.search('q', 5);

    expect(capturedInit?.method).toBe('POST');
    const headers = (capturedInit?.headers ?? {}) as Record<string, string>;
    expect(headers['x-api-key']).toBe('exa-secret-marker');
    expect(headers['Authorization']).toBeUndefined();

    const body = JSON.parse(String(capturedInit?.body ?? '{}'));
    expect(body.query).toBe('q');
    expect(body.numResults).toBe(5);
    expect(body.contents).toBeDefined();
  });

  it('throws HTTP-status-only error on non-2xx (no body in message)', async () => {
    const SECRET_BODY = 'EXA_RESPONSE_BODY_WITH_KEY_FRAGMENT_DO_NOT_LEAK';
    installFetchMock(() => new Response(SECRET_BODY, { status: 401 }));

    const provider = new ExaSearchProvider({ apiKey: 'exa' });

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
    const provider = new ExaSearchProvider({ apiKey: 'exa' });
    await expect(provider.search('q', 5)).rejects.toThrow(/no results/i);
  });
});
