import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createWebuiHandler } from '../http-server'

const SECRET = 'test-server-secret'
const PASSWORD = 'test-password'
const TEMP_DIRS: string[] = []

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  TEMP_DIRS.push(dir)
  return dir
}

function createTestWebuiDir(): string {
  const dir = createTempDir('craft-webui-dl-test-')
  writeFileSync(join(dir, 'login.html'), '<!doctype html><html><body>login</body></html>')
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>app</body></html>')
  return dir
}

/**
 * Create a handler wired with a download-deps resolver that maps session IDs
 * to absolute directory paths. Any unknown sessionId resolves to null,
 * matching the real SessionManager contract.
 */
function createHandler(sessionMap: Record<string, string>) {
  const handler = createWebuiHandler({
    webuiDir: createTestWebuiDir(),
    secret: SECRET,
    password: PASSWORD,
    wsProtocol: 'ws',
    wsPort: 9100,
    getHealthCheck: () => ({ status: 'ok' }),
    logger,
  })
  handler.setSessionFileDownloadDeps({
    getSessionPath: (id) => sessionMap[id] ?? null,
  })
  return handler
}

async function authenticate(handler: ReturnType<typeof createHandler>): Promise<string> {
  const res = await handler.fetch(
    new Request('http://127.0.0.1/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD }),
    }),
  )
  expect(res.status).toBe(200)
  const setCookie = res.headers.get('set-cookie')
  expect(setCookie).toBeTruthy()
  return setCookie!.split(';')[0]!
}

