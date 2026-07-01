import { afterEach, describe, expect, it } from 'bun:test';
import { piDriver } from './pi.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Stub global fetch, recording every call, and reply with the given status. */
function stubFetch(status: number) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true }), { status });
  }) as unknown as typeof fetch;
  return calls;
}

function headerValue(init: RequestInit, name: string): string | undefined {
  const headers = (init.headers ?? {}) as Record<string, string>;
  return headers[name] ?? headers[name.toLowerCase()];
}

describe('piDriver.buildRuntime custom endpoint models', () => {
  it('preserves explicit per-model supportsImages values', () => {
    const runtime = piDriver.buildRuntime({
      context: {
        provider: 'pi',
        authType: 'api_key',
        resolvedModel: 'vision-model',
        capabilities: { needsHttpPoolServer: false },
        connection: {
          slug: 'custom-endpoint',
          name: 'Custom Endpoint',
          providerType: 'pi',
          authType: 'api_key',
          baseUrl: 'http://127.0.0.1:11111/v1',
          customEndpoint: { api: 'anthropic-messages', supportsImages: true },
          models: [
            { id: 'vision-model', contextWindow: 262_144, supportsImages: true },
            { id: 'text-only-model', supportsImages: false },
            { id: 'plain-model' },
          ],
          createdAt: Date.now(),
        } as any,
      },
      coreConfig: {} as any,
      hostRuntime: {} as any,
      resolvedPaths: {
        piServerPath: '/tmp/pi-agent-server.js',
        interceptorBundlePath: '/tmp/interceptor.cjs',
        nodeRuntimePath: '/usr/bin/node',
      },
    });

    expect(runtime.customModels).toEqual([
      { id: 'vision-model', contextWindow: 262_144, supportsImages: true },
      { id: 'text-only-model', supportsImages: false },
      'plain-model',
    ]);
  });
});

describe('piDriver.testConnection custom endpoints (direct HTTP, no subprocess)', () => {
  const baseArgs = {
    provider: 'pi' as const,
    hostRuntime: {} as any,
    resolvedPaths: {} as any,
    timeoutMs: 20_000,
  };

  it('routes an OpenAI-compatible custom endpoint through a direct chat/completions call', async () => {
    const calls = stubFetch(200);

    const result = await piDriver.testConnection!({
      ...baseArgs,
      apiKey: 'sk-test-openai',
      model: 'my-custom-model',
      baseUrl: 'https://api.example.com/v1',
      connection: {
        providerType: 'pi_compat',
        piAuthProvider: 'openai',
        customEndpoint: { api: 'openai-completions' },
      } as any,
    });

    // Must take the direct-HTTP path (not return null → subprocess fallback).
    expect(result).toEqual({ success: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.example.com/v1/chat/completions');
    expect(headerValue(calls[0]!.init, 'authorization')).toBe('Bearer sk-test-openai');
  });

  it('routes an anthropic-messages custom endpoint through a direct v1/messages call', async () => {
    const calls = stubFetch(200);

    const result = await piDriver.testConnection!({
      ...baseArgs,
      apiKey: 'sk-test-anthropic',
      model: 'pi/some-model',
      baseUrl: 'https://anthropic.example.com',
      connection: {
        providerType: 'anthropic_compat',
        piAuthProvider: 'anthropic',
        customEndpoint: { api: 'anthropic-messages' },
      } as any,
    });

    expect(result).toEqual({ success: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://anthropic.example.com/v1/messages');
    expect(headerValue(calls[0]!.init, 'x-api-key')).toBe('sk-test-anthropic');
    // The Pi SDK 'pi/' prefix must be stripped before hitting the endpoint.
    expect(JSON.parse(String(calls[0]!.init.body)).model).toBe('some-model');
  });

  it('surfaces a real HTTP error instead of a generic timeout', async () => {
    stubFetch(401);

    const result = await piDriver.testConnection!({
      ...baseArgs,
      apiKey: 'bad-key',
      model: 'my-custom-model',
      baseUrl: 'https://api.example.com/v1',
      connection: {
        providerType: 'pi_compat',
        piAuthProvider: 'openai',
        customEndpoint: { api: 'openai-completions' },
      } as any,
    });

    expect(result?.success).toBe(false);
    expect(result?.error).toContain('401');
  });
});
