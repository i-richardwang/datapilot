/**
 * Tests for opt-in password protection across all three share kinds.
 *
 * Covers: creation with password, read/update/delete gating, and the
 * password-management endpoints (set / change / remove). No-password shares
 * keep behaving exactly as today — that contract is verified alongside.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createApiHandler, createAssetHandler, handleHtmlArtifactRoute } from '../routes'
import { FsStorage } from '../storage/fs'

const BASE_URL = 'http://test.local'

describe('viewer-server password protection', () => {
  let dataDir: string
  let storage: FsStorage
  let handleApi: ReturnType<typeof createApiHandler>
  let handleAsset: ReturnType<typeof createAssetHandler>

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-pw-test-'))
    storage = new FsStorage(dataDir)
    await storage.initialize()
    handleApi = createApiHandler(storage, BASE_URL)
    handleAsset = createAssetHandler(storage, BASE_URL)
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
  })

  // ---------------------------------------------------------------------
  // Session JSON
  // ---------------------------------------------------------------------

  describe('session JSON', () => {
    it('no-password create + GET behaves exactly as before', async () => {
      const res = await handleApi(
        new Request(`${BASE_URL}/s/api`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hello: 'world' }),
        }),
        '/s/api',
      )
      expect(res!.status).toBe(201)
      const body = (await res!.json()) as { id: string; url: string; hasPassword: boolean }
      expect(body.hasPassword).toBe(false)

      const getRes = await handleApi(
        new Request(`${BASE_URL}/s/api/${body.id}`),
        `/s/api/${body.id}`,
      )
      expect(getRes!.status).toBe(200)
      expect(await getRes!.json()).toEqual({ hello: 'world' })
    })

    it('creating with a password stores a hash, not plaintext, on disk', async () => {
      const secret = 'open-sesame'
      const res = await handleApi(
        new Request(`${BASE_URL}/s/api`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Share-Password': secret },
          body: JSON.stringify({ hello: 'protected' }),
        }),
        '/s/api',
      )
      expect(res!.status).toBe(201)
      const { id, hasPassword } = (await res!.json()) as { id: string; hasPassword: boolean }
      expect(hasPassword).toBe(true)

      const pwdFile = join(dataDir, `${id}.json.pwd`)
      expect(existsSync(pwdFile)).toBe(true)
      const stored = await Bun.file(pwdFile).text()
      // argon2id encoded hash marker — and, critically, the plaintext is absent.
      expect(stored.startsWith('$argon2id$')).toBe(true)
      expect(stored).not.toContain(secret)
    })

    it('blocks GET/PUT/DELETE without password when protected, allows with correct password', async () => {
      const secret = 'letmein'
      const created = await handleApi(
        new Request(`${BASE_URL}/s/api`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Share-Password': secret },
          body: JSON.stringify({ v: 1 }),
        }),
        '/s/api',
      )
      const { id } = (await created!.json()) as { id: string }

      // Missing password → 401 password_required
      const miss = await handleApi(new Request(`${BASE_URL}/s/api/${id}`), `/s/api/${id}`)
      expect(miss!.status).toBe(401)
      expect(await miss!.json()).toEqual({ error: 'password_required' })

      // Wrong password → 401 password_invalid
      const wrong = await handleApi(
        new Request(`${BASE_URL}/s/api/${id}`, { headers: { 'X-Share-Password': 'nope' } }),
        `/s/api/${id}`,
      )
      expect(wrong!.status).toBe(401)
      expect(await wrong!.json()).toEqual({ error: 'password_invalid' })

      // Correct password → 200 + content
      const ok = await handleApi(
        new Request(`${BASE_URL}/s/api/${id}`, { headers: { 'X-Share-Password': secret } }),
        `/s/api/${id}`,
      )
      expect(ok!.status).toBe(200)
      expect(await ok!.json()).toEqual({ v: 1 })

      // PUT without password is rejected
      const putMiss = await handleApi(
        new Request(`${BASE_URL}/s/api/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ v: 2 }),
        }),
        `/s/api/${id}`,
      )
      expect(putMiss!.status).toBe(401)

      // PUT with password succeeds
      const putOk = await handleApi(
        new Request(`${BASE_URL}/s/api/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Share-Password': secret },
          body: JSON.stringify({ v: 2 }),
        }),
        `/s/api/${id}`,
      )
      expect(putOk!.status).toBe(200)

      // DELETE without password is rejected
      const delMiss = await handleApi(
        new Request(`${BASE_URL}/s/api/${id}`, { method: 'DELETE' }),
        `/s/api/${id}`,
      )
      expect(delMiss!.status).toBe(401)

      const delOk = await handleApi(
        new Request(`${BASE_URL}/s/api/${id}`, {
          method: 'DELETE',
          headers: { 'X-Share-Password': secret },
        }),
        `/s/api/${id}`,
      )
      expect(delOk!.status).toBe(200)
    })

    it('password-change endpoint sets, rotates, and removes the password', async () => {
      // Create without password
      const created = await handleApi(
        new Request(`${BASE_URL}/s/api`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ v: 1 }),
        }),
        '/s/api',
      )
      const { id } = (await created!.json()) as { id: string }

      // Set password (no current needed because none is set yet)
      const set = await handleApi(
        new Request(`${BASE_URL}/s/api/${id}/password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ current: null, new: 'first' }),
        }),
        `/s/api/${id}/password`,
      )
      expect(set!.status).toBe(200)
      expect(await set!.json()).toEqual({ hasPassword: true })

      // Rotate password — wrong current is rejected
      const rotateBad = await handleApi(
        new Request(`${BASE_URL}/s/api/${id}/password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ current: 'wrong', new: 'second' }),
        }),
        `/s/api/${id}/password`,
      )
      expect(rotateBad!.status).toBe(401)

      // Rotate password — correct current accepted
      const rotate = await handleApi(
        new Request(`${BASE_URL}/s/api/${id}/password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ current: 'first', new: 'second' }),
        }),
        `/s/api/${id}/password`,
      )
      expect(rotate!.status).toBe(200)

      // Remove password — requires correct current
      const removeBad = await handleApi(
        new Request(`${BASE_URL}/s/api/${id}/password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ current: null, new: null }),
        }),
        `/s/api/${id}/password`,
      )
      expect(removeBad!.status).toBe(401)

      const remove = await handleApi(
        new Request(`${BASE_URL}/s/api/${id}/password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ current: 'second', new: null }),
        }),
        `/s/api/${id}/password`,
      )
      expect(remove!.status).toBe(200)
      expect(await remove!.json()).toEqual({ hasPassword: false })

      // After removal, GET works without a password.
      const afterRemove = await handleApi(new Request(`${BASE_URL}/s/api/${id}`), `/s/api/${id}`)
      expect(afterRemove!.status).toBe(200)
    })

    it('deleting a session removes its password sidecar', async () => {
      const created = await handleApi(
        new Request(`${BASE_URL}/s/api`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Share-Password': 'x' },
          body: JSON.stringify({ v: 1 }),
        }),
        '/s/api',
      )
      const { id } = (await created!.json()) as { id: string }
      expect(existsSync(join(dataDir, `${id}.json.pwd`))).toBe(true)

      const del = await handleApi(
        new Request(`${BASE_URL}/s/api/${id}`, {
          method: 'DELETE',
          headers: { 'X-Share-Password': 'x' },
        }),
        `/s/api/${id}`,
      )
      expect(del!.status).toBe(200)
      expect(existsSync(join(dataDir, `${id}.json.pwd`))).toBe(false)
    })
  })

  // ---------------------------------------------------------------------
  // HTML artifact
  // ---------------------------------------------------------------------

  describe('HTML artifact', () => {
    it('serves a gate page to browser GETs and 401 JSON to fetch clients', async () => {
      const secret = 'html-pw'
      const created = await handleApi(
        new Request(`${BASE_URL}/s/api/html`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Share-Password': secret },
          body: '<!doctype html><p>secret</p>',
        }),
        '/s/api/html',
      )
      const { id } = (await created!.json()) as { id: string }

      // Browser (Accept: text/html) without password → gate page (401 + HTML)
      const browserRes = await handleHtmlArtifactRoute(
        storage,
        new Request(`${BASE_URL}/s/h/${id}`, { headers: { Accept: 'text/html' } }),
        `/s/h/${id}`,
      )
      expect(browserRes!.status).toBe(401)
      expect(browserRes!.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
      const gate = await browserRes!.text()
      expect(gate).toContain('Password required')
      // The gate script must not leak stored content.
      expect(gate).not.toContain('secret</p>')

      // Programmatic client (Accept: application/json) → 401 JSON
      const apiRes = await handleHtmlArtifactRoute(
        storage,
        new Request(`${BASE_URL}/s/h/${id}`, { headers: { Accept: 'application/json' } }),
        `/s/h/${id}`,
      )
      expect(apiRes!.status).toBe(401)
      expect(await apiRes!.json()).toEqual({ error: 'password_required' })

      // With correct password → serves HTML
      const ok = await handleHtmlArtifactRoute(
        storage,
        new Request(`${BASE_URL}/s/h/${id}`, {
          headers: { 'X-Share-Password': secret, Accept: 'text/html' },
        }),
        `/s/h/${id}`,
      )
      expect(ok!.status).toBe(200)
      expect(await ok!.text()).toBe('<!doctype html><p>secret</p>')
    })

    it('no-password HTML artifact still opens without a prompt', async () => {
      const created = await handleApi(
        new Request(`${BASE_URL}/s/api/html`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          body: '<!doctype html><p>public</p>',
        }),
        '/s/api/html',
      )
      const { id } = (await created!.json()) as { id: string }

      const res = await handleHtmlArtifactRoute(
        storage,
        new Request(`${BASE_URL}/s/h/${id}`, { headers: { Accept: 'text/html' } }),
        `/s/h/${id}`,
      )
      expect(res!.status).toBe(200)
      expect(await res!.text()).toBe('<!doctype html><p>public</p>')
    })
  })

  // ---------------------------------------------------------------------
  // Asset
  // ---------------------------------------------------------------------

  describe('file asset', () => {
    it('requires the password on GET when protected', async () => {
      const secret = 'asset-pw'
      const bytes = new TextEncoder().encode('hello-bytes')
      const created = await handleAsset(
        new Request(`${BASE_URL}/s/a`, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Share-Password': secret,
          },
          body: bytes,
        }),
        '/s/a',
      )
      const { id, hasPassword } = (await created!.json()) as { id: string; hasPassword: boolean }
      expect(hasPassword).toBe(true)

      // Programmatic fetch without password → 401
      const miss = await handleAsset(
        new Request(`${BASE_URL}/s/a/${id}`, { method: 'GET', headers: { Accept: '*/*' } }),
        `/s/a/${id}`,
      )
      expect(miss!.status).toBe(401)

      // With password → 200 + bytes
      const ok = await handleAsset(
        new Request(`${BASE_URL}/s/a/${id}`, {
          method: 'GET',
          headers: { 'X-Share-Password': secret },
        }),
        `/s/a/${id}`,
      )
      expect(ok!.status).toBe(200)
      expect(await ok!.text()).toBe('hello-bytes')
    })
  })
})
