/**
 * API route handlers for shared session CRUD.
 *
 * Routes:
 *   POST   /s/api              — Upload session, returns { id, url }
 *   GET    /s/api/:id          — Fetch session JSON
 *   PUT    /s/api/:id          — Update existing session
 *   DELETE /s/api/:id          — Delete session
 *   POST   /s/api/:id/password — Set / change / remove the session password
 *   POST   /s/api/html         — Upload HTML artifact, returns { id, url }
 *   PUT    /s/api/html/:id     — Overwrite HTML artifact, returns { id, url }
 *   DELETE /s/api/html/:id     — Delete HTML artifact
 *   POST   /s/api/html/:id/password — Set / change / remove the HTML password
 *   POST   /s/a                — Upload file asset (raw bytes), returns { id, url }
 *   GET    /s/a/:id            — Fetch asset bytes with stored mime type
 *   DELETE /s/a/:id            — Delete file asset
 *   POST   /s/api/asset/:id/password — Set / change / remove the asset password
 *
 * Password protection is opt-in: a POST without a password produces a share
 * that behaves exactly as before. A share becomes protected when the creator
 * supplies an `x-share-password` header on the POST (or calls the password
 * endpoint afterward); read / mutate / delete requests must then resend the
 * password via the same header.
 */

import type { SessionStorage, ShareKind } from './storage/interface'
import { generateId, generateHtmlId, generateAssetId } from './storage/interface'
import {
  PASSWORD_HEADER,
  blockedResponse,
  checkPasswordGate,
  extractSubmittedPassword,
  hashPassword,
  normalizePassword,
  verifyPassword,
} from './password'
import { renderPasswordGate } from './gate-page'

/** Max request body size (50 MB) */
const MAX_BODY_SIZE = 50 * 1024 * 1024

/** Returns true when the client looks like a browser navigating directly. */
function prefersHtml(req: Request): boolean {
  const accept = req.headers.get('accept') ?? ''
  return accept.includes('text/html')
}

/**
 * Parse the password-management body: `{ current: string | null, new: string | null }`.
 * Callers already matched the path, so anything malformed here is a 400.
 */
