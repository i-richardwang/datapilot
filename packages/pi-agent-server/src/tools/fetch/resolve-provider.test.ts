import { describe, expect, it } from 'bun:test';
import { resolveHtmlFetchProviders } from './resolve-provider.ts';
import { TinyFishFetchProvider } from './providers/tinyfish.ts';
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

  it('returns Exa only when EXA_API_KEY is set', () => {
    const chain = resolveHtmlFetchProviders({ env: { EXA_API_KEY: 'exa-test' } });
    expect(chain.length).toBe(1);
    expect(chain[0]).toBeInstanceOf(ExaFetchProvider);
  });

  it('orders TinyFish → Exa when both keys are set', () => {
    const chain = resolveHtmlFetchProviders({
      env: { TINYFISH_API_KEY: 'tf-test', EXA_API_KEY: 'exa-test' },
    });
    expect(chain.length).toBe(2);
    expect(chain[0]).toBeInstanceOf(TinyFishFetchProvider);
    expect(chain[1]).toBeInstanceOf(ExaFetchProvider);
  });

  it('treats whitespace-only or empty key values as unconfigured', () => {
    const chain = resolveHtmlFetchProviders({
      env: { TINYFISH_API_KEY: '   ', EXA_API_KEY: '' },
    });
    expect(chain.length).toBe(0);
  });

  it('falls back to process.env when options.env is omitted', () => {
    // Just confirms the no-arg call path doesn't throw.
    expect(() => resolveHtmlFetchProviders()).not.toThrow();
  });
});
