#!/usr/bin/env bun
/**
 * @craft-agent/viewer-server — standalone HTTP server for shared sessions.
 *
 * Serves the viewer frontend (static files) and provides the /s/api/* CRUD
 * endpoints for session storage.
 *
 * Environment:
 *   VIEWER_PORT              — HTTP port (default: 9101)
 *   VIEWER_HOST              — Bind address (default: 0.0.0.0)
 *   VIEWER_BASE_URL          — Public-facing base URL (default: http://localhost:{port})
 *   VIEWER_STATIC_DIR        — Path to viewer frontend build (default: ../viewer/dist)
 *   VIEWER_STORAGE            — Storage backend: "fs" | "s3" (default: "fs")
 *   VIEWER_DATA_DIR          — Data directory for fs storage (default: ./data)
 *   VIEWER_S3_ENDPOINT       — S3 endpoint URL
 *   VIEWER_S3_BUCKET         — S3 bucket name
 *   VIEWER_S3_ACCESS_KEY_ID  — S3 access key
 *   VIEWER_S3_SECRET_ACCESS_KEY — S3 secret key
 *   VIEWER_S3_REGION         — S3 region (default: "auto")
 */

import { join, extname } from 'node:path'
import { createApiHandler, createAssetHandler, handleHtmlArtifactRoute } from './routes'
import type { SessionStorage } from './storage/interface'

// ---------------------------------------------------------------------------
// MIME types (subset from server-core/webui/http-server.ts)
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.map': 'application/json',
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const port = parseInt(process.env.VIEWER_PORT ?? '9101', 10)
const host = process.env.VIEWER_HOST ?? '0.0.0.0'
const baseUrl = process.env.VIEWER_BASE_URL ?? `http://localhost:${port}`
const staticDir = process.env.VIEWER_STATIC_DIR
  ?? join(import.meta.dir, '..', '..', 'viewer', 'dist')
const storageType = process.env.VIEWER_STORAGE ?? 'fs'

// ---------------------------------------------------------------------------
// Initialize storage
// ---------------------------------------------------------------------------

async function initStorage(): Promise<SessionStorage> {
  if (storageType === 's3') {
    const { S3Storage } = await import('./storage/s3')
    const storage = new S3Storage()
    await storage.initialize()
    console.log('[viewer] Storage: S3')
    return storage
  }

  const { FsStorage } = await import('./storage/fs')
  const dataDir = process.env.VIEWER_DATA_DIR ?? join(import.meta.dir, '..', 'data')
  const storage = new FsStorage(dataDir)
  await storage.initialize()
  console.log(`[viewer] Storage: filesystem (${dataDir})`)
  return storage
}

const storage = await initStorage()
const handleApi = createApiHandler(storage, baseUrl)
const handleAsset = createAssetHandler(storage, baseUrl)

// ---------------------------------------------------------------------------
// Static file serving + SPA fallback
// ---------------------------------------------------------------------------

/**
 * The viewer frontend is built with `base: '/s/'`, so:
 *   /s/index.html, /s/assets/* → static files
 *   /s/{sessionId}            → SPA fallback to index.html
 */
async function handleStatic(path: string): Promise<Response> {
  // Try serving the exact file from the static directory
  // Path "/s/foo" maps to file "{staticDir}/foo"
  const relativePath = path.startsWith('/s/') ? path.slice(3) : path.slice(1)
  if (relativePath && relativePath !== '') {
    const filePath = join(staticDir, relativePath)
    const file = Bun.file(filePath)
    if (await file.exists()) {
      const mime = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      return new Response(file, { headers: { 'Content-Type': mime } })
    }
  }

  // SPA fallback — serve index.html for any unmatched /s/* route
  const indexPath = join(staticDir, 'index.html')
  const indexFile = Bun.file(indexPath)
  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  return new Response('Viewer not built. Run: bun run viewer:build', { status: 404 })
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = Bun.serve({
  port,
  hostname: host,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    // CORS headers for API requests
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    // API routes: /s/api/*
    const apiResponse = await handleApi(req, path)
    if (apiResponse) {
      apiResponse.headers.set('Access-Control-Allow-Origin', '*')
      return apiResponse
    }

    // File-asset routes: /s/a (POST) + /s/a/{id} (GET/DELETE) — must come before SPA fallback
    const assetResponse = await handleAsset(req, path)
    if (assetResponse) {
      assetResponse.headers.set('Access-Control-Allow-Origin', '*')
      return assetResponse
    }

    // HTML artifact routes: GET /s/h/{id} — must come before SPA fallback
    if (req.method === 'GET') {
      const htmlResponse = await handleHtmlArtifactRoute(storage, path)
      if (htmlResponse) {
        htmlResponse.headers.set('Access-Control-Allow-Origin', '*')
        return htmlResponse
      }
    }

    // Redirect root to /s/
    if (path === '/' || path === '') {
      return Response.redirect('/s/', 302)
    }

    // Static files + SPA fallback: /s/*
    if (path.startsWith('/s')) {
      return handleStatic(path)
    }

    return new Response('Not Found', { status: 404 })
  },
})

console.log(`[viewer] Server listening on http://${host}:${server.port}`)
console.log(`[viewer] Base URL: ${baseUrl}`)
console.log(`[viewer] Static dir: ${staticDir}`)