async function parsePasswordChange(req: Request): Promise<{ current: string | null; new: string | null } | Response> {
  try {
    const body = await req.json() as Record<string, unknown>
    return {
      current: normalizePassword(body?.current),
      new: normalizePassword(body?.new),
    }
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
}

/**
 * Common password-change handler shared by all three kinds. Verifies the
 * caller knows the existing password before rewriting the hash so that
 * possession of the URL alone can't strip the gate.
 */
async function handlePasswordChange(
  storage: SessionStorage,
  kind: ShareKind,
  id: string,
  req: Request,
  exists: (id: string) => Promise<boolean>,
): Promise<Response> {
  if (!(await exists(id))) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = await parsePasswordChange(req)
  if (parsed instanceof Response) return parsed

  const currentHash = await storage.loadPasswordHash(kind, id)
  if (currentHash != null) {
    if (parsed.current == null) {
      return Response.json({ error: 'password_required' }, { status: 401 })
    }
    const ok = await verifyPassword(parsed.current, currentHash)
    if (!ok) return Response.json({ error: 'password_invalid' }, { status: 401 })
  }

  if (parsed.new == null) {
    await storage.setPasswordHash(kind, id, null)
    return Response.json({ hasPassword: false })
  }

  const hash = await hashPassword(parsed.new)
  await storage.setPasswordHash(kind, id, hash)
  return Response.json({ hasPassword: true })
}

export function createApiHandler(storage: SessionStorage, baseUrl: string) {
  return async (req: Request, path: string): Promise<Response | null> => {
    // Only handle /s/api routes
    if (!path.startsWith('/s/api')) return null

    const apiPath = path.slice('/s/api'.length) // "" or "/{id}" or "/html" or "/asset/{id}/password"

    // POST /s/api/html — upload HTML artifact
    if (req.method === 'POST' && apiPath === '/html') {
      const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
      if (contentLength > MAX_BODY_SIZE) {
        return Response.json({ error: 'Request too large' }, { status: 413 })
      }

      const html = await req.text()
      if (!html) {
        return Response.json({ error: 'Empty HTML body' }, { status: 400 })
      }

      const id = generateHtmlId()
      await storage.saveHtml(id, html)

      const submitted = extractSubmittedPassword(req)
      if (submitted != null) {
        await storage.setPasswordHash('html', id, await hashPassword(submitted))
      }

      const url = `${baseUrl}/s/h/${id}`
      return Response.json({ id, url, hasPassword: submitted != null }, { status: 201 })
    }

    // POST /s/api/html/{id}/password — manage HTML artifact password
    const htmlPwMatch = apiPath.match(/^\/html\/([a-zA-Z0-9_-]+)\/password$/)
    if (htmlPwMatch && req.method === 'POST') {
      const htmlId = htmlPwMatch[1]!
      return handlePasswordChange(storage, 'html', htmlId, req, async (id) => (await storage.loadHtml(id)) != null)
    }

    // POST /s/api/asset/{id}/password — manage asset password
    const assetPwMatch = apiPath.match(/^\/asset\/([a-zA-Z0-9_-]+)\/password$/)
    if (assetPwMatch && req.method === 'POST') {
      const assetId = assetPwMatch[1]!
      return handlePasswordChange(storage, 'asset', assetId, req, async (id) => (await storage.loadAsset(id)) != null)
    }

    // /s/api/html/{id} — update / delete existing HTML artifact
    const htmlIdMatch = apiPath.match(/^\/html\/([a-zA-Z0-9_-]+)$/)
    if (htmlIdMatch) {
      const htmlId = htmlIdMatch[1]!

      if (req.method === 'PUT') {
        const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
        if (contentLength > MAX_BODY_SIZE) {
          return Response.json({ error: 'Request too large' }, { status: 413 })
        }

        const gate = await checkPasswordGate(storage, 'html', htmlId, req)
        if (gate.state !== 'ok') {
          if (await storage.loadHtml(htmlId) == null) {
            return Response.json({ error: 'Not found' }, { status: 404 })
          }
          return blockedResponse(gate.state)
        }

        const html = await req.text()
        if (!html) {
          return Response.json({ error: 'Empty HTML body' }, { status: 400 })
        }

        const updated = await storage.updateHtml(htmlId, html)
        if (!updated) {
          return Response.json({ error: 'Not found' }, { status: 404 })
        }
        return Response.json({ id: htmlId, url: `${baseUrl}/s/h/${htmlId}` })
      }

      if (req.method === 'DELETE') {
        const gate = await checkPasswordGate(storage, 'html', htmlId, req)
        if (gate.state !== 'ok') {
          if (await storage.loadHtml(htmlId) == null) {
            return Response.json({ error: 'Not found' }, { status: 404 })
          }
          return blockedResponse(gate.state)
        }

        const existed = await storage.deleteHtml(htmlId)
        if (!existed) {
          return Response.json({ error: 'Not found' }, { status: 404 })
        }
        return new Response(null, { status: 204 })
      }

      return null
    }

    // POST /s/api — create
    if (req.method === 'POST' && apiPath === '') {
      const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
      if (contentLength > MAX_BODY_SIZE) {
        return Response.json({ error: 'Request too large' }, { status: 413 })
      }

      try {
        const data = await req.json()
        const id = generateId()
        await storage.save(id, data)

        const submitted = extractSubmittedPassword(req)
        if (submitted != null) {
          await storage.setPasswordHash('session', id, await hashPassword(submitted))
        }

        const url = `${baseUrl}/s/${id}`
        return Response.json({ id, url, hasPassword: submitted != null }, { status: 201 })
      } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
      }
    }

    // POST /s/api/{id}/password — manage session password
    const sessionPwMatch = apiPath.match(/^\/([a-zA-Z0-9_-]+)\/password$/)
    if (sessionPwMatch && req.method === 'POST') {
      const id = sessionPwMatch[1]!
      return handlePasswordChange(storage, 'session', id, req, async (sid) => (await storage.load(sid)) != null)
    }

    // Extract ID from path: /s/api/{id}
    const idMatch = apiPath.match(/^\/([a-zA-Z0-9_-]+)$/)
    if (!idMatch) return null
    const id = idMatch[1]!

    // GET /s/api/{id} — read
    if (req.method === 'GET') {
      if (!(await storage.exists('session', id))) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
      const gate = await checkPasswordGate(storage, 'session', id, req)
      if (gate.state !== 'ok') return blockedResponse(gate.state)
      const data = await storage.load(id)
      return Response.json(data)
    }

    // PUT /s/api/{id} — update
    if (req.method === 'PUT') {
      const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
      if (contentLength > MAX_BODY_SIZE) {
        return Response.json({ error: 'Request too large' }, { status: 413 })
      }

      if (await storage.load(id) == null) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
      const gate = await checkPasswordGate(storage, 'session', id, req)
      if (gate.state !== 'ok') return blockedResponse(gate.state)

      try {
        const data = await req.json()
        await storage.save(id, data)
        return Response.json({ id, url: `${baseUrl}/s/${id}` })
      } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
      }
    }

    // DELETE /s/api/{id} — delete
    if (req.method === 'DELETE') {
      if (await storage.load(id) == null) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
      const gate = await checkPasswordGate(storage, 'session', id, req)
      if (gate.state !== 'ok') return blockedResponse(gate.state)

      const existed = await storage.delete(id)
      if (!existed) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
      return Response.json({ success: true })
    }

    return null
  }
}

