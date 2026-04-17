/**
 * Web UI HTTP handler and standalone server.
 *
 * The core logic lives in `createWebuiHandler()` which returns a web-standard
 * fetch handler `(Request) => Promise<Response>`. This handler can be:
 *
 * 1. **Embedded** — attached to the WsRpcServer's HTTPS server via the
 *    node-adapter so that HTTP and WSS share a single port.
 * 2. **Standalone** — wrapped in `Bun.serve()` via `startWebuiHttpServer()`
 *    for separate-port deployments or development.
 */

import { join, extname, normalize, sep, basename, dirname, isAbsolute } from 'node:path'
import { realpath } from 'node:fs/promises'
import { createSessionZipResponse } from './session-zip'
import {
  RateLimiter,
  initPasswordHash,
  verifyPassword,
  createSessionToken,
  validateSession,
  buildSessionCookie,
  buildLogoutCookie,
} from './auth'
import { generateCallbackPage } from '@craft-agent/shared/auth'
import type { PlatformServices } from '../runtime/platform'

// ---------------------------------------------------------------------------
// MIME types for static file serving
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

function getMimeType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function getForwardedValue(req: Request, key: 'proto' | 'host'): string | null {
  const forwarded = req.headers.get('forwarded')
  if (!forwarded) return null

  const match = forwarded.match(new RegExp(`${key}="?([^;,"]+)"?`, 'i'))
  return match?.[1]?.trim() || null
}

function getRequestProto(req: Request): string {
  return req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
    || getForwardedValue(req, 'proto')
    || new URL(req.url).protocol.replace(/:$/, '')
}

function getRequestHost(req: Request): string | null {
  return req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    || getForwardedValue(req, 'host')
    || req.headers.get('host')
}

function formatHostWithPort(host: string, port: number): string {
  try {
    const parsed = new URL(`http://${host}`)
    const hostname = parsed.hostname.includes(':') ? `[${parsed.hostname}]` : parsed.hostname
    return `${hostname}:${port}`
  } catch {
    const withoutPort = host.replace(/:\d+$/, '')
    return `${withoutPort}:${port}`
  }
}

export function shouldUseSecureCookies(req: Request, secureCookies?: boolean): boolean {
  if (secureCookies != null) return secureCookies
  return getRequestProto(req) === 'https'
}

export interface ResolveWebSocketUrlOptions {
  publicWsUrl?: string
  wsProtocol: 'ws' | 'wss'
  wsPort: number
}

export function resolveWebSocketUrl(
  req: Request,
  { publicWsUrl, wsProtocol, wsPort }: ResolveWebSocketUrlOptions,
): string {
  if (publicWsUrl) return publicWsUrl

  const host = getRequestHost(req)
  if (host) {
    return `${wsProtocol}://${formatHostWithPort(host, wsPort)}`
  }

  return `${wsProtocol}://127.0.0.1:${wsPort}`
}

// ---------------------------------------------------------------------------
// Handler options (shared between embedded and standalone modes)
// ---------------------------------------------------------------------------

/** Dependencies for the /api/oauth/callback HTTP route (server-side OAuth completion). */
export interface OAuthCallbackDeps {
  flowStore: { getByState: (state: string) => any; remove: (state: string) => void }
  credManager: { exchangeAndStore: (...args: any[]) => Promise<any> }
  sessionManager: { completeAuthRequest: (...args: any[]) => Promise<void> }
  pushSourcesChanged: (workspaceId: string) => void
}

/**
 * Dependencies for the /api/session-files/download HTTP route.
 * The resolver must return the absolute, authoritative path of a session's
 * directory — the download route streams only files that live inside it.
 */
export interface SessionFileDownloadDeps {
  /** Return the absolute session directory path, or null if the session is unknown. */
  getSessionPath: (sessionId: string) => string | null
}

