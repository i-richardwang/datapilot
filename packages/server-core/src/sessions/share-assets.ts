/**
 * Share-to-viewer asset collection.
 *
 * Walks the five file-backed markdown block types (`html-preview`,
 * `pdf-preview`, `image-preview`, `datatable`, `spreadsheet`) across a
 * session's messages, reads every referenced local file, uploads each to the
 * viewer-server's `/s/a` endpoint, and returns a manifest keyed by the
 * original src path. The session JSON that goes to the viewer carries this
 * manifest in its `assets` field; the markdown text is never rewritten.
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'
import type { StoredMessage, SharedAssetInfo } from '@craft-agent/shared/sessions'

/** Markdown code-fence languages we treat as file-backed previews. */
const FILE_BACKED_BLOCK_LANGS = new Set([
  'html-preview',
  'pdf-preview',
  'image-preview',
  'datatable',
  'spreadsheet',
])

/**
 * Mime type lookup for uploaded assets. Kept intentionally small and aligned
 * with the block types the viewer knows how to render; anything not covered
 * falls through to `application/octet-stream`, which is still fine — the
 * viewer reads bytes verbatim and decodes per call site.
 */
const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
}

function mimeFromPath(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Extract every referenced file path from a single fenced block's JSON spec.
 * Supports both the single-src shape (`{ src }`) and the multi-item shape
 * (`{ items: [{ src }] }`). Invalid JSON or missing `src` values yield an
 * empty list — broken blocks already degrade gracefully in the UI.
 */
function extractPathsFromBlock(blockBody: string): string[] {
  let spec: unknown
  try {
    spec = JSON.parse(blockBody)
  } catch {
    return []
  }
  if (!spec || typeof spec !== 'object') return []
  const s = spec as { src?: unknown; items?: unknown }
  const paths: string[] = []
  if (typeof s.src === 'string' && s.src.length > 0) {
    paths.push(s.src)
  }
  if (Array.isArray(s.items)) {
    for (const item of s.items) {
      if (item && typeof item === 'object' && typeof (item as { src?: unknown }).src === 'string') {
        const src = (item as { src: string }).src
        if (src.length > 0) paths.push(src)
      }
    }
  }
  return paths
}

/** Regex for fenced code blocks. Captures language and body. */
const FENCED_BLOCK_RE = /```([\w-]+)\s*\n([\s\S]*?)```/g

/**
 * Walk a message's markdown content and return every unique file path
 * referenced by a file-backed block. Duplicates within a message are
 * collapsed; the caller further dedupes across all messages.
 */
function extractPathsFromContent(content: string | undefined): string[] {
  if (!content) return []
  const paths: string[] = []
  let match: RegExpExecArray | null
  // Reset lastIndex — the regex is shared module-level but exec() maintains state.
  FENCED_BLOCK_RE.lastIndex = 0
  while ((match = FENCED_BLOCK_RE.exec(content)) !== null) {
    const lang = match[1]
    if (!lang || !FILE_BACKED_BLOCK_LANGS.has(lang)) continue
    const body = match[2] ?? ''
    paths.push(...extractPathsFromBlock(body))
  }
  return paths
}

/**
 * Collect the full set of distinct file paths referenced by file-backed
 * blocks in any message of a session. Paths appear in first-seen order so
 * upload failures are reported against the message that introduced them.
 */
export function collectReferencedFilePaths(messages: StoredMessage[]): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const msg of messages) {
    for (const path of extractPathsFromContent(msg.content)) {
      if (seen.has(path)) continue
      seen.add(path)
      ordered.push(path)
    }
  }
  return ordered
}

/**
 * Upload one asset to the viewer-server. Raw bytes in, `{ id, url }` out.
 * The viewer-server uses content sha256 as the id so repeated uploads with
 * identical bytes deduplicate automatically (cheap and idempotent).
 *
 * When `password` is set, the asset is uploaded behind the same gate as the
 * session itself so `/s/a/{id}` GETs also require the shared password.
 */
async function uploadAsset(
  viewerUrl: string,
  bytes: Uint8Array,
  mimeType: string,
  password?: string | null,
): Promise<{ id: string; url: string }> {
  // Upload a copied ArrayBuffer — it's the one body type that typechecks
  // under both the DOM lib (used in viewer/electron renderer) and the Bun
  // fetch types that server-core is built against.
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const headers: Record<string, string> = { 'Content-Type': mimeType }
  if (password && password.length > 0) headers['X-Share-Password'] = password
  const response = await fetch(`${viewerUrl}/s/a`, {
    method: 'POST',
    headers,
    body: ab as ArrayBuffer,
  })
  if (!response.ok) {
    throw new Error(`Upload asset failed: ${response.status}`)
  }
  return (await response.json()) as { id: string; url: string }
}

/**
 * Read each referenced file from disk, upload to the viewer-server, and
 * return the `assets` manifest. Unreadable files are skipped with a warning
 * callback so one broken link doesn't sink the whole share — the viewer
 * already renders a "Cannot load content" fallback when a path is missing
 * from the manifest, which is the correct graceful-degradation behavior.
 */
export async function buildAssetsManifest(
  paths: string[],
  viewerUrl: string,
  onError?: (path: string, error: unknown) => void,
  password?: string | null,
): Promise<Record<string, SharedAssetInfo>> {
  const manifest: Record<string, SharedAssetInfo> = {}
  for (const path of paths) {
    try {
      const buffer = await readFile(path)
      const mimeType = mimeFromPath(path)
      const { url } = await uploadAsset(viewerUrl, new Uint8Array(buffer), mimeType, password)
      manifest[path] = { mimeType, url }
    } catch (error) {
      onError?.(path, error)
    }
  }
  return manifest
}

/**
 * Extract the asset id from an `/s/a/{id}` URL (for revoke / diff cleanup).
 * Returns null when the URL doesn't match the expected shape, which lets
 * callers ignore legacy entries without raising.
 */
export function parseAssetIdFromUrl(url: string): string | null {
  const match = url.match(/\/s\/a\/([a-zA-Z0-9_-]+)$/)
  return match?.[1] ?? null
}

/**
 * Fire-and-forget DELETE of an uploaded asset. Individual failures are
 * swallowed (logged by the caller) because revoke is a best-effort cleanup —
 * orphans are still unreachable without the session URL.
 */
export async function deleteAsset(viewerUrl: string, id: string, password?: string | null): Promise<void> {
  const headers: Record<string, string> = {}
  if (password && password.length > 0) headers['X-Share-Password'] = password
  const response = await fetch(`${viewerUrl}/s/a/${id}`, { method: 'DELETE', headers })
  if (!response.ok && response.status !== 404) {
    throw new Error(`Delete asset ${id} failed: ${response.status}`)
  }
}
