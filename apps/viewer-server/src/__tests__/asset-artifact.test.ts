/**
 * Tests for the file-asset endpoints (POST /s/a, GET /s/a/{id}, DELETE /s/a/{id}).
 *
 * Calls the asset handler directly so no HTTP server is needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

import { createAssetHandler } from '../routes'
import { FsStorage } from '../storage/fs'

const BASE_URL = 'http://test.local'

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('viewer-server file-asset endpoints', () => {
  let dataDir: string
  let storage: FsStorage
  let handleAsset: ReturnType<typeof createAssetHandler>

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-asset-test-'))
    storage = new FsStorage(dataDir)
    await storage.initialize()
    handleAsset = createAssetHandler(storage, BASE_URL)
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
  })

  describe('POST /s/a', () => {
    it('rejects empty body with 400', async () => {
      const req = new Request(`${BASE_URL}/s/a`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(),
      })

      const res = await handleAsset(req, '/s/a')
      expect(res).not.toBeNull()
      expect(res!.status).toBe(400)
    })

    it('returns { id, url } where id is sha256 of the uploaded bytes', async () => {
      const bytes = new TextEncoder().encode('<!doctype html><p>hi</p>')
      const expectedId = sha256Hex(bytes)

      const req = new Request(`${BASE_URL}/s/a`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: bytes,
      })

      const res = await handleAsset(req, '/s/a')
      expect(res).not.toBeNull()
      expect(res!.status).toBe(201)

      const body = (await res!.json()) as { id: string; url: string }
      expect(body.id).toBe(expectedId)
      expect(body.url).toBe(`${BASE_URL}/s/a/${expectedId}`)

      const stored = await storage.loadAsset(expectedId)
      expect(stored).not.toBeNull()
      expect(stored!.mimeType).toBe('text/html; charset=utf-8')
      expect(new TextDecoder().decode(stored!.data)).toBe('<!doctype html><p>hi</p>')
    })

    it('is idempotent — uploading the same bytes twice yields the same id', async () => {
      const bytes = new TextEncoder().encode('same-content')
      const req1 = new Request(`${BASE_URL}/s/a`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
      })
      const req2 = new Request(`${BASE_URL}/s/a`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
      })

      const { id: id1 } = (await (await handleAsset(req1, '/s/a'))!.json()) as { id: string }
      const { id: id2 } = (await (await handleAsset(req2, '/s/a'))!.json()) as { id: string }
      expect(id1).toBe(id2)
    })
  })

  describe('GET /s/a/{id}', () => {
    it('serves bytes back with the stored mime type', async () => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
      const uploadRes = await handleAsset(
        new Request(`${BASE_URL}/s/a`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/png' },
          body: bytes,
        }),
        '/s/a',
      )
      const { id } = (await uploadRes!.json()) as { id: string }

      const getRes = await handleAsset(
        new Request(`${BASE_URL}/s/a/${id}`, { method: 'GET' }),
        `/s/a/${id}`,
      )
      expect(getRes).not.toBeNull()
      expect(getRes!.status).toBe(200)
      expect(getRes!.headers.get('Content-Type')).toBe('image/png')
      const served = new Uint8Array(await getRes!.arrayBuffer())
      expect(Array.from(served)).toEqual(Array.from(bytes))
    })

    it('returns 404 for unknown id', async () => {
      const res = await handleAsset(
        new Request(`${BASE_URL}/s/a/missing`, { method: 'GET' }),
        '/s/a/missing',
      )
      expect(res).not.toBeNull()
      expect(res!.status).toBe(404)
    })
  })

  describe('DELETE /s/a/{id}', () => {
    it('removes the asset and subsequent GET returns 404', async () => {
      const bytes = new TextEncoder().encode('to-be-deleted')
      const uploadRes = await handleAsset(
        new Request(`${BASE_URL}/s/a`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: bytes,
        }),
        '/s/a',
      )
      const { id } = (await uploadRes!.json()) as { id: string }

      const delRes = await handleAsset(
        new Request(`${BASE_URL}/s/a/${id}`, { method: 'DELETE' }),
        `/s/a/${id}`,
      )
      expect(delRes).not.toBeNull()
      expect(delRes!.status).toBe(204)

      const getRes = await handleAsset(
        new Request(`${BASE_URL}/s/a/${id}`, { method: 'GET' }),
        `/s/a/${id}`,
      )
      expect(getRes!.status).toBe(404)
    })

    it('returns 404 for unknown id', async () => {
      const res = await handleAsset(
        new Request(`${BASE_URL}/s/a/missing`, { method: 'DELETE' }),
        '/s/a/missing',
      )
      expect(res).not.toBeNull()
      expect(res!.status).toBe(404)
    })
  })
})
