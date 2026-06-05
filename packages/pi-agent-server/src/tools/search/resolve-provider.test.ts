import { describe, expect, it } from 'bun:test';
import { resolveSearchProviders } from './resolve-provider.ts';
import { TinyFishSearchProvider } from './providers/tinyfish.ts';
import { FirecrawlSearchProvider } from './providers/firecrawl.ts';
import { TavilySearchProvider } from './providers/tavily.ts';
import { ExaSearchProvider } from './providers/exa.ts';
import { DDGSearchProvider } from './providers/ddg.ts';

describe('resolveSearchProviders (env-driven cascade)', () => {
  it('returns DDG-only when no premium keys are configured', () => {
    const chain = resolveSearchProviders({ env: {} });
    expect(chain.length).toBe(1);
    expect(chain[0]).toBeInstanceOf(DDGSearchProvider);
  });

  it('prepends TinyFish when TINYFISH_API_KEY is set', () => {
    const chain = resolveSearchProviders({ env: { TINYFISH_API_KEY: 'tf-test' } });
    expect(chain.length).toBe(2);
    expect(chain[0]).toBeInstanceOf(TinyFishSearchProvider);
    expect(chain[1]).toBeInstanceOf(DDGSearchProvider);
  });

  it('prepends Firecrawl when FIRECRAWL_API_KEY is set', () => {
    const chain = resolveSearchProviders({ env: { FIRECRAWL_API_KEY: 'fc-test' } });
    expect(chain.length).toBe(2);
    expect(chain[0]).toBeInstanceOf(FirecrawlSearchProvider);
    expect(chain[1]).toBeInstanceOf(DDGSearchProvider);
  });

  it('prepends Tavily when TAVILY_API_KEY is set', () => {
    const chain = resolveSearchProviders({ env: { TAVILY_API_KEY: 'tvly-test' } });
    expect(chain.length).toBe(2);
    expect(chain[0]).toBeInstanceOf(TavilySearchProvider);
    expect(chain[1]).toBeInstanceOf(DDGSearchProvider);
  });

  it('prepends Exa when EXA_API_KEY is set', () => {
    const chain = resolveSearchProviders({ env: { EXA_API_KEY: 'exa-test' } });
    expect(chain.length).toBe(2);
    expect(chain[0]).toBeInstanceOf(ExaSearchProvider);
    expect(chain[1]).toBeInstanceOf(DDGSearchProvider);
  });

  it('orders TinyFish → Firecrawl → Tavily → Exa → DDG when all keys are set', () => {
    const chain = resolveSearchProviders({
      env: {
        TINYFISH_API_KEY: 'tf-test',
        FIRECRAWL_API_KEY: 'fc-test',
        TAVILY_API_KEY: 'tvly-test',
        EXA_API_KEY: 'exa-test',
      },
    });
    expect(chain.length).toBe(5);
    expect(chain[0]).toBeInstanceOf(TinyFishSearchProvider);
    expect(chain[1]).toBeInstanceOf(FirecrawlSearchProvider);
    expect(chain[2]).toBeInstanceOf(TavilySearchProvider);
    expect(chain[3]).toBeInstanceOf(ExaSearchProvider);
    expect(chain[4]).toBeInstanceOf(DDGSearchProvider);
  });

  it('preserves cascade order with partial config (Firecrawl + Tavily only)', () => {
    const chain = resolveSearchProviders({
      env: { FIRECRAWL_API_KEY: 'fc-test', TAVILY_API_KEY: 'tvly-test' },
    });
    expect(chain.length).toBe(3);
    expect(chain[0]).toBeInstanceOf(FirecrawlSearchProvider);
    expect(chain[1]).toBeInstanceOf(TavilySearchProvider);
    expect(chain[2]).toBeInstanceOf(DDGSearchProvider);
  });

  it('treats whitespace-only or empty key values as unconfigured', () => {
    const chain = resolveSearchProviders({
      env: {
        TINYFISH_API_KEY: '   ',
        FIRECRAWL_API_KEY: '',
        TAVILY_API_KEY: '   ',
        EXA_API_KEY: '',
      },
    });
    expect(chain.length).toBe(1);
    expect(chain[0]).toBeInstanceOf(DDGSearchProvider);
  });

  it('falls back to process.env when options.env is omitted', () => {
    // Just confirms the no-arg call path doesn't throw and always returns DDG at minimum.
    const chain = resolveSearchProviders();
    expect(chain.length).toBeGreaterThanOrEqual(1);
    expect(chain[chain.length - 1]).toBeInstanceOf(DDGSearchProvider);
  });

  it('adds a vendor ONCE when its key var holds comma-separated keys (not one per key)', () => {
    const chain = resolveSearchProviders({
      env: { TINYFISH_API_KEY: 'tf-a, tf-b ,tf-c' },
    });
    // TinyFish + DDG — multi-key spreads inside the single provider, not as extra tiers.
    expect(chain.length).toBe(2);
    expect(chain[0]).toBeInstanceOf(TinyFishSearchProvider);
    expect(chain[1]).toBeInstanceOf(DDGSearchProvider);
  });

  it('treats a comma/whitespace-only key value as unconfigured', () => {
    const chain = resolveSearchProviders({ env: { TINYFISH_API_KEY: ' , , ' } });
    expect(chain.length).toBe(1);
    expect(chain[0]).toBeInstanceOf(DDGSearchProvider);
  });
});

