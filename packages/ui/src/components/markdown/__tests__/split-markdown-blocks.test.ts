import { describe, expect, test } from 'bun:test'
import { splitMarkdownIntoBlocks } from '../split-markdown-blocks'

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
    expect(blocks!.join('')).toBe(md)
    // A fenced code block must stay intact inside a single block.
    const codeBlock = blocks!.find((b) => b.includes('```ts'))
    expect(codeBlock).toContain('const x = 1\n```')
  })

  test('keeps an unclosed trailing code fence in the tail block (streaming)', () => {
    const md = 'Paragraph done.\n\n```python\nprint("still streaming'
    const blocks = splitMarkdownIntoBlocks(md)
    expect(blocks).not.toBeNull()
    expect(blocks!.join('')).toBe(md)
    expect(blocks![blocks!.length - 1].startsWith('```python')).toBe(true)
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

  test('keeps inline HTML within a paragraph splittable', () => {
    const md = 'Uses <strong>inline</strong> html.\n\nSecond paragraph.'
    const blocks = splitMarkdownIntoBlocks(md)
    expect(blocks).not.toBeNull()
    expect(blocks!.join('')).toBe(md)
  })

  test('blockquotes and nested lists stay intact across blank lines', () => {
    const md = '> quote line one\n> quote line two\n\n1. first\n   - nested\n2. second\n\nend.'
    const blocks = splitMarkdownIntoBlocks(md)
    expect(blocks).not.toBeNull()
    expect(blocks!.join('')).toBe(md)
    expect(blocks!.some((b) => b.includes('nested') && b.includes('second'))).toBe(true)
  })
})
