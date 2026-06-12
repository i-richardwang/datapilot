import { describe, expect, test } from 'bun:test'
import { splitMarkdownIntoBlocks } from '../split-markdown-blocks'

function joined(blocks: ReturnType<typeof splitMarkdownIntoBlocks>): string {
  return blocks!.map(b => b.raw).join('')
}

describe('splitMarkdownIntoBlocks', () => {
  test('splits typical streaming prose into independently parseable blocks', () => {
    const md = [
      '# Heading',
      '',
      'A paragraph with **bold** and `inline code`.',
      '',
      '- item one',
      '- item two',
      '',
      '```ts',
      'const x = 1',
      '```',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      'Trailing paragraph.',
    ].join('\n')

    const blocks = splitMarkdownIntoBlocks(md)
    expect(blocks).not.toBeNull()
    expect(blocks!.length).toBeGreaterThan(2)
    // Round-trip guarantee: blocks must reproduce the source exactly.
    expect(joined(blocks)).toBe(md)
    // A fenced code block must stay intact inside a single block.
    const codeBlock = blocks!.find((b) => b.raw.includes('```ts'))
    expect(codeBlock!.raw).toContain('const x = 1\n```')
  })

  test('lineOffset restores whole-document line numbers per block', () => {
    const md = 'para one\n\npara two\n\n```ts\ncode\n```\n'
    const blocks = splitMarkdownIntoBlocks(md)!
    expect(blocks[0]!.lineOffset).toBe(0)
    // block 1 ("para two") starts after "para one\n\n" = 2 source lines
    expect(blocks[1]!.lineOffset).toBe(2)
    // code fence block starts after 4 source lines
    expect(blocks[2]!.lineOffset).toBe(4)
  })

  test('keeps an unclosed trailing code fence in the tail block (streaming)', () => {
    const md = 'Paragraph done.\n\n```python\nprint("still streaming'
    const blocks = splitMarkdownIntoBlocks(md)
    expect(blocks).not.toBeNull()
    expect(joined(blocks)).toBe(md)
    expect(blocks![blocks!.length - 1]!.raw.startsWith('```python')).toBe(true)
  })

  test('folds leading blank lines into the first block (no whitespace-only block)', () => {
    const md = '\n\nfirst para\n\nsecond para'
    const blocks = splitMarkdownIntoBlocks(md)
    expect(blocks).not.toBeNull()
    expect(joined(blocks)).toBe(md)
    expect(blocks![0]!.raw.startsWith('\n\nfirst')).toBe(true)
  })

  test('returns null for single-block content (no benefit)', () => {
    expect(splitMarkdownIntoBlocks('just one paragraph')).toBeNull()
  })

  test('falls back on block math', () => {
    expect(splitMarkdownIntoBlocks('para\n\n$$\nx^2\n$$\n\npara')).toBeNull()
  })

  test('falls back on mermaid fences (positional first-mermaid handling)', () => {
    expect(splitMarkdownIntoBlocks('```mermaid\ngraph TD\n```\n\npara')).toBeNull()
  })

  test('falls back on footnotes and link reference definitions', () => {
    expect(splitMarkdownIntoBlocks('see note[^1]\n\n[^1]: the note')).toBeNull()
    expect(splitMarkdownIntoBlocks('see [docs][ref]\n\n[ref]: https://example.com')).toBeNull()
  })

  test('falls back on raw HTML blocks (rehype-raw may span blocks)', () => {
    expect(splitMarkdownIntoBlocks('<div class="note">\n\nsome *text*\n\n</div>')).toBeNull()
  })

  test('falls back on inline HTML too (unclosed tags propagate across blocks)', () => {
    expect(splitMarkdownIntoBlocks('Start <em>one\n\ntwo</em> end')).toBeNull()
    expect(splitMarkdownIntoBlocks('Uses <strong>inline</strong> html.\n\nSecond paragraph.')).toBeNull()
  })

  test('does NOT fall back on HTML-looking text inside code fences', () => {
    const md = 'Some prose.\n\n```html\n<div class="x">hi</div>\n```\n\nMore prose.'
    const blocks = splitMarkdownIntoBlocks(md)
    expect(blocks).not.toBeNull()
    expect(joined(blocks)).toBe(md)
  })

  test('blockquotes and nested lists stay intact across blank lines', () => {
    const md = '> quote line one\n> quote line two\n\n1. first\n   - nested\n2. second\n\nend.'
    const blocks = splitMarkdownIntoBlocks(md)
    expect(blocks).not.toBeNull()
    expect(joined(blocks)).toBe(md)
    expect(blocks!.some((b) => b.raw.includes('nested') && b.raw.includes('second'))).toBe(true)
  })
})
