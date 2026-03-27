/**
 * API route handlers for shared session CRUD.
 *
 * Routes:
 *   POST   /s/api       — Upload session, returns { id, url }
 *   GET    /s/api/:id   — Fetch session JSON
 *   PUT    /s/api/:id   — Update existing session
 *   DELETE /s/api/:id   — Delete session
 */

import type { SessionStorage } from './storage/interface'
import { generateId } from './storage/interface'

/** Max request body size (50 MB) */
const MAX_BODY_SIZE = 50 * 1024 * 1024

export function createApiHandler(storage: SessionStorage, baseUrl: string) {
  return async (req: Request, path: string): Promise<Response | null> => {
    // Only handle /s/api routes
    if (!path.startsWith('/s/api')) return null

    const apiPath = path.slice('/s/api'.length) // "" or "/{id}"

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

        const url = `${baseUrl}/s/${id}`
        return Response.json({ id, url }, { status: 201 })
      } catch {
        return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
      }
    }

    // Extract ID from path: /s/api/{id}
    const idMatch = apiPath.match(/^\/([a-zA-Z0-9_-]+)$/)
    if (!idMatch) return null
    const id = idMatch[1]

    // GET /s/api/{id} — read
    if (req.method === 'GET') {
      const data = await storage.load(id)
      if (!data) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
      return Response.json(data)
    }

    // PUT /s/api/{id} — update
    if (req.method === 'PUT') {
      const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
      if (contentLength > MAX_BODY_SIZE) {
        return Response.json({ error: 'Request too large' }, { status: 413 })
      }

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
      const existed = await storage.delete(id)
      if (!existed) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
      return Response.json({ success: true })
    }

    return null
  }
}
