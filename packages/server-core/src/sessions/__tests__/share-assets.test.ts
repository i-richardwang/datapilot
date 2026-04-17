/**
 * Unit tests for the share-to-viewer asset collector.
 *
 * Covers the block walk (language gating, single-src + items shapes) and the
 * parseAssetIdFromUrl helper used by update/revoke cleanup. Upload/IO paths
 * are deliberately not exercised here — they hit real fs and network, which
 * are covered at integration time.
 */

import { describe, it, expect } from 'bun:test'
import type { StoredMessage } from '@craft-agent/shared/sessions'
import {
  collectReferencedFilePaths,
  parseAssetIdFromUrl,
} from '../share-assets'

function userMsg(content: string): StoredMessage {
  return { id: 'm', type: 'user', content } as StoredMessage
}

describe('collectReferencedFilePaths', () => {
  it('returns paths from every file-backed block type', () => {
    const messages: StoredMessage[] = [
      userMsg(
        '```html-preview\n' +
          JSON.stringify({ src: '/a.html' }) +
          '\n```',
      ),
      userMsg(
        '```pdf-preview\n' +
          JSON.stringify({ src: '/b.pdf' }) +
          '\n```',
      ),
      userMsg(
        '```image-preview\n' +
          JSON.stringify({ items: [{ src: '/c.png' }, { src: '/d.jpg' }] }) +
          '\n```',
      ),
      userMsg(
        '```datatable\n' +
          JSON.stringify({ src: '/e.json', columns: [], rows: [] }) +
          '\n```',
      ),
      userMsg(
        '```spreadsheet\n' +
          JSON.stringify({ src: '/f.json' }) +
          '\n```',
      ),
    ]
    expect(collectReferencedFilePaths(messages)).toEqual([
      '/a.html',
      '/b.pdf',
      '/c.png',
      '/d.jpg',
      '/e.json',
      '/f.json',
    ])
  })

  it('deduplicates repeated paths across messages', () => {
    const messages: StoredMessage[] = [
      userMsg('```html-preview\n' + JSON.stringify({ src: '/a.html' }) + '\n```'),
      userMsg('```html-preview\n' + JSON.stringify({ src: '/a.html' }) + '\n```'),
    ]
    expect(collectReferencedFilePaths(messages)).toEqual(['/a.html'])
  })

  it('ignores blocks in other languages (json, diff, mermaid)', () => {
    const messages: StoredMessage[] = [
      userMsg('```json\n' + JSON.stringify({ src: '/not-a-preview.json' }) + '\n```'),
      userMsg('```diff\n- old\n+ new\n```'),
      userMsg('```mermaid\ngraph TD\nA-->B\n```'),
    ]
    expect(collectReferencedFilePaths(messages)).toEqual([])
  })

  it('tolerates invalid JSON inside a preview block', () => {
    const messages: StoredMessage[] = [
      userMsg('```html-preview\n{not-json}\n```'),
      userMsg('```pdf-preview\n' + JSON.stringify({ src: '/b.pdf' }) + '\n```'),
    ]
    expect(collectReferencedFilePaths(messages)).toEqual(['/b.pdf'])
  })

  it('ignores items without a valid src', () => {
    const messages: StoredMessage[] = [
      userMsg(
        '```image-preview\n' +
          JSON.stringify({ items: [{ src: '/a.png' }, { label: 'no-src' }, { src: '' }] }) +
          '\n```',
      ),
    ]
    expect(collectReferencedFilePaths(messages)).toEqual(['/a.png'])
  })

  it('handles messages without content gracefully', () => {
    const messages = [
      { id: '1', type: 'user' } as StoredMessage,
      userMsg(''),
    ]
    expect(collectReferencedFilePaths(messages)).toEqual([])
  })
})

describe('parseAssetIdFromUrl', () => {
  it('extracts the id from an /s/a/{id} URL', () => {
    expect(parseAssetIdFromUrl('https://viewer.example/s/a/abc123')).toBe('abc123')
  })

  it('returns null for non-asset URLs', () => {
    expect(parseAssetIdFromUrl('https://viewer.example/s/h/abc123')).toBeNull()
    expect(parseAssetIdFromUrl('')).toBeNull()
  })
})
