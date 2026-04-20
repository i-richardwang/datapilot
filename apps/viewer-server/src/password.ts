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

export interface PasswordGateOk {
  state: 'ok'
}

export interface PasswordGateBlocked {
  state: 'password_required' | 'password_invalid'
}

export type PasswordGateResult = PasswordGateOk | PasswordGateBlocked

/** Read the submitted password from the request header (null when absent/blank). */
export function extractSubmittedPassword(req: Request): string | null {
  const raw = req.headers.get(PASSWORD_HEADER)
  if (raw == null) return null
  if (raw.length === 0) return null
  return raw
}

/** Normalize a password supplied by the creator — empty strings mean "no password". */
export function normalizePassword(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value.length === 0) return null
  return value
}

/** Hash a plaintext password with argon2id (Bun's built-in default). */
export async function hashPassword(plaintext: string): Promise<string> {
  return Bun.password.hash(plaintext, { algorithm: 'argon2id' })
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
