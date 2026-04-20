/**
 * Tests for the HTML artifact endpoints (POST /s/api/html, GET /s/h/{id}).
 *
 * Calls the route handlers directly so no HTTP server is needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createApiHandler, handleHtmlArtifactRoute } from '../routes'
import { FsStorage } from '../storage/fs'

const BASE_URL = 'http://test.local'

describe('viewer-server HTML artifact endpoints', () => {
  let dataDir: string
  let storage: FsStorage
  let handleApi: ReturnType<typeof createApiHandler>

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'viewer-html-test-'))
    storage = new FsStorage(dataDir)
    await storage.initialize()
    handleApi = createApiHandler(storage, BASE_URL)
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
  })

  describe('POST /s/api/html', () => {
    it('rejects empty body with 400', async () => {
      const req = new Request(`${BASE_URL}/s/api/html`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: '',
      })

      const res = await handleApi(req, '/s/api/html')
      expect(res).not.toBeNull()
      expect(res!.status).toBe(400)
    })

    it('rejects payloads exceeding MAX_BODY_SIZE with 413', async () => {
      // The handler reads Content-Length to enforce the size cap before
      // touching the body, so we can declare a giant size cheaply.
      const oversized = 51 * 1024 * 1024 // 51 MB > MAX_BODY_SIZE (50 MB)
      const req = new Request(`${BASE_URL}/s/api/html`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': String(oversized),
        },
        body: '<html></html>',
      })

      const res = await handleApi(req, '/s/api/html')
      expect(res).not.toBeNull()
      expect(res!.status).toBe(413)
    })

    it('returns {id, url} with a 22-char base64url id for a normal body', async () => {
      const html = '<!doctype html><html><body><h1>Hi</h1></body></html>'
      const req = new Request(`${BASE_URL}/s/api/html`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: html,
      })

      const res = await handleApi(req, '/s/api/html')
      expect(res).not.toBeNull()
      expect(res!.status).toBe(201)

      const body = (await res!.json()) as { id: string; url: string }
      expect(typeof body.id).toBe('string')
      expect(body.id.length).toBe(22)
      expect(body.id).toMatch(/^[A-Za-z0-9_-]{22}$/)
      expect(body.url).toBe(`${BASE_URL}/s/h/${body.id}`)

      // Round-trip: artifact is retrievable from storage
      expect(await storage.loadHtml(body.id)).toBe(html)
    })
  })

  describe('GET /s/h/{id}', () => {
    it('serves the stored HTML with text/html mime when the id exists', async () => {
      const html = '<!doctype html><html><body>Stored</body></html>'
      const upload = await handleApi(
        new Request(`${BASE_URL}/s/api/html`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          body: html,
        }),
        '/s/api/html',
      )
      const { id } = (await upload!.json()) as { id: string; url: string }

      const res = await handleHtmlArtifactRoute(storage, new Request(`${BASE_URL}/s/h/${id}`), `/s/h/${id}`)
      expect(res).not.toBeNull()
      expect(res!.status).toBe(200)
      expect(res!.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
      expect(await res!.text()).toBe(html)
    })

    it('returns 404 when the id does not exist', async () => {
      const res = await handleHtmlArtifactRoute(
        storage,
        new Request(`${BASE_URL}/s/h/this-id-does-not-exist`),
        '/s/h/this-id-does-not-exist',
      )
      expect(res).not.toBeNull()
      expect(res!.status).toBe(404)
    })
  })

  describe('PUT /s/api/html/{id}', () => {
    it('overwrites existing HTML and subsequent GET returns the new content', async () => {
      const original = '<!doctype html><html><body>Original</body></html>'
      const upload = await handleApi(
        new Request(`${BASE_URL}/s/api/html`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          body: original,
        }),
        '/s/api/html',
      )
      const { id } = (await upload!.json()) as { id: string; url: string }

      const updated = '<!doctype html><html><body>Updated</body></html>'
      const putRes = await handleApi(
        new Request(`${BASE_URL}/s/api/html/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          body: updated,
        }),
        `/s/api/html/${id}`,
      )
      expect(putRes).not.toBeNull()
      expect(putRes!.status).toBe(200)
      const putBody = (await putRes!.json()) as { id: string; url: string }
      expect(putBody.id).toBe(id)
      expect(putBody.url).toBe(`${BASE_URL}/s/h/${id}`)

      const getRes = await handleHtmlArtifactRoute(storage, new Request(`${BASE_URL}/s/h/${id}`), `/s/h/${id}`)
      expect(getRes!.status).toBe(200)
      expect(await getRes!.text()).toBe(updated)
    })

    it('returns 404 when the id does not exist', async () => {
      const res = await handleApi(
        new Request(`${BASE_URL}/s/api/html/missing-id`, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          body: '<html></html>',
        }),
        '/s/api/html/missing-id',
      )
      expect(res).not.toBeNull()
      expect(res!.status).toBe(404)
    })
  })

  describe('DELETE /s/api/html/{id}', () => {
    it('deletes the artifact and subsequent GET returns 404', async () => {
      const html = '<!doctype html><html><body>Goodbye</body></html>'
      const upload = await handleApi(
        new Request(`${BASE_URL}/s/api/html`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
          body: html,
        }),
        '/s/api/html',
      )
      const { id } = (await upload!.json()) as { id: string; url: string }

      const delRes = await handleApi(
        new Request(`${BASE_URL}/s/api/html/${id}`, { method: 'DELETE' }),
        `/s/api/html/${id}`,
      )
      expect(delRes).not.toBeNull()
      expect(delRes!.status).toBe(204)

      const getRes = await handleHtmlArtifactRoute(storage, new Request(`${BASE_URL}/s/h/${id}`), `/s/h/${id}`)
      expect(getRes!.status).toBe(404)
    })

    it('returns 404 when the id does not exist', async () => {
      const res = await handleApi(
        new Request(`${BASE_URL}/s/api/html/missing-id`, { method: 'DELETE' }),
        '/s/api/html/missing-id',
      )
      expect(res).not.toBeNull()
      expect(res!.status).toBe(404)
    })
  })
})
