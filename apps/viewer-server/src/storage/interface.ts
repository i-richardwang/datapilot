/**
 * Storage interface for shared session persistence.
 *
 * Implementations: filesystem (default) and S3-compatible object storage.
 */

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
