import { afterEach, describe, expect, it } from 'bun:test';
import { FirecrawlFetchProvider } from './firecrawl.ts';

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

describe('FirecrawlFetchProvider', () => {
  it('posts url + formats + onlyMainContent and returns data.markdown', async () => {
    let capturedBody: any;
    let capturedHeaders: Record<string, string> | undefined;
    installFetchMock((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      expect(url).toBe('https://api.firecrawl.dev/v2/scrape');
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            markdown: '# Hello\n\nWorld.',
            metadata: {
              url: 'https://example.com/landing',
              sourceURL: 'https://example.com',
              statusCode: 200,
              error: null,
            },
          },
        }),
        { status: 200 },
      );
    });

    const provider = new FirecrawlFetchProvider({ apiKey: 'fc-secret-marker' });
    const result = await provider.fetchHtml('https://example.com');

    expect(capturedHeaders?.['Authorization']).toBe('Bearer fc-secret-marker');
    expect(capturedBody).toEqual({
      url: 'https://example.com',
      formats: [{ type: 'markdown' }],
      onlyMainContent: true,
    });
    expect(result.markdown).toBe('# Hello\n\nWorld.');
    expect(result.finalUrl).toBe('https://example.com/landing');
  });

  it('falls back to the request URL when metadata.url is absent', async () => {
    installFetchMock(() =>
      new Response(
        JSON.stringify({ success: true, data: { markdown: 'content' } }),
        { status: 200 },
      ),
    );
    const provider = new FirecrawlFetchProvider({ apiKey: 'fc' });
    const result = await provider.fetchHtml('https://x');
    expect(result.finalUrl).toBe('https://x');
  });

  it('throws HTTP-status-only error on non-2xx (no body in message)', async () => {
    const SECRET_BODY = 'FIRECRAWL_FETCH_BODY_WITH_KEY_FRAGMENT_DO_NOT_LEAK';
    installFetchMock(() => new Response(SECRET_BODY, { status: 402 }));

    const provider = new FirecrawlFetchProvider({ apiKey: 'fc' });
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

  it('throws using `code` only when success=false (never the free-form error text)', async () => {
    const SECRET_ERROR_TEXT = 'FIRECRAWL_ERROR_TEXT_MAY_ECHO_KEY';
    installFetchMock(() =>
      new Response(
        JSON.stringify({ success: false, code: 'UNKNOWN_ERROR', error: SECRET_ERROR_TEXT }),
        { status: 200 },
      ),
    );
    const provider = new FirecrawlFetchProvider({ apiKey: 'fc' });
    let err: Error | undefined;
    try {
      await provider.fetchHtml('https://x');
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    expect(err!.message).toContain('UNKNOWN_ERROR');
    expect(err!.message).not.toContain(SECRET_ERROR_TEXT);
  });

  it('throws when markdown is empty/whitespace', async () => {
    installFetchMock(() =>
      new Response(
        JSON.stringify({ success: true, data: { markdown: '   \n  ' } }),
        { status: 200 },
      ),
    );
    const provider = new FirecrawlFetchProvider({ apiKey: 'fc' });
    await expect(provider.fetchHtml('https://x')).rejects.toThrow(/empty markdown/i);
  });
});
