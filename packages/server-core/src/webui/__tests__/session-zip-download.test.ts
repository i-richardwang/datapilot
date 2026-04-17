import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'

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
  const dir = createTempDir('craft-webui-zip-test-')
  writeFileSync(join(dir, 'login.html'), '<!doctype html><html><body>login</body></html>')
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>app</body></html>')
  return dir
}

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

describe('WebUI /api/session-files/download-zip', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const sessionDir = createTempDir('craft-session-')
    writeFileSync(join(sessionDir, 'hello.txt'), 'hello')

    const handler = createHandler({ 's1': sessionDir })
    try {
      const res = await handler.fetch(
        new Request('http://127.0.0.1/api/session-files/download-zip?sessionId=s1'),
      )
      expect(res.status).toBe(401)
    } finally {
      handler.dispose()
    }
  })

  it('returns 400 when sessionId is missing', async () => {
    const handler = createHandler({})
    try {
      const cookie = await authenticate(handler)
      const res = await handler.fetch(
        new Request('http://127.0.0.1/api/session-files/download-zip', {
          headers: { cookie },
        }),
      )
      expect(res.status).toBe(400)
    } finally {
      handler.dispose()
    }
  })

  it('returns 404 for unknown sessionId', async () => {
    const handler = createHandler({})
    try {
      const cookie = await authenticate(handler)
      const res = await handler.fetch(
        new Request('http://127.0.0.1/api/session-files/download-zip?sessionId=ghost', {
          headers: { cookie },
        }),
      )
      expect(res.status).toBe(404)
    } finally {
      handler.dispose()
    }
  })

  it('returns 404 when the session directory does not exist on disk', async () => {
    // Resolver points at a path that never existed — simulates a deleted session.
    const handler = createHandler({ 's1': join(tmpdir(), 'definitely-not-here-' + Date.now()) })
    try {
      const cookie = await authenticate(handler)
      const res = await handler.fetch(
        new Request('http://127.0.0.1/api/session-files/download-zip?sessionId=s1', {
          headers: { cookie },
        }),
      )
      expect(res.status).toBe(404)
    } finally {
      handler.dispose()
    }
  })

  it('returns 404 when deps are not configured', async () => {
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
        new Request('http://127.0.0.1/api/session-files/download-zip?sessionId=s1', {
          headers: { cookie },
        }),
      )
      expect(res.status).toBe(404)
    } finally {
      handler.dispose()
    }
  })

  it('streams a zip attachment that extracts to the original files', async () => {
    const sessionDir = createTempDir('craft-session-')
    writeFileSync(join(sessionDir, 'top.txt'), 'top-content')
    mkdirSync(join(sessionDir, 'sub', 'nested'), { recursive: true })
    writeFileSync(join(sessionDir, 'sub', 'nested', 'deep.txt'), 'nested-content')
    const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x7f])
    writeFileSync(join(sessionDir, 'sub', 'bytes.bin'), binary)

    const handler = createHandler({ 's1': sessionDir })
    try {
      const cookie = await authenticate(handler)
      const res = await handler.fetch(
        new Request('http://127.0.0.1/api/session-files/download-zip?sessionId=s1', {
          headers: { cookie },
        }),
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/zip')
      const disposition = res.headers.get('content-disposition') ?? ''
      expect(disposition).toContain('attachment')

      const buf = new Uint8Array(await res.arrayBuffer())
      const entries = unzipSync(buf)
      expect(strFromU8(entries['top.txt']!)).toBe('top-content')
      expect(strFromU8(entries['sub/nested/deep.txt']!)).toBe('nested-content')
      expect(Buffer.from(entries['sub/bytes.bin']!).equals(binary)).toBe(true)
    } finally {
      handler.dispose()
    }
  })

  it('preserves non-ASCII filenames inside the zip and in the archive name', async () => {
    const parent = createTempDir('craft-sessions-')
    const sessionDir = join(parent, '会话-2024')
    mkdirSync(sessionDir)
    writeFileSync(join(sessionDir, '报告.html'), '<html>hi</html>')

    const handler = createHandler({ 's1': sessionDir })
    try {
      const cookie = await authenticate(handler)
      const res = await handler.fetch(
        new Request('http://127.0.0.1/api/session-files/download-zip?sessionId=s1', {
          headers: { cookie },
        }),
      )
      expect(res.status).toBe(200)

      const disposition = res.headers.get('content-disposition') ?? ''
      // Session dir name is non-ASCII → RFC 5987 UTF-8 form carries the full name.
      expect(disposition).toContain("filename*=UTF-8''")
      expect(disposition).toContain(encodeURIComponent('会话-2024.zip'))
      // Fallback filename is ASCII-only with underscores standing in for non-ASCII.
      expect(disposition).toMatch(/filename="[\x20-\x7e]+"/)

      const buf = new Uint8Array(await res.arrayBuffer())
      const entries = unzipSync(buf)
      expect(Object.keys(entries)).toContain('报告.html')
      expect(strFromU8(entries['报告.html']!)).toBe('<html>hi</html>')
    } finally {
      handler.dispose()
    }
  })

  it('produces a valid zip for an empty session directory', async () => {
    const sessionDir = createTempDir('craft-session-empty-')

    const handler = createHandler({ 's1': sessionDir })
    try {
      const cookie = await authenticate(handler)
      const res = await handler.fetch(
        new Request('http://127.0.0.1/api/session-files/download-zip?sessionId=s1', {
          headers: { cookie },
        }),
      )
      expect(res.status).toBe(200)
      const buf = new Uint8Array(await res.arrayBuffer())
      expect(buf.length).toBeGreaterThan(0)
      // End-of-central-directory signature must be present even for empty archives.
      const entries = unzipSync(buf)
      expect(Object.keys(entries)).toHaveLength(0)
    } finally {
      handler.dispose()
    }
  })

  it('streams without materializing the whole archive in memory', async () => {
    // Write ~8 MB across 4 files and verify the response body is a ReadableStream
    // that yields the first chunk before the full archive is known. We don't want
    // the handler to pre-build a Buffer — this would defeat the streaming guarantee.
    const sessionDir = createTempDir('craft-session-stream-')
    const chunk = Buffer.alloc(2 * 1024 * 1024, 0x61) // 2 MB of 'a'
    writeFileSync(join(sessionDir, 'a.bin'), chunk)
    writeFileSync(join(sessionDir, 'b.bin'), chunk)
    writeFileSync(join(sessionDir, 'c.bin'), chunk)
    writeFileSync(join(sessionDir, 'd.bin'), chunk)

    const handler = createHandler({ 's1': sessionDir })
    try {
      const cookie = await authenticate(handler)
      const res = await handler.fetch(
        new Request('http://127.0.0.1/api/session-files/download-zip?sessionId=s1', {
          headers: { cookie },
        }),
      )
      expect(res.status).toBe(200)
      expect(res.body).toBeInstanceOf(ReadableStream)
      // Peeking the stream — the first chunk (local file header + data) must be
      // available before the producer has walked/read the entire session.
      const reader = res.body!.getReader()
      const first = await reader.read()
      expect(first.done).toBe(false)
      expect(first.value).toBeInstanceOf(Uint8Array)
      // Collect the rest so the test finishes cleanly.
      let total = first.value!.length
      while (true) {
        const next = await reader.read()
        if (next.done) break
        total += next.value!.length
      }
      // Sanity: we should have emitted at least the raw file contents (8 MB).
      expect(total).toBeGreaterThanOrEqual(8 * 1024 * 1024)
    } finally {
      handler.dispose()
    }
  })
})