export interface WebuiHandlerOptions {
  /** Path to built web UI dist/ directory. */
  webuiDir: string
  /** Secret used to sign JWTs — typically DATAPILOT_SERVER_TOKEN. */
  secret: string
  /** Optional separate web UI password. Falls back to `secret` for verification. */
  password?: string
  /** Explicit Secure-cookie override. When unset, infer from the request / proxy headers. */
  secureCookies?: boolean
  /** Optional browser-facing WebSocket URL override for reverse-proxy deployments. */
  publicWsUrl?: string
  /** RPC WebSocket protocol used when building a browser-facing fallback URL. */
  wsProtocol: 'ws' | 'wss'
  /** RPC WebSocket port used when building a browser-facing fallback URL. */
  wsPort: number
  /** Health check function (injected from existing server handler). */
  getHealthCheck: () => { status: string }
  /** Logger. */
  logger: PlatformServices['logger']
  /** OAuth callback deps — when provided, enables /api/oauth/callback route. */
  oauthCallbackDeps?: OAuthCallbackDeps
  /** Session file download deps — when provided, enables /api/session-files/download route. */
  sessionFileDownloadDeps?: SessionFileDownloadDeps
  /**
   * Trusted proxy IPs/CIDRs. When set, proxy headers (x-forwarded-for, x-forwarded-proto)
   * are only trusted from these sources. When empty/unset, proxy headers are ignored
   * and 'direct' is used as the rate-limit key.
   */
  trustedProxies?: string[]
}

// ---------------------------------------------------------------------------
// Handler factory — the core request handler
// ---------------------------------------------------------------------------

export interface WebuiHandler {
  /** Web-standard fetch handler. */
  fetch: (req: Request) => Promise<Response>
  /** Call on shutdown to release timers. */
  dispose: () => void
  /** Inject OAuth callback deps after bootstrap (lazy wiring). */
  setOAuthCallbackDeps: (deps: OAuthCallbackDeps) => void
  /** Inject session file download deps after bootstrap (lazy wiring). */
  setSessionFileDownloadDeps: (deps: SessionFileDownloadDeps) => void
}

/**
 * Create a web-standard fetch handler for the WebUI.
 *
 * This handler can be used directly with `Bun.serve({ fetch })`,
 * or adapted for Node's HTTP server via `nodeHttpAdapter()`.
 */
