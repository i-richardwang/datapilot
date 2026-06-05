/**
 * [fork] Multi-key support for web_search / web_fetch providers.
 *
 * Each provider env var (TINYFISH_API_KEY, FIRECRAWL_API_KEY, TAVILY_API_KEY,
 * EXA_API_KEY) accepts ONE or MANY keys, comma-separated:
 *
 *   TINYFISH_API_KEY=key_a,key_b,key_c
 *
 * Vendors rate-limit per key; holding two accounts and spreading requests across
 * their keys raises the effective ceiling. `parseKeys` is the env-layer step:
 * it splits the raw value on commas into a trimmed, deduped, non-empty list.
 * `pickKey` is the request-layer step: it selects ONE key per request at random
 * so load spreads across the pool.
 *
 * Selection is random by design — no per-instance pointer state to persist, and
 * (per the resolve-provider docstrings) a failed request falls through to the
 * next *vendor* in the cascade rather than retrying within the same vendor.
 *
 * A single configured key degrades to the pre-fork behavior exactly:
 *   parseKeys('key')      -> ['key']
 *   pickKey('key')        -> 'key'
 *   pickKey(['key'])      -> 'key'
 *
 * Comma-splitting lives ONLY here at the env layer. Providers receive an already-
 * normalized `string | string[]` and never re-split, so a single literal key that
 * happens to contain a comma is never mistaken for two keys downstream.
 */
// [fork] new file

/**
 * Env-layer: normalize a raw env value into a deduped, trimmed key list.
 * Returns an empty array for undefined / non-string / blank / comma-only values.
 */
export function parseKeys(raw: string | undefined): string[] {
  if (typeof raw !== 'string') return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    keys.push(trimmed);
  }
  return keys;
}

/**
 * Request-layer: pick one key from a provider's configured key(s) at random.
 * Accepts the raw `string | string[]` a provider holds; trims and dedupes
 * defensively. Throws when no usable key remains (callers configure providers
 * only when at least one key is present, so this should be unreachable).
 */
export function pickKey(input: string | string[]): string {
  const raw = Array.isArray(input) ? input : [input];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const k of raw) {
    if (typeof k !== 'string') continue;
    const trimmed = k.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    keys.push(trimmed);
  }
  if (keys.length === 0) {
    throw new Error('pickKey: no API key configured');
  }
  if (keys.length === 1) return keys[0]!;
  return keys[Math.floor(Math.random() * keys.length)]!;
}