/**
 * Handle GET /s/h/{id} — serve a previously uploaded HTML artifact directly
 * with text/html mime so browsers render it.
 *
 * When the share is password-protected and the request didn't supply the
 * password (typical of a naked browser click), serve a small gate HTML that
 * fetches the real body with the password header and replaces the document.
 * Programmatic clients (`Accept: application/json`, JSON fetch) get a plain
 * 401 JSON so they can surface errors explicitly.
 */
export async function handleHtmlArtifactRoute(
  storage: SessionStorage,
  req: Request,
  path: string,
): Promise<Response | null> {
  const match = path.match(/^\/s\/h\/([a-zA-Z0-9_-]+)$/)
  const id = match?.[1]
  if (!id) return null

  if (!(await storage.exists('html', id))) {
    return new Response('Not found', { status: 404 })
  }

  const gate = await checkPasswordGate(storage, 'html', id, req)
  if (gate.state === 'password_required' && prefersHtml(req)) {
    return new Response(renderPasswordGate(path, 'html'), {
      status: 401,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }
  if (gate.state !== 'ok') return blockedResponse(gate.state)

  const html = await storage.loadHtml(id)
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/**
 * Handler for the `/s/a` file-asset routes used by file-backed preview blocks
 * in shared sessions. One shape — raw bytes in, raw bytes out — so HTML, PDFs,
 * images, CSV/JSON, and spreadsheets all round-trip through the same pipeline.
 */
export function createAssetHandler(storage: SessionStorage, baseUrl: string) {
  return async (req: Request, path: string): Promise<Response | null> => {
    // POST /s/a — upload raw bytes, id = sha256(bytes), mime = request Content-Type
    if (req.method === 'POST' && path === '/s/a') {
      const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
      if (contentLength > MAX_BODY_SIZE) {
        return Response.json({ error: 'Request too large' }, { status: 413 })
      }

      const bytes = new Uint8Array(await req.arrayBuffer())
      if (bytes.byteLength === 0) {
        return Response.json({ error: 'Empty asset body' }, { status: 400 })
      }

      const mimeType = req.headers.get('content-type') ?? 'application/octet-stream'
      const id = await generateAssetId(bytes)
      await storage.saveAsset(id, bytes, mimeType)

      const submitted = extractSubmittedPassword(req)
      if (submitted != null) {
        await storage.setPasswordHash('asset', id, await hashPassword(submitted))
      }

      const url = `${baseUrl}/s/a/${id}`
      return Response.json({ id, url, hasPassword: submitted != null }, { status: 201 })
    }

    const idMatch = path.match(/^\/s\/a\/([a-zA-Z0-9_-]+)$/)
    if (!idMatch) return null
    const id = idMatch[1]!

    if (req.method === 'GET') {
      if (!(await storage.exists('asset', id))) {
        return new Response('Not found', { status: 404 })
      }
      const gate = await checkPasswordGate(storage, 'asset', id, req)
      if (gate.state === 'password_required' && prefersHtml(req)) {
        return new Response(renderPasswordGate(path, 'download'), {
          status: 401,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      if (gate.state !== 'ok') return blockedResponse(gate.state)
      const asset = await storage.loadAsset(id)
      return new Response(asset!.data, {
        headers: { 'Content-Type': asset!.mimeType },
      })
    }

    if (req.method === 'DELETE') {
      if (await storage.loadAsset(id) == null) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
      const gate = await checkPasswordGate(storage, 'asset', id, req)
      if (gate.state !== 'ok') return blockedResponse(gate.state)

      const existed = await storage.deleteAsset(id)
      if (!existed) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
      return new Response(null, { status: 204 })
    }

    return null
  }
}

// Re-export for consumers that need to inspect the header name directly.
export { PASSWORD_HEADER }
