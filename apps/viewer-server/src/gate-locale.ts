/**
 * Locale resolution for the inline password gate page.
 *
 * Parses `Accept-Language` with a simple quality-ordered match against the
 * shared locale registry, then pulls the `webui.passwordPrompt.*` keys for
 * the best match. English is the fallback when no supported locale is
 * requested or the header is missing / malformed.
 */

import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'

export type SupportedLocale = keyof typeof LOCALE_REGISTRY

export interface GateStrings {
  /** BCP-47 tag to place on the `<html lang>` attribute. */
  locale: SupportedLocale
  title: string
  description: string
  submit: string
  invalid: string
  networkError: string
  /** "Failed to load (status {{status}})" — substitute `{{status}}` client-side. */
  loadFailedTemplate: string
}

const SUPPORTED = Object.keys(LOCALE_REGISTRY) as SupportedLocale[]

/**
 * Lookup by exact BCP-47 tag, case-insensitive.
 * e.g. "zh-hans" → "zh-Hans".
 */
const EXACT_MAP = new Map<string, SupportedLocale>(
  SUPPORTED.map((code) => [code.toLowerCase(), code]),
)

/**
 * Lookup by primary subtag. e.g. "zh" (or any "zh-*") → "zh-Hans".
 * Built from the registry in iteration order, so the first registered
 * variant wins.
 */
const PRIMARY_MAP = new Map<string, SupportedLocale>()
for (const code of SUPPORTED) {
  const primary = code.split('-')[0]!.toLowerCase()
  if (!PRIMARY_MAP.has(primary)) PRIMARY_MAP.set(primary, code)
}

interface ParsedTag {
  tag: string
  q: number
}

function parseAcceptLanguage(header: string): ParsedTag[] {
  const entries: ParsedTag[] = []
  for (const part of header.split(',')) {
    const item = part.trim()
    if (!item) continue
    const [rawTag, ...params] = item.split(';')
    const tag = rawTag!.trim().toLowerCase()
    if (!tag || tag === '*') continue
    let q = 1
    for (const param of params) {
      const match = param.trim().match(/^q=([\d.]+)$/i)
      if (match) {
        const parsed = parseFloat(match[1]!)
        if (!Number.isNaN(parsed)) q = parsed
      }
    }
    if (q > 0) entries.push({ tag, q })
  }
  // Stable sort by quality descending — ties preserve header order, which
  // matches the user's stated preference.
  entries.sort((a, b) => b.q - a.q)
  return entries
}

function matchTag(tag: string): SupportedLocale | null {
  const exact = EXACT_MAP.get(tag)
  if (exact) return exact
  const primary = tag.split('-')[0]!
  return PRIMARY_MAP.get(primary) ?? null
}

/**
 * Pick the best-matching supported locale for an `Accept-Language` header.
 * Falls back to English when the header is missing, malformed, or names
 * only unsupported locales.
 */
export function pickLocale(acceptLanguage: string | null | undefined): SupportedLocale {
  if (!acceptLanguage) return 'en'
  for (const { tag } of parseAcceptLanguage(acceptLanguage)) {
    const matched = matchTag(tag)
    if (matched) return matched
  }
  return 'en'
}

const STRINGS_CACHE = new Map<SupportedLocale, GateStrings>()

function readKey(locale: SupportedLocale, key: string): string {
  const messages = LOCALE_REGISTRY[locale].messages as Record<string, string>
  const value = messages[key]
  if (typeof value === 'string') return value
  // Should never happen: the registry tests enforce key parity across locales.
  // Fall back to English rather than crashing a browser hit on a protected link.
  const fallback = (LOCALE_REGISTRY.en.messages as Record<string, string>)[key]
  return fallback ?? key
}

/**
 * Load the `webui.passwordPrompt.*` strings for the given locale, cached
 * so repeated gate renders don't re-walk the locale map.
 */
export function getGateStrings(locale: SupportedLocale): GateStrings {
  const cached = STRINGS_CACHE.get(locale)
  if (cached) return cached
  const strings: GateStrings = {
    locale,
    title: readKey(locale, 'webui.passwordPrompt.title'),
    description: readKey(locale, 'webui.passwordPrompt.description'),
    submit: readKey(locale, 'webui.passwordPrompt.submit'),
    invalid: readKey(locale, 'webui.passwordPrompt.invalid'),
    networkError: readKey(locale, 'webui.passwordPrompt.networkError'),
    loadFailedTemplate: readKey(locale, 'webui.passwordPrompt.loadFailed'),
  }
  STRINGS_CACHE.set(locale, strings)
  return strings
}

/**
 * Convenience: resolve the locale from a request's `Accept-Language` header
 * and return the gate strings in one step.
 */
export function getGateStringsForRequest(req: Request): GateStrings {
  return getGateStrings(pickLocale(req.headers.get('accept-language')))
}