// =============================================================================
// [fork] Legacy tests for `resolveSearchProvider(piAuth)` retired alongside the
// LLM-native cascade. Kept here for upstream rebase visibility — re-enable the
// describe block below if the LLM-native path is ever restored.
// =============================================================================
//
// import { resolveSearchProvider } from './resolve-provider.ts';
// import { ResponsesApiSearchProvider } from './providers/openai.ts';
// import { ChatGPTBackendSearchProvider } from './providers/chatgpt.ts';
// import { GoogleSearchProvider } from './providers/google.ts';
//
// function makeJwt(accountId: string): string {
//   const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
//   const payload = btoa(
//     JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: accountId } }),
//   );
//   return `${header}.${payload}.fakesig`;
// }
//
// describe('resolveSearchProvider [retired]', () => {
//   it('selects ResponsesApiSearchProvider for openai + api_key', () => {
//     const provider = resolveSearchProvider({
//       provider: 'openai',
//       credential: { type: 'api_key', key: 'sk-test' },
//     });
//     expect(provider).toBeInstanceOf(ResponsesApiSearchProvider);
//     expect(provider.name).toBe('OpenAI');
//   });
//
//   it('selects ChatGPTBackendSearchProvider for openai-codex + oauth with valid JWT', () => {
//     const provider = resolveSearchProvider({
//       provider: 'openai-codex',
//       credential: { type: 'oauth', access: makeJwt('acc_123'), refresh: 'r', expires: Date.now() + 60_000 },
//     });
//     expect(provider).toBeInstanceOf(ChatGPTBackendSearchProvider);
//   });
//
//   it('selects ResponsesApiSearchProvider for openrouter + api_key', () => {
//     const provider = resolveSearchProvider({
//       provider: 'openrouter',
//       credential: { type: 'api_key', key: 'sk-or-test' },
//     });
//     expect(provider).toBeInstanceOf(ResponsesApiSearchProvider);
//   });
//
//   it('selects Google provider for google + api_key', () => {
//     const provider = resolveSearchProvider({
//       provider: 'google',
//       credential: { type: 'api_key', key: 'g-test' },
//     });
//     expect(provider).toBeInstanceOf(GoogleSearchProvider);
//   });
//
//   it('falls back to DDG for vercel-ai-gateway and other unknown providers', () => {
//     expect(
//       resolveSearchProvider({ provider: 'vercel-ai-gateway', credential: { type: 'api_key', key: 'x' } }),
//     ).toBeInstanceOf(DDGSearchProvider);
//     expect(
//       resolveSearchProvider({ provider: 'unknown', credential: { type: 'api_key', key: 'x' } }),
//     ).toBeInstanceOf(DDGSearchProvider);
//   });
//
//   it('falls back to DDG when openai provider has a custom baseUrl', () => {
//     const provider = resolveSearchProvider({
//       provider: 'openai',
//       credential: { type: 'api_key', key: 'gateway-key-not-for-openai' },
//       baseUrl: 'https://my-gateway.example.com/v1',
//     });
//     expect(provider).toBeInstanceOf(DDGSearchProvider);
//   });
// });
