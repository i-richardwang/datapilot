/**
 * Storage interface for shared session persistence.
 *
 * Implementations: filesystem (default) and S3-compatible object storage.
 */

/** The three kinds of share that can be password-protected. */
export type ShareKind = 'session' | 'html' | 'asset'

export interface SessionStorage {
  /** Save a session JSON blob by ID. */
  save(id: string, data: unknown): Promise<void>

  /** Load a session by ID. Returns null if not found. */
  load(id: string): Promise<unknown | null>

  /** Delete a session by ID. Returns true if it existed. */
  delete(id: string): Promise<boolean>

  /** Save a long-lived HTML artifact by ID. */
  saveHtml(id: string, html: string): Promise<void>

  /** Load an HTML artifact by ID. Returns null if not found. */
  loadHtml(id: string): Promise<string | null>

  /** Overwrite an existing HTML artifact by ID. Returns true if it existed. */
  updateHtml(id: string, html: string): Promise<boolean>

  /** Delete an HTML artifact by ID. Returns true if it existed. */
  deleteHtml(id: string): Promise<boolean>

  /** Save a file asset by ID with its mime type. Idempotent — same id overwrites. */
  saveAsset(id: string, data: Uint8Array, mimeType: string): Promise<void>

  /** Load an asset by ID. Returns null if not found. */
  loadAsset(id: string): Promise<{ data: Uint8Array; mimeType: string } | null>

  /** Delete an asset by ID. Returns true if it existed. */
  deleteAsset(id: string): Promise<boolean>

  /**
   * Password metadata — opt-in. Implementations persist the hash as a sidecar
   * next to the content so the share content itself stays bytes-for-bytes
   * identical to the no-password case.
   */
  setPasswordHash(kind: ShareKind, id: string, hash: string | null): Promise<void>
  loadPasswordHash(kind: ShareKind, id: string): Promise<string | null>
}

/** Generate a URL-safe short ID (similar to the format used by the official viewer). */
export function generateId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  // Base64url encode and trim padding
  const raw = Buffer.from(bytes).toString('base64url')
  // Insert dashes for readability (matches upstream format like "tz5-13I84pwK_he")
  return `${raw.slice(0, 3)}-${raw.slice(3, 11)}_${raw.slice(11)}`
}

/**
 * Generate an ID for HTML artifacts. URL itself is the only access credential,
 * so we use 16 random bytes (≈22 base64url chars) for unguessability.
 */
export function generateHtmlId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64url')
}

/**
 * Generate an ID for a file asset from its content bytes. The id is the
 * hex-encoded sha256 of the bytes, so identical uploads deduplicate on both
 * sides without extra bookkeeping.
 */
export async function generateAssetId(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes)
  const arr = new Uint8Array(buf)
  let hex = ''
  for (const b of arr) hex += b.toString(16).padStart(2, '0')
  return hex
}
