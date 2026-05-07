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

    const tool = createSearchTool([provider]);

    expect(tool.name).toBe('web_search');
    expect(tool.label).toBe('Web Search');
    expect(tool.description).toContain('Search the web');
  });

  it('throws when constructed with an empty providers array', () => {
    expect(() => createSearchTool([])).toThrow(/non-empty/);
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

    const tool = createSearchTool([provider]);
    const result = await tool.execute('tool-1', { query: 'craft', count: 99 });

    expect(capturedCount).toBe(10);
    expect(result.details?.isError).toBeUndefined();
    expect(result.content[0]?.type).toBe('text');
    expect((result.content[0] as any).text).toContain('(via MockProvider)');
  });

  it('falls back silently to next provider when earlier ones fail', async () => {
    // [fork] We intentionally drop the "Primary provider failed (…)" note —
    // `(via DuckDuckGo)` is enough signal, and the primary's error body was leaking
    // key fragments into the LLM context.
    const SECRET_MARKER = 'PRIMARY_ERROR_BODY_DO_NOT_LEAK';
    const primary: WebSearchProvider = {
      name: 'OpenAI',
      async search() {
        throw new Error(`HTTP 401: ${SECRET_MARKER}`);
      },
    };

    const fallback: WebSearchProvider = {
      name: 'DuckDuckGo',
      async search() {
        return [{ title: 'Fallback hit', url: 'https://fallback.example', description: 'ok' }];
      },
    };

    const tool = createSearchTool([primary, fallback]);
    const result = await tool.execute('tool-2', { query: 'craft', count: 5 });

    expect(result.details?.isError).toBeUndefined();
    const text = (result.content[0] as any).text as string;
    expect(text).toContain('(via DuckDuckGo)');
    expect(text).toContain('https://fallback.example');
    // Primary error body must NOT leak into model context.
    expect(text).not.toContain('automatically fell back');
    expect(text).not.toContain(SECRET_MARKER);
  });

  it('walks through multi-tier cascade until one succeeds', async () => {
    const tierA: WebSearchProvider = {
      name: 'TinyFish',
      async search() {
        throw new Error('TinyFish search failed (HTTP 429)');
      },
    };
    const tierB: WebSearchProvider = {
      name: 'Exa',
      async search() {
        return [{ title: 'Exa hit', url: 'https://exa.example', description: 'snippet' }];
      },
    };
    const tierC: WebSearchProvider = {
      name: 'DuckDuckGo',
      async search() {
        return [{ title: 'DDG hit', url: 'https://ddg.example', description: 'ddg' }];
      },
    };

    const tool = createSearchTool([tierA, tierB, tierC]);
    const result = await tool.execute('tool-3', { query: 'craft', count: 3 });

    expect(result.details?.isError).toBeUndefined();
    const text = (result.content[0] as any).text as string;
    expect(text).toContain('(via Exa)');
    expect(text).not.toContain('(via DuckDuckGo)');
    expect(text).not.toContain('TinyFish');
  });

  it('marks failures as errors when every provider in the cascade fails', async () => {
    const a: WebSearchProvider = {
      name: 'TinyFish',
      async search() {
        throw new Error('tinyfish boom');
      },
    };
    const b: WebSearchProvider = {
      name: 'DuckDuckGo',
      async search() {
        throw new Error('ddg boom');
      },
    };

    const tool = createSearchTool([a, b]);
    const result = await tool.execute('tool-4', { query: 'craft', count: -1 });

    expect(result.details?.isError).toBe(true);
    const text = (result.content[0] as any).text as string;
    expect(text).toContain('TinyFish failed');
    expect(text).toContain('DuckDuckGo failed');
    expect(text).toContain('tinyfish boom');
    expect(text).toContain('ddg boom');
  });

  it('returns a single-provider failure summary when only one provider exists', async () => {
    const ddg: WebSearchProvider = {
      name: 'DuckDuckGo',
      async search() {
        throw new Error('ddg boom');
      },
    };

    const tool = createSearchTool([ddg]);
    const result = await tool.execute('tool-5', { query: 'craft' });

    expect(result.details?.isError).toBe(true);
    const text = (result.content[0] as any).text as string;
    expect(text).toContain('Search failed');
    expect(text).toContain('DuckDuckGo failed');
    expect(text).toContain('ddg boom');
  });
});
