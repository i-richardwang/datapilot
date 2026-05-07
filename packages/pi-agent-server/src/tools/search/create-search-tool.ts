/**
 * Creates a `web_search` ToolDefinition backed by an ordered cascade of providers.
 *
 * The tool tries each provider in order. The first one that succeeds returns its
 * results; failures are logged server-side via console.warn but never surfaced
 * to the LLM, so partial-key fragments in upstream error bodies cannot leak into
 * the model context (regression guarded by tests).
 *
 * The tool name is always `web_search` regardless of which provider answered;
 * the model only sees `(via <ProviderName>)` in the result text.
 */

import { Type } from '@sinclair/typebox';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { WebSearchProvider, WebSearchResult } from './types.ts';
import { DDGSearchProvider } from './providers/ddg.ts';

const schema = Type.Object({
  query: Type.String({ description: 'The search query' }),
  count: Type.Optional(
    Type.Number({
      description: 'Max results (1-10, default 5)',
      minimum: 1,
      maximum: 10,
    }),
  ),
});

function formatResults(
  query: string,
  providerName: string,
  results: WebSearchResult[],
  // [fork] note dropped — `(via ${providerName})` already conveys fallback;
  // primary-error body was leaking partial API key into LLM context.
  // _note?: string,
) {
  const formatted = results
    .map(
      (r, i) =>
        `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`,
    )
    .join('\n\n');

  // [fork] suppressed — see note above.
  // const noteText = note ? `${note}\n\n` : '';

  return {
    content: [
      {
        type: 'text' as const,
        text: `Search results for "${query}" (via ${providerName}):\n\n${formatted}`,
      },
    ],
    details: {},
  };
}

// [fork] kept for upstream parity — re-enable if note is restored.
// function formatErrorSnippet(message: string, max = 180): string {
//   const compact = message.replace(/\s+/g, ' ').trim();
//   if (!compact) return 'unknown error';
//   return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
// }

/**
 * [fork] Build a `web_search` tool from an ordered provider cascade.
 *
 * Behavior:
 *   - Try `providers[0]`; on success → return formatted results with attribution.
 *   - On error → console.warn server-side (provider name + message) and continue to next.
 *   - All failed → return isError:true with provider-name + message list. Provider
 *     implementations MUST NOT include upstream response bodies in their error
 *     messages (TinyFish/Exa/DDG providers in this fork follow that rule), so the
 *     joined message is safe for the LLM context.
 *
 * The single-arg legacy form `createSearchTool(provider, fallback?=DDG)` is kept
 * commented below for upstream-rebase visibility.
 */
export function createSearchTool(
  providers: WebSearchProvider[],
): ToolDefinition<typeof schema> {
  if (!Array.isArray(providers) || providers.length === 0) {
    throw new Error('createSearchTool: providers array must be non-empty');
  }

  return {
    name: 'web_search',
    label: 'Web Search',
    description:
      'Search the web for current information. Returns titles, URLs, and snippets. Use for current information, documentation lookups, or fact-checking.',
    promptSnippet:
      'Use web_search for up-to-date information, documentation lookups, or fact-checking. Returns titles, URLs, and snippets. Accepts a query string and optional count (1-10).',
    parameters: schema,
    async execute(_toolCallId, params) {
      const { query } = params;
      const count = Math.max(1, Math.min(10, params.count ?? 5));

      const failures: { provider: string; message: string }[] = [];

      for (const provider of providers) {
        try {
          const results = await provider.search(query, count);
          return formatResults(query, provider.name, results);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          failures.push({ provider: provider.name, message: msg });
          // Server-side log only — never enters tool result text.
          console.warn(
            `[web_search] provider "${provider.name}" failed: ${msg}; trying next in cascade`,
          );
        }
      }

      const summary =
        failures.length === 1
          ? `Search failed for "${query}": ${failures[0]!.provider} failed with "${failures[0]!.message}"`
          : `Search failed for "${query}": ${failures
              .map((f) => `${f.provider} failed with "${f.message}"`)
              .join('; ')}`;

      return {
        content: [{ type: 'text' as const, text: summary }],
        details: { isError: true },
      };
    },
  };
}

// [fork] Legacy upstream signature — retired. Kept for rebase visibility.
// =============================================================================
// export function createSearchTool(
//   provider: WebSearchProvider,
//   fallbackProvider: WebSearchProvider = new DDGSearchProvider(),
// ): ToolDefinition<typeof schema> {
//   return {
//     name: 'web_search',
//     label: 'Web Search',
//     description: 'Search the web …',
//     promptSnippet: 'Use web_search …',
//     parameters: schema,
//     async execute(toolCallId, params) {
//       const { query } = params;
//       const count = Math.max(1, Math.min(10, params.count ?? 5));
//       try {
//         const results = await provider.search(query, count);
//         return formatResults(query, provider.name, results);
//       } catch (err) {
//         const primaryMsg = err instanceof Error ? err.message : String(err);
//         const canFallback = provider.name !== fallbackProvider.name;
//         if (canFallback) {
//           try {
//             const fallbackResults = await fallbackProvider.search(query, count);
//             // [fork] dropped fallback note arg — `(via ${fallbackProvider.name})`
//             // is enough; the primary error body was leaking key fragments into LLM context.
//             return formatResults(query, fallbackProvider.name, fallbackResults);
//           } catch (fallbackErr) {
//             const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
//             return {
//               content: [
//                 { type: 'text' as const, text: `Search failed for "${query}": primary (${provider.name}) failed with "${primaryMsg}"; fallback (${fallbackProvider.name}) failed with "${fallbackMsg}"` },
//               ],
//               details: { isError: true },
//             };
//           }
//         }
//         return {
//           content: [{ type: 'text' as const, text: `Search failed for "${query}": ${primaryMsg}` }],
//           details: { isError: true },
//         };
//       }
//     },
//   };
// }

