/**
 * Password protection for share links — argon2id hashing via `Bun.password`.
 *
 * Threat model: a leaked share URL. When a share is password-protected,
 * anyone who knows the URL still has to supply the correct password.
 * The password is hashed at rest (no plaintext on disk/S3) and the client
 * submits it via the `X-Share-Password` request header.
 *
 * Password changes require the current password so that possession of the
 * URL alone can't strip the gate.
 */

import type { SessionStorage, ShareKind } from './storage/interface'

export const PASSWORD_HEADER = 'x-share-password'

/**
 * Upper bound on accepted password length (bytes of the UTF-8 string, via
 * `.length` over the 16-bit code units — close enough for a sanity cap).
 * Prevents an attacker from forcing the Argon2id hasher to chew through
 * megabyte-sized submissions. Creator-side overlong values are treated
 * identically to empty strings ("no password"); reader-side overlong
 * submissions are treated as absent and fall through to `password_required`.
 */
export const MAX_PASSWORD_LENGTH = 256

export interface PasswordGateOk {
  state: 'ok'
}

export interface PasswordGateBlocked {
  state: 'password_required' | 'password_invalid'
}

export type PasswordGateResult = PasswordGateOk | PasswordGateBlocked

/** Read the submitted password from the request header (null when absent/blank/overlong). */
export function extractSubmittedPassword(req: Request): string | null {
  const raw = req.headers.get(PASSWORD_HEADER)
  if (raw == null) return null
  if (raw.length === 0) return null
  if (raw.length > MAX_PASSWORD_LENGTH) return null
  return raw
}

/** Normalize a password supplied by the creator — empty or overlong strings mean "no password". */
export function normalizePassword(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.length === 0) return null
  if (value.length > MAX_PASSWORD_LENGTH) return null
  return value
}

/**
 * Hash a plaintext password with argon2id.
 *
 * Cost parameters are pinned to the OWASP Password Storage Cheat Sheet
 * minimum for argon2id (19 MiB memory, t=2) rather than relying on Bun's
 * unspecified defaults — Bun's own docs recommend callers pin these to
 * avoid drift across runtime versions. argon2id encodes the parameters
 * into the hash string, so `verify` reads them from there; older hashes
 * produced with different costs continue to verify.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return Bun.password.hash(plaintext, {
    algorithm: 'argon2id',
    memoryCost: 19456,
    timeCost: 2,
  })
}

/** Constant-time verification against a stored hash. */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(plaintext, hash)
  } catch {
    // Malformed hash or unsupported algorithm — treat as failed match.
    return false
  }
}

/**
 * Check whether a request satisfies the password gate for a given share.
 * Returns `{ state: 'ok' }` for unprotected shares or correct passwords.
 * Callers should translate blocked results into a 401 with a stable JSON body.
 */
export async function checkPasswordGate(
  storage: SessionStorage,
  kind: ShareKind,
  id: string,
  req: Request,
): Promise<PasswordGateResult> {
  const hash = await storage.loadPasswordHash(kind, id)
  if (hash == null) return { state: 'ok' }
  const submitted = extractSubmittedPassword(req)
  if (submitted == null) return { state: 'password_required' }
  const matched = await verifyPassword(submitted, hash)
  return matched ? { state: 'ok' } : { state: 'password_invalid' }
}

/** Standard 401 response body shape for a blocked gate. */
export function blockedResponse(state: 'password_required' | 'password_invalid'): Response {
  return Response.json({ error: state }, { status: 401 })
}
