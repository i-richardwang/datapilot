import { describe, expect, it } from 'bun:test';
import { createSearchTool } from './create-search-tool.ts';
import type { WebSearchProvider } from './types.ts';

describe('createSearchTool', () => {
  it('keeps canonical tool identity', () => {
    const provider: WebSearchProvider = {
      name: 'Mock',
      async search() {
        return [];
      },
    };

    const tool = createSearchTool(provider);

    expect(tool.name).toBe('web_search');
    expect(tool.label).toBe('Web Search');
    expect(tool.description).toContain('Search the web');
  });

  it('clamps count to [1, 10] and formats results', async () => {
    let capturedCount = 0;
    const provider: WebSearchProvider = {
      name: 'MockProvider',
      async search(query, count) {
        capturedCount = count;
        return [{ title: `Result for ${query}`, url: 'https://example.com', description: 'desc' }];
      },
    };

    const tool = createSearchTool(provider);
    const result = await tool.execute('tool-1', { query: 'craft', count: 99 });

    expect(capturedCount).toBe(10);
    expect(result.details?.isError).toBeUndefined();
    expect(result.content[0]?.type).toBe('text');
    expect((result.content[0] as any).text).toContain('(via MockProvider)');
  });

  it('falls back silently to fallback provider when primary fails', async () => {
    // [fork] We intentionally drop the "Primary provider failed (…)" note —
    // `(via DuckDuckGo)` is enough signal, and the primary's error body was leaking
    // key fragments into the LLM context.
    const SECRET_MARKER = 'PRIMARY_ERROR_BODY_DO_NOT_LEAK';
    const provider: WebSearchProvider = {
      name: 'OpenAI',
      async search() {
        throw new Error(`HTTP 401: ${SECRET_MARKER}`);
      },
    };

    const fallbackProvider: WebSearchProvider = {
      name: 'DuckDuckGo',
      async search() {
        return [{ title: 'Fallback hit', url: 'https://fallback.example', description: 'ok' }];
      },
    };

    const tool = createSearchTool(provider, fallbackProvider);
    const result = await tool.execute('tool-2', { query: 'craft', count: 5 });

    expect(result.details?.isError).toBeUndefined();
    const text = (result.content[0] as any).text as string;
    expect(text).toContain('(via DuckDuckGo)');
    expect(text).toContain('https://fallback.example');
    // Primary error body must NOT leak into model context.
    expect(text).not.toContain('automatically fell back');
    expect(text).not.toContain(SECRET_MARKER);
  });

  it('marks failures as errors when primary and fallback both fail', async () => {
    const provider: WebSearchProvider = {
      name: 'OpenAI',
      async search() {
        throw new Error('primary boom');
      },
    };

    const fallbackProvider: WebSearchProvider = {
      name: 'DuckDuckGo',
      async search() {
        throw new Error('fallback boom');
      },
    };

    const tool = createSearchTool(provider, fallbackProvider);
    const result = await tool.execute('tool-3', { query: 'craft', count: -1 });

    expect(result.details?.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('primary (OpenAI) failed');
    expect((result.content[0] as any).text).toContain('fallback (DuckDuckGo) failed');
  });

  it('does not recurse fallback when provider is already fallback provider', async () => {
    const ddgProvider: WebSearchProvider = {
      name: 'DuckDuckGo',
      async search() {
        throw new Error('ddg boom');
      },
    };

    const tool = createSearchTool(ddgProvider, ddgProvider);
    const result = await tool.execute('tool-4', { query: 'craft' });

    expect(result.details?.isError).toBe(true);
    expect((result.content[0] as any).text).toContain('Search failed');
    expect((result.content[0] as any).text).toContain('ddg boom');
  });
});
