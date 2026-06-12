import { marked } from 'marked'

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
 * - raw HTML blocks may open/close tags across blocks (rehype-raw)
 */
export function splitMarkdownIntoBlocks(markdown: string): string[] | null {
  if (
    markdown.includes('$$') ||
    markdown.includes('```mermaid') ||
    markdown.includes('[^') ||
    /^ {0,3}\[[^\]]+\]:/m.test(markdown)
  ) {
    return null
  }

  let tokens: ReturnType<typeof marked.lexer>
  try {
    tokens = marked.lexer(markdown)
  } catch {
    return null
  }

  const blocks: string[] = []
  for (const token of tokens) {
    if (token.type === 'html' || token.type === 'def') return null
    if (token.type === 'space' && blocks.length > 0) {
      // Fold inter-block whitespace into the preceding block so block
      // boundaries stay byte-exact against the source.
      blocks[blocks.length - 1] += token.raw
    } else {
      blocks.push(token.raw)
    }
  }
  if (blocks.length < 2) return null
  // Safety net: the blocks must reproduce the source byte-for-byte,
  // otherwise rendering them independently could drop or alter content.
  if (blocks.join('') !== markdown) return null
  return blocks
}