afterEach(() => {
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('WebUI /api/session-files/download', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const sessionDir = createTempDir('craft-session-')
    writeFileSync(join(sessionDir, 'hello.txt'), 'hello')

    const handler = createHandler({ 's1': sessionDir })
    try {
      const res = await handler.fetch(
        new Request(
          `http://127.0.0.1/api/session-files/download?sessionId=s1&path=${encodeURIComponent(join(sessionDir, 'hello.txt'))}`,
        ),
      )
      expect(res.status).toBe(401)
    } finally {
      handler.dispose()
    }
  })

  it('streams file contents with an attachment disposition', async () => {
    const sessionDir = createTempDir('craft-session-')
    const filePath = join(sessionDir, 'report.txt')
    const payload = 'one two three'
    writeFileSync(filePath, payload)

    const handler = createHandler({ 's1': sessionDir })
    try {
      const cookie = await authenticate(handler)
      const res = await handler.fetch(
        new Request(
          `http://127.0.0.1/api/session-files/download?sessionId=s1&path=${encodeURIComponent(filePath)}`,
          { headers: { cookie } },
        ),
      )
      expect(res.status).toBe(200)
      const disposition = res.headers.get('content-disposition')
      expect(disposition).toContain('attachment')
      expect(disposition).toContain('filename="report.txt"')
      expect(await res.text()).toBe(payload)
    } finally {
      handler.dispose()
    }
  })

  it('uses RFC 5987 encoding for non-ASCII filenames', async () => {
    const sessionDir = createTempDir('craft-session-')
    const filePath = join(sessionDir, '报告.txt')
    writeFileSync(filePath, 'zh')

    const handler = createHandler({ 's1': sessionDir })
    try {
      const cookie = await authenticate(handler)
      const res = await handler.fetch(
        new Request(
          `http://127.0.0.1/api/session-files/download?sessionId=s1&path=${encodeURIComponent(filePath)}`,
          { headers: { cookie } },
        ),
      )
      expect(res.status).toBe(200)
      const disposition = res.headers.get('content-disposition') ?? ''
      // ASCII fallback (non-ASCII replaced with underscores) + UTF-8 form
      expect(disposition).toContain('filename="__.txt"')
      expect(disposition).toContain("filename*=UTF-8''%E6%8A%A5%E5%91%8A.txt")
    } finally {
      handler.dispose()
    }
  })

  it('returns 400 when sessionId or path is missing', async () => {
    const sessionDir = createTempDir('craft-session-')
    const handler = createHandler({ 's1': sessionDir })
    try {
      const cookie = await authenticate(handler)

      const missingPath = await handler.fetch(
        new Request('http://127.0.0.1/api/session-files/download?sessionId=s1', {
          headers: { cookie },
        }),
      )
      expect(missingPath.status).toBe(400)

      const missingSession = await handler.fetch(
        new Request('http://127.0.0.1/api/session-files/download?path=/tmp/x', {
          headers: { cookie },
        }),
      )
      expect(missingSession.status).toBe(400)
    } finally {
      handler.dispose()
    }
  })

  it('returns 404 for unknown sessionId', async () => {
    const handler = createHandler({})
    try {
      const cookie = await authenticate(handler)
      const res = await handler.fetch(
        new Request(
          'http://127.0.0.1/api/session-files/download?sessionId=ghost&path=/tmp/x',
          { headers: { cookie } },
        ),
      )
      expect(res.status).toBe(404)
    } finally {
      handler.dispose()
    }
  })

  it('blocks cross-session path traversal with ..', async () => {
    // Two sessions side-by-side — s1 must not be able to exfiltrate from s2.
    const parent = createTempDir('craft-sessions-')
    const session1 = join(parent, 's1')
    const session2 = join(parent, 's2')
    mkdirSync(session1)
    mkdirSync(session2)
    writeFileSync(join(session2, 'secret.txt'), 'sibling-secret')

    const handler = createHandler({ 's1': session1, 's2': session2 })
    try {
      const cookie = await authenticate(handler)

      // Attempt 1: literal traversal in the path
      const traversal = `${session1}/../s2/secret.txt`
      const res1 = await handler.fetch(
        new Request(
          `http://127.0.0.1/api/session-files/download?sessionId=s1&path=${encodeURIComponent(traversal)}`,
          { headers: { cookie } },
        ),
      )
      expect(res1.status).toBe(403)

      // Attempt 2: the absolute sibling path itself (no traversal needed)
      const siblingPath = join(session2, 'secret.txt')
      const res2 = await handler.fetch(
        new Request(
          `http://127.0.0.1/api/session-files/download?sessionId=s1&path=${encodeURIComponent(siblingPath)}`,
          { headers: { cookie } },
        ),
      )
      expect(res2.status).toBe(403)
    } finally {
      handler.dispose()
    }
  })

  it('blocks paths outside any session (e.g. /etc/passwd style targets)', async () => {
    const sessionDir = createTempDir('craft-session-')
    const handler = createHandler({ 's1': sessionDir })
    try {
      const cookie = await authenticate(handler)
      const res = await handler.fetch(
        new Request(
          `http://127.0.0.1/api/session-files/download?sessionId=s1&path=${encodeURIComponent('/etc/passwd')}`,
          { headers: { cookie } },
        ),
      )
      expect(res.status).toBe(403)
    } finally {
      handler.dispose()
    }
  })

  it('rejects relative paths', async () => {
    const sessionDir = createTempDir('craft-session-')
    const handler = createHandler({ 's1': sessionDir })
    try {
      const cookie = await authenticate(handler)
      const res = await handler.fetch(
        new Request(
          'http://127.0.0.1/api/session-files/download?sessionId=s1&path=relative%2Fpath.txt',
          { headers: { cookie } },
        ),
      )
      expect(res.status).toBe(403)
    } finally {
      handler.dispose()
    }
  })

  it('returns 404 when the requested file does not exist inside the session', async () => {
    const sessionDir = createTempDir('craft-session-')
    const missing = join(sessionDir, 'never-written.txt')

    const handler = createHandler({ 's1': sessionDir })
    try {
      const cookie = await authenticate(handler)
      const res = await handler.fetch(
        new Request(
          `http://127.0.0.1/api/session-files/download?sessionId=s1&path=${encodeURIComponent(missing)}`,
          { headers: { cookie } },
        ),
      )
      expect(res.status).toBe(404)
    } finally {
      handler.dispose()
    }
  })

  it('serves nested files inside the session directory', async () => {
    const sessionDir = createTempDir('craft-session-')
    const nested = join(sessionDir, 'downloads', 'nested', 'artifact.bin')
    mkdirSync(join(sessionDir, 'downloads', 'nested'), { recursive: true })
    const payload = Buffer.from([0x01, 0x02, 0x03, 0x04])
    writeFileSync(nested, payload)

    const handler = createHandler({ 's1': sessionDir })
    try {
      const cookie = await authenticate(handler)
      const res = await handler.fetch(
        new Request(
          `http://127.0.0.1/api/session-files/download?sessionId=s1&path=${encodeURIComponent(nested)}`,
          { headers: { cookie } },
        ),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('content-length')).toBe(String(payload.length))
      const buf = Buffer.from(await res.arrayBuffer())
      expect(buf.equals(payload)).toBe(true)
    } finally {
      handler.dispose()
    }
  })

  it('returns 404 when deps are not configured', async () => {
    // Create a handler without wiring the download deps.
    const handler = createWebuiHandler({
      webuiDir: createTestWebuiDir(),
      secret: SECRET,
      password: PASSWORD,
      wsProtocol: 'ws',
      wsPort: 9100,
      getHealthCheck: () => ({ status: 'ok' }),
      logger,
    })
    try {
      const cookie = await authenticate(handler)
      const res = await handler.fetch(
        new Request(
          'http://127.0.0.1/api/session-files/download?sessionId=s1&path=/tmp/x',
          { headers: { cookie } },
        ),
      )
      expect(res.status).toBe(404)
    } finally {
      handler.dispose()
    }
  })
})
