/**
 * Tests for the inline password-gate locale resolution + rendering.
 *
 * Covers the `Accept-Language` parser, the locale-match fallbacks, and
 * that the rendered HTML actually contains localized strings drawn from
 * the shared `webui.passwordPrompt.*` keys.
 */

import { describe, it, expect } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { LOCALE_REGISTRY } from '@craft-agent/shared/i18n'

import { getGateStrings, pickLocale } from '../gate-locale'
import { renderPasswordGate } from '../gate-page'
import { handleHtmlArtifactRoute, createApiHandler } from '../routes'
import { FsStorage } from '../storage/fs'

const BASE_URL = 'http://test.local'

describe('gate-locale pickLocale', () => {
  it('returns English when the header is missing or empty', () => {
    expect(pickLocale(null)).toBe('en')
    expect(pickLocale(undefined)).toBe('en')
    expect(pickLocale('')).toBe('en')
  })

  it('returns English when no requested tag matches a supported locale', () => {
    expect(pickLocale('fr,it;q=0.8,ru;q=0.5')).toBe('en')
  })

  it('matches exact BCP-47 tags case-insensitively', () => {
    expect(pickLocale('zh-Hans')).toBe('zh-Hans')
    expect(pickLocale('zh-hans')).toBe('zh-Hans')
    expect(pickLocale('ja')).toBe('ja')
    expect(pickLocale('DE')).toBe('de')
  })

  it('falls back to a primary-subtag match (e.g. zh-CN → zh-Hans)', () => {
    expect(pickLocale('zh-CN')).toBe('zh-Hans')
    expect(pickLocale('zh-TW,zh;q=0.9')).toBe('zh-Hans')
  })

  it('respects quality ordering rather than header order', () => {
    // Ja appears first but with lower quality than zh-Hans.
    expect(pickLocale('ja;q=0.4,zh-Hans;q=0.9,en;q=0.1')).toBe('zh-Hans')
  })

  it('skips zero-quality entries', () => {
    expect(pickLocale('zh-Hans;q=0,ja;q=0.5')).toBe('ja')
  })

  it('picks the first supported tag when no qualities are set', () => {
    expect(pickLocale('fr,de,ja')).toBe('de')
  })

  it('ignores the wildcard "*" token', () => {
    expect(pickLocale('*')).toBe('en')
    expect(pickLocale('*;q=0.5,de')).toBe('de')
  })
})

describe('gate-locale getGateStrings', () => {
  it('returns the English strings for the "en" locale', () => {
    const strings = getGateStrings('en')
    expect(strings.locale).toBe('en')
    expect(strings.title).toBe(LOCALE_REGISTRY.en.messages['webui.passwordPrompt.title'])
    expect(strings.description).toBe(
      LOCALE_REGISTRY.en.messages['webui.passwordPrompt.description'],
    )
    expect(strings.submit).toBe(LOCALE_REGISTRY.en.messages['webui.passwordPrompt.submit'])
    expect(strings.invalid).toBe(LOCALE_REGISTRY.en.messages['webui.passwordPrompt.invalid'])
    expect(strings.networkError).toBe('Network error')
    expect(strings.loadFailedTemplate).toContain('{{status}}')
  })

  it('returns Simplified Chinese strings for the "zh-Hans" locale', () => {
    const strings = getGateStrings('zh-Hans')
    expect(strings.locale).toBe('zh-Hans')
    expect(strings.title).toBe(LOCALE_REGISTRY['zh-Hans'].messages['webui.passwordPrompt.title'])
    expect(strings.submit).toBe(LOCALE_REGISTRY['zh-Hans'].messages['webui.passwordPrompt.submit'])
  })

  it('caches the result — repeated calls return the same object', () => {
    const a = getGateStrings('ja')
    const b = getGateStrings('ja')
    expect(a).toBe(b)
  })
})

describe('renderPasswordGate localization', () => {
  it('injects the locale into <html lang> and the localized title', () => {
    const zhStrings = getGateStrings('zh-Hans')
    const html = renderPasswordGate('/s/h/abc', 'html', zhStrings)
    expect(html).toContain('<html lang="zh-Hans">')
    expect(html).toContain(zhStrings.title)
    expect(html).toContain(zhStrings.description)
    expect(html).toContain(zhStrings.submit)
    // The error strings go into an embedded JSON literal in the <script>.
    expect(html).toContain(JSON.stringify(zhStrings.invalid).slice(1, -1))
  })

  it('falls back to English strings when locale is "en"', () => {
    const enStrings = getGateStrings('en')
    const html = renderPasswordGate('/s/h/abc', 'html', enStrings)
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('Password required')
    expect(html).toContain('Unlock')
  })

  it('does not leak any of the old hardcoded English strings into a non-English render', () => {
    const html = renderPasswordGate('/s/h/abc', 'html', getGateStrings('ja'))
    // Japanese render must not still contain the English originals that were
    // previously hardcoded in gate-page.ts.
    expect(html).not.toContain('Password required')
    expect(html).not.toContain('This share is protected')
  })
})

describe('handleHtmlArtifactRoute Accept-Language integration', () => {
  it('serves the gate in the matching locale for a browser with Accept-Language: zh-Hans', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'viewer-gate-i18n-'))
    try {
      const storage = new FsStorage(dataDir)
      await storage.initialize()
      const handleApi = createApiHandler(storage, BASE_URL)

      // Upload a password-protected HTML artifact.
      const html = '<!doctype html><html><body>Secret</body></html>'
      const uploadRes = await handleApi(
        new Request(`${BASE_URL}/s/api/html`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'x-share-password': 'hunter2' },
          body: html,
        }),
        '/s/api/html',
      )
      const { id } = (await uploadRes!.json()) as { id: string }

      // Browser hit with no password but Accept-Language: zh-Hans.
      const gateRes = await handleHtmlArtifactRoute(
        storage,
        new Request(`${BASE_URL}/s/h/${id}`, {
          headers: { accept: 'text/html', 'accept-language': 'zh-Hans,en;q=0.9' },
        }),
        `/s/h/${id}`,
      )
      expect(gateRes!.status).toBe(401)
      const body = await gateRes!.text()
      const expected = LOCALE_REGISTRY['zh-Hans'].messages['webui.passwordPrompt.title']!
      expect(body).toContain(expected)
      expect(body).toContain('<html lang="zh-Hans">')
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('falls back to the English gate when Accept-Language names only unsupported locales', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'viewer-gate-i18n-'))
    try {
      const storage = new FsStorage(dataDir)
      await storage.initialize()
      const handleApi = createApiHandler(storage, BASE_URL)

      const uploadRes = await handleApi(
        new Request(`${BASE_URL}/s/api/html`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'x-share-password': 'hunter2' },
          body: '<!doctype html><html><body>Secret</body></html>',
        }),
        '/s/api/html',
      )
      const { id } = (await uploadRes!.json()) as { id: string }

      const gateRes = await handleHtmlArtifactRoute(
        storage,
        new Request(`${BASE_URL}/s/h/${id}`, {
          headers: { accept: 'text/html', 'accept-language': 'fr-FR,ru;q=0.5' },
        }),
        `/s/h/${id}`,
      )
      expect(gateRes!.status).toBe(401)
      const body = await gateRes!.text()
      expect(body).toContain('<html lang="en">')
      expect(body).toContain('Password required')
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
