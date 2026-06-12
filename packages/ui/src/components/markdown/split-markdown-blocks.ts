import { marked } from 'marked'
import type { Token } from 'marked'

export interface MarkdownBlock {
  /** Raw markdown source of this block (concatenation of all blocks reproduces the document byte-for-byte). */
  raw: string
  /**
   * Number of source lines before this block — added to react-markdown's
   * block-relative node positions so annotation anchors
   * (data-ca-block-path/-id, see wrapBlock in Markdown.tsx) keep the same
   * whole-document line numbers a single-document parse would produce.
   */
  lineOffset: number
}

/** Recursively check for HTML tokens at any nesting level (inline included). */
function containsHtmlToken(tokens: Token[] | undefined): boolean {
  if (!tokens) return false
  for (const token of tokens) {
    if (token.type === 'html' || token.type === 'def') return true
    const t = token as Token & { tokens?: Token[]; items?: Token[]; rows?: { tokens: Token[] }[][]; header?: { tokens: Token[] }[] }
    if (containsHtmlToken(t.tokens)) return true
    if (t.items && containsHtmlToken(t.items as unknown as Token[])) return true
    if (t.header && t.header.some(cell => containsHtmlToken(cell.tokens))) return true
    if (t.rows && t.rows.some(row => row.some(cell => containsHtmlToken(cell.tokens)))) return true
  }
  return false
}

function countLines(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++
  }
  return n
}

/**
 * Split markdown into top-level blocks (paragraphs, fenced code, lists,
 * tables, …) that are safe to parse independently of each other. Used by
 * MemoizedMarkdown so that during streaming only the trailing in-progress
 * block re-parses (the block-memoization pattern from the Vercel AI SDK
 * "Markdown Chatbot with Memoization" cookbook).
 *
 * Returns null when the content contains constructs whose rendering depends
 * on cross-block context — those must be parsed as one document:
 * - `$$` block math may span blank lines (remark-math flow fences)
 * - ```` ```mermaid ```` participates in positional first-mermaid handling
 * - footnotes and link reference definitions resolve document-wide
 * - raw HTML (block or inline) may open/close tags across blocks (rehype-raw)
 * - empty list items: marked terminates a list after an empty leading item
 *   ("- \n- b" lexes as two list tokens) while remark parses one list, so the
 *   split would render two <ul>s where the whole-document parse renders one
 */
export function splitMarkdownIntoBlocks(markdown: string): MarkdownBlock[] | null {
  if (
    markdown.includes('$$') ||
    markdown.includes('```mermaid') ||
    markdown.includes('[^') ||
    /^ {0,3}\[[^\]]+\]:/m.test(markdown) ||
    /^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]*$/m.test(markdown)
  ) {
    return null
  }

  let tokens: ReturnType<typeof marked.lexer>
  try {
    tokens = marked.lexer(markdown)
  } catch {
    return null
  }

  if (containsHtmlToken(tokens)) return null

  const raws: string[] = []
  // Leading whitespace folds into the FIRST block, trailing/in-between
  // whitespace into the PRECEDING block — boundaries stay byte-exact and no
  // whitespace-only block is emitted (which would render an extra separator).
  let pendingLeading = ''
  for (const token of tokens) {
    if (token.type === 'space') {
      if (raws.length > 0) {
        raws[raws.length - 1] += token.raw
      } else {
        pendingLeading += token.raw
      }
    } else {
      raws.push(pendingLeading + token.raw)
      pendingLeading = ''
    }
  }
  if (raws.length < 2) return null
  // Safety net: the blocks must reproduce the source byte-for-byte,
  // otherwise rendering them independently could drop or alter content.
  if (raws.join('') !== markdown) return null

  const blocks: MarkdownBlock[] = []
  let lineOffset = 0
  for (const raw of raws) {
    blocks.push({ raw, lineOffset })
    lineOffset += countLines(raw)
  }
  return blocks
}
