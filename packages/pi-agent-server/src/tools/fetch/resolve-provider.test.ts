import { describe, expect, it } from 'bun:test';
import { resolveHtmlFetchProviders } from './resolve-provider.ts';
import { TinyFishFetchProvider } from './providers/tinyfish.ts';
import { FirecrawlFetchProvider } from './providers/firecrawl.ts';
import { TavilyFetchProvider } from './providers/tavily.ts';
import { ExaFetchProvider } from './providers/exa.ts';

describe('resolveHtmlFetchProviders (env-driven HTML cascade)', () => {
  it('returns an empty cascade when no premium keys are configured', () => {
    const chain = resolveHtmlFetchProviders({ env: {} });
    expect(chain.length).toBe(0);
  });

  it('returns TinyFish only when TINYFISH_API_KEY is set', () => {
    const chain = resolveHtmlFetchProviders({ env: { TINYFISH_API_KEY: 'tf-test' } });
    expect(chain.length).toBe(1);
    expect(chain[0]).toBeInstanceOf(TinyFishFetchProvider);
  });

  it('returns Firecrawl only when FIRECRAWL_API_KEY is set', () => {
    const chain = resolveHtmlFetchProviders({ env: { FIRECRAWL_API_KEY: 'fc-test' } });
    expect(chain.length).toBe(1);
    expect(chain[0]).toBeInstanceOf(FirecrawlFetchProvider);
  });

  it('returns Tavily only when TAVILY_API_KEY is set', () => {
    const chain = resolveHtmlFetchProviders({ env: { TAVILY_API_KEY: 'tvly-test' } });
    expect(chain.length).toBe(1);
    expect(chain[0]).toBeInstanceOf(TavilyFetchProvider);
  });

  it('returns Exa only when EXA_API_KEY is set', () => {
    const chain = resolveHtmlFetchProviders({ env: { EXA_API_KEY: 'exa-test' } });
    expect(chain.length).toBe(1);
    expect(chain[0]).toBeInstanceOf(ExaFetchProvider);
  });

  it('orders TinyFish → Firecrawl → Tavily → Exa when all keys are set', () => {
    const chain = resolveHtmlFetchProviders({
      env: {
        TINYFISH_API_KEY: 'tf-test',
        FIRECRAWL_API_KEY: 'fc-test',
        TAVILY_API_KEY: 'tvly-test',
        EXA_API_KEY: 'exa-test',
      },
    });
    expect(chain.length).toBe(4);
    expect(chain[0]).toBeInstanceOf(TinyFishFetchProvider);
    expect(chain[1]).toBeInstanceOf(FirecrawlFetchProvider);
    expect(chain[2]).toBeInstanceOf(TavilyFetchProvider);
    expect(chain[3]).toBeInstanceOf(ExaFetchProvider);
  });

  it('preserves cascade order with partial config (TinyFish + Tavily only)', () => {
    const chain = resolveHtmlFetchProviders({
      env: { TINYFISH_API_KEY: 'tf-test', TAVILY_API_KEY: 'tvly-test' },
    });
    expect(chain.length).toBe(2);
    expect(chain[0]).toBeInstanceOf(TinyFishFetchProvider);
    expect(chain[1]).toBeInstanceOf(TavilyFetchProvider);
  });

  it('treats whitespace-only or empty key values as unconfigured', () => {
    const chain = resolveHtmlFetchProviders({
      env: {
        TINYFISH_API_KEY: '   ',
        FIRECRAWL_API_KEY: '',
        TAVILY_API_KEY: '   ',
        EXA_API_KEY: '',
      },
    });
    expect(chain.length).toBe(0);
  });

  it('falls back to process.env when options.env is omitted', () => {
    // Just confirms the no-arg call path doesn't throw.
    expect(() => resolveHtmlFetchProviders()).not.toThrow();
  });
});
