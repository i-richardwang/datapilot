/**
 * [fork] Cascade-level tests for createWebFetchTool: verifies the HTML provider
 * cascade is consulted first, that failures fall through, that binary URLs bypass
 * the cascade, and that an empty cascade is a transparent no-op.
 *
 * Network is mocked via globalThis.fetch — the local fallback path also goes
 * through this mock, so we can stub a tiny HTML body to confirm "cascade falls
 * back to local on all-fail".
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { createWebFetchTool } from './web-fetch.ts';
import type { HtmlFetchProvider } from './fetch/types.ts';

const ORIGINAL_FETCH = globalThis.fetch;

function installFetchMock(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>,
) {
  globalThis.fetch = ((input: any, init?: any) =>
    Promise.resolve(handler(input, init))) as typeof fetch;
}

function neverCallFetch() {
  globalThis.fetch = ((): never => {
    throw new Error('fetch() should not be called in this test');
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

const sessionDir = mkdtempSync(join(tmpdir(), 'wfetch-cascade-'));
const getSessionPath = () => sessionDir;

function makeProvider(name: string, behavior: 'ok' | 'throw', payload?: string): HtmlFetchProvider {
  return {
    name,
    async fetchHtml(url) {
      if (behavior === 'throw') {
        throw new Error(`${name} failed`);
      }
      return { markdown: payload ?? `from ${name}`, finalUrl: url };
    },
  };
}

describe('createWebFetchTool — HTML cascade', () => {
  it('uses the first provider and skips local fetch when it succeeds', async () => {
    neverCallFetch(); // any local fetch would throw

    const tool = createWebFetchTool(getSessionPath, {
      htmlProviders: [makeProvider('Primary', 'ok', '# primary md')],
    });
    const result = await tool.execute('t1', { url: 'https://example.com/page' });

    expect(result.details?.isError).toBeUndefined();
    const text = (result.content[0] as any).text as string;
    expect(text).toContain('(via Primary)');
    expect(text).toContain('# primary md');
  });

  it('falls through to next provider when earlier ones throw', async () => {
    neverCallFetch();

    const tool = createWebFetchTool(getSessionPath, {
      htmlProviders: [
        makeProvider('First', 'throw'),
        makeProvider('Second', 'ok', 'second-md'),
      ],
    });
    const result = await tool.execute('t1', { url: 'https://example.com/page' });

    const text = (result.content[0] as any).text as string;
    expect(text).toContain('(via Second)');
    expect(text).toContain('second-md');
    expect(text).not.toContain('First failed'); // primary error must not leak to LLM
  });

  it('falls back to local fetch when every provider throws', async () => {
    installFetchMock(() =>
      new Response('<html><body><main>local body</main></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    );

    const tool = createWebFetchTool(getSessionPath, {
      htmlProviders: [
        makeProvider('First', 'throw'),
        makeProvider('Second', 'throw'),
      ],
    });
    const result = await tool.execute('t1', { url: 'https://example.com/page' });

    const text = (result.content[0] as any).text as string;
    expect(text).toContain('local body');
    expect(text).not.toContain('(via ');
  });

  it('bypasses the cascade for known binary URL extensions (e.g. .pdf)', async () => {
    let cascadeCalled = false;
    installFetchMock(() =>
      // We send back a tiny non-PDF body so the test doesn't depend on pdfjs.
      // The point is: fetch() runs (cascade was skipped), so the local handler
      // is what processed the URL.
      new Response('plain text body', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );

    const tool = createWebFetchTool(getSessionPath, {
      htmlProviders: [
        {
          name: 'CascadeSentinel',
          async fetchHtml() {
            cascadeCalled = true;
            return { markdown: 'should-not-see', finalUrl: 'x' };
          },
        },
      ],
    });
    const result = await tool.execute('t1', { url: 'https://example.com/file.pdf' });

    expect(cascadeCalled).toBe(false);
    expect((result.content[0] as any).text).toContain('plain text body');
  });

  it('skips cascade entirely when htmlProviders is empty (preserves pre-fork behavior)', async () => {
    installFetchMock(() =>
      new Response('<html><body>baseline</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const tool = createWebFetchTool(getSessionPath, { htmlProviders: [] });
    const result = await tool.execute('t1', { url: 'https://example.com/page' });

    const text = (result.content[0] as any).text as string;
    expect(text).toContain('baseline');
    expect(text).not.toContain('(via ');
  });

  it('passes prompt through to the (via …) attribution prefix', async () => {
    neverCallFetch();
    const tool = createWebFetchTool(getSessionPath, {
      htmlProviders: [makeProvider('Primary', 'ok', 'md')],
    });
    const result = await tool.execute('t1', {
      url: 'https://example.com/page',
      prompt: 'find the pricing',
    });

    const text = (result.content[0] as any).text as string;
    expect(text).toContain('(via Primary, asked: "find the pricing")');
  });
});