export function createWebuiHandler(options: WebuiHandlerOptions): WebuiHandler {
  const {
    webuiDir,
    secret,
    password,
    secureCookies,
    publicWsUrl,
    wsProtocol,
    wsPort,
    getHealthCheck,
    logger,
    trustedProxies,
  } = options

  const rateLimiter = new RateLimiter(5, 60_000)
  const cleanupTimer = setInterval(() => rateLimiter.cleanup(), 120_000)

  const loginPassword = password || secret
  const trustedProxySet = new Set(trustedProxies ?? [])

  // Hash the login password at startup (async, but resolves before first auth attempt in practice)
  const passwordReady = initPasswordHash(loginPassword)

  /** Extract client IP — only trusts proxy headers when trustedProxies is configured. */
  function getClientIp(req: Request): string {
    if (trustedProxySet.size > 0) {
      return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        ?? req.headers.get('x-real-ip')
        ?? 'direct'
    }
    return 'direct'
  }

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const useSecureCookies = shouldUseSecureCookies(req, secureCookies)

    // ── Health endpoint (no auth) ──
    if (path === '/health') {
      const health = getHealthCheck()
      return Response.json(health, {
        status: health.status === 'ok' ? 200 : 503,
      })
    }

    // ── Login page (no auth) ──
    if (path === '/login' || path === '/login/') {
      const loginFile = Bun.file(join(webuiDir, 'login.html'))
      if (await loginFile.exists()) {
        return new Response(loginFile, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      return new Response('Login page not found', { status: 404 })
    }

    // ── Static assets that login page needs (no auth) ──
    if (path === '/favicon.ico' || path.startsWith('/login-assets/')) {
      const file = Bun.file(join(webuiDir, path))
      if (await file.exists()) {
        return new Response(file, {
          headers: { 'Content-Type': getMimeType(path) },
        })
      }
      return new Response('Not Found', { status: 404 })
    }

    // ── Auth endpoint ──
    if (path === '/api/auth' && req.method === 'POST') {
      await passwordReady
      const ip = getClientIp(req)

      if (!rateLimiter.check(ip)) {
        logger.warn(`[webui] Rate limited auth attempt from ${ip}`)
        return Response.json(
          { error: 'Too many attempts. Try again later.' },
          { status: 429 },
        )
      }

      let body: { password?: string }
      try {
        body = await req.json() as { password?: string }
      } catch {
        return Response.json({ error: 'Invalid request body' }, { status: 400 })
      }

      if (!body.password || typeof body.password !== 'string') {
        return Response.json({ error: 'Password is required' }, { status: 400 })
      }

      if (!await verifyPassword(body.password)) {
        logger.warn(`[webui] Failed auth attempt from ${ip}`)
        return Response.json({ error: 'Invalid credentials' }, { status: 401 })
      }

      const jwt = await createSessionToken(secret)
      logger.info(`[webui] Successful auth from ${ip}`)

      return Response.json({ ok: true }, {
        status: 200,
        headers: {
          'Set-Cookie': buildSessionCookie(jwt, useSecureCookies),
        },
      })
    }

    // ── Logout endpoint ──
    if (path === '/api/auth/logout' && req.method === 'POST') {
      return new Response(null, {
        status: 204,
        headers: {
          'Set-Cookie': buildLogoutCookie(useSecureCookies),
        },
      })
    }

    // ── OAuth callback (no cookie auth — state param is CSRF protection) ──
    // Receives redirect from the relay (or directly from OAuth provider for MCP sources).
    // Completes the token exchange server-side and renders a success/error page.
    if (path === '/api/oauth/callback' && req.method === 'GET' && options.oauthCallbackDeps) {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      const error = url.searchParams.get('error')
      const errorDescription = url.searchParams.get('error_description')

      if (error) {
        const flow = state ? options.oauthCallbackDeps.flowStore.getByState(state) : null
        if (flow && state) options.oauthCallbackDeps.flowStore.remove(state)
        const errorMsg = errorDescription || error
        logger.warn(`[webui] OAuth callback error: ${errorMsg}`)
        return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: errorMsg }), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }

      if (!code || !state) {
        return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: 'Missing code or state parameter' }), {
          status: 400,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }

      try {
        const { completeOAuthFlow } = await import('../handlers/rpc/oauth')
        const result = await completeOAuthFlow({
          code,
          state,
          flowStore: options.oauthCallbackDeps.flowStore,
          credManager: options.oauthCallbackDeps.credManager as any,
          sessionManager: options.oauthCallbackDeps.sessionManager,
          pushSourcesChanged: options.oauthCallbackDeps.pushSourcesChanged,
          logger,
          // No clientId/workspaceId — HTTP callback skips ownership checks (state is auth)
        })

        if (result.success) {
          return new Response(generateCallbackPage({ title: 'Authorization Successful', isSuccess: true }), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        } else {
          return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: result.error }), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Token exchange failed'
        logger.error(`[webui] OAuth callback failed: ${msg}`)
        return new Response(generateCallbackPage({ title: 'Authorization Failed', isSuccess: false, errorDetail: msg }), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
    }

    // ── Config endpoint (requires session cookie) ──
    if (path === '/api/config' && req.method === 'GET') {
      const configSession = await validateSession(req.headers.get('cookie'), secret)
      if (!configSession) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return Response.json({
        wsUrl: resolveWebSocketUrl(req, { publicWsUrl, wsProtocol, wsPort }),
      })
    }

    // Return the default workspace ID so the webui can include it in the WS handshake
    if (path === '/api/config/workspaces' && req.method === 'GET') {
      const configSession = await validateSession(req.headers.get('cookie'), secret)
      if (!configSession) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const { getActiveWorkspace } = await import('@craft-agent/shared/config/storage')
      const active = getActiveWorkspace()
      return Response.json({
        defaultWorkspaceId: active?.id ?? null,
      })
    }

    // ── Everything below requires a valid session cookie ──
    const cookieHeader = req.headers.get('cookie')
    const session = await validateSession(cookieHeader, secret)

    if (!session) {
      const accept = req.headers.get('accept') ?? ''
      if (accept.includes('text/html') || path === '/' || path === '') {
        return Response.redirect('/login', 302)
      }
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // ── Session file download (streams a file from inside a session directory) ──
    if (path === '/api/session-files/download' && req.method === 'GET') {
      const deps = options.sessionFileDownloadDeps
      if (!deps) {
        return Response.json({ error: 'Not Found' }, { status: 404 })
      }

      const sessionId = url.searchParams.get('sessionId') ?? ''
      const requestedPath = url.searchParams.get('path') ?? ''
      if (!sessionId || !requestedPath) {
        return Response.json({ error: 'Missing sessionId or path' }, { status: 400 })
      }

      // Require an absolute path — refuse relative paths up front
      if (!isAbsolute(requestedPath)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }

      const rawSessionDir = deps.getSessionPath(sessionId)
      if (!rawSessionDir) {
        return Response.json({ error: 'Session not found' }, { status: 404 })
      }

      // Resolve real paths to defeat symlink escapes. If either path can't be
      // realpath'd, fall back to the normalized form — realpath fails when the
      // target doesn't exist, which we handle as 404 once we try to serve.
      let realSessionDir: string
      try {
        realSessionDir = await realpath(rawSessionDir)
      } catch {
        realSessionDir = normalize(rawSessionDir)
      }

      // For the target: prefer realpath so symlinks can't escape the session.
      // If the file itself doesn't exist, realpath throws — fall back to
      // realpath'ing the parent so we still honour symlinks on the containing
      // directory tree (this keeps the containment check consistent with
      // realSessionDir, which also goes through realpath).
      let realTarget: string
      try {
        realTarget = await realpath(requestedPath)
      } catch {
        const normalized = normalize(requestedPath)
        try {
          const realParent = await realpath(dirname(normalized))
          realTarget = join(realParent, basename(normalized))
        } catch {
          realTarget = normalized
        }
      }

      // Containment check: the target must equal or sit under the session dir.
      // Append sep so "/foo/session" doesn't accept "/foo/session-other".
      const sessionPrefix = realSessionDir.endsWith(sep) ? realSessionDir : realSessionDir + sep
      if (realTarget !== realSessionDir && !realTarget.startsWith(sessionPrefix)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }

      const file = Bun.file(realTarget)
      if (!await file.exists()) {
        return Response.json({ error: 'File not found' }, { status: 404 })
      }

      const name = basename(realTarget)
      // RFC 5987: provide an ASCII-safe filename plus the UTF-8 encoded form
      // so browsers preserve non-ASCII names. Strip CR/LF/quote from the fallback.
      const asciiFallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\r\n]/g, '')
      const encoded = encodeURIComponent(name)
      const contentDisposition = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`

      return new Response(file, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': contentDisposition,
          'Content-Length': String(file.size),
          // Disable caching — session files change as the agent writes to them
          'Cache-Control': 'no-store',
        },
      })
    }

    // ── Session zip download (streams the entire session directory as a zip) ──
    if (path === '/api/session-files/download-zip' && req.method === 'GET') {
      const deps = options.sessionFileDownloadDeps
      if (!deps) {
        return Response.json({ error: 'Not Found' }, { status: 404 })
      }

      const sessionId = url.searchParams.get('sessionId') ?? ''
      if (!sessionId) {
        return Response.json({ error: 'Missing sessionId' }, { status: 400 })
      }

      const rawSessionDir = deps.getSessionPath(sessionId)
      if (!rawSessionDir) {
        return Response.json({ error: 'Session not found' }, { status: 404 })
      }

      // Realpath the session root up front so symlinks on the path itself are
      // resolved once, and a non-existent session dir surfaces as 404 instead
      // of a mid-stream error.
      let realSessionDir: string
      try {
        realSessionDir = await realpath(rawSessionDir)
      } catch {
        return Response.json({ error: 'Session not found' }, { status: 404 })
      }

      return createSessionZipResponse({ sessionDir: realSessionDir })
    }

    // ── Serve SPA static files ──
    if (path !== '/') {
      const file = Bun.file(join(webuiDir, path))
      if (await file.exists()) {
        return new Response(file, {
          headers: { 'Content-Type': getMimeType(path) },
        })
      }
    }

    // SPA fallback — serve index.html for all non-file routes
    const indexFile = Bun.file(join(webuiDir, 'index.html'))
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    return new Response('Not Found', { status: 404 })
  }

  return {
    fetch,
    dispose: () => clearInterval(cleanupTimer),
    setOAuthCallbackDeps: (deps: OAuthCallbackDeps) => {
      options.oauthCallbackDeps = deps
    },
    setSessionFileDownloadDeps: (deps: SessionFileDownloadDeps) => {
      options.sessionFileDownloadDeps = deps
    },
  }
}

// ---------------------------------------------------------------------------
// Standalone server (backwards-compatible, uses Bun.serve)
// ---------------------------------------------------------------------------

export interface WebuiHttpServerOptions extends WebuiHandlerOptions {
  /** Port to bind on. Use 0 for an ephemeral port in tests. */
  port: number
}

export async function startWebuiHttpServer(
  options: WebuiHttpServerOptions,
): Promise<{ port: number, stop: () => void }> {
  const { port, logger, ...handlerOpts } = options
  const handler = createWebuiHandler({ ...handlerOpts, logger })

  const server = Bun.serve({
    port,
    fetch: handler.fetch,
  })

  const boundPort = server.port ?? port
  logger.info(`[webui] Web UI server listening on http://0.0.0.0:${boundPort}`)

  return {
    port: boundPort,
    stop: () => {
      handler.dispose()
      server.stop()
    },
  }
}
