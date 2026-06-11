import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

function createTestWebuiDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-webui-redirect-test-'))
  TEMP_DIRS.push(dir)
  writeFileSync(join(dir, 'login.html'), '<!doctype html><html><body>login</body></html>')
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><body>app</body></html>')
  return dir
}

function createHandler() {
  return createWebuiHandler({
    webuiDir: createTestWebuiDir(),
    secret: SECRET,
    password: PASSWORD,
    wsProtocol: 'ws',
    wsPort: 9100,
    getHealthCheck: () => ({ status: 'ok' }),
    logger,
  })
}

afterEach(() => {
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('unauthenticated login redirect', () => {
  // The redirect must NOT be built with Response.redirect('/login'): undici
  // (Node, the Docker runtime) requires an absolute URL there and throws
  // `Failed to parse URL from /login`, which the node adapter surfaces as a
  // 500 on every unauthenticated page load. Bun accepts relative paths, so
  // this suite (bun:test) cannot reproduce the crash itself — the contract
  // below plus a manual `node -e "Response.redirect('/login')"` check is the
  // regression guard.
  it('returns 302 with a relative Location for unauthenticated HTML requests', async () => {
    const handler = createHandler()
    const res = await handler.fetch(
      new Request('http://127.0.0.1/', {
        headers: { accept: 'text/html' },
      }),
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/login')
  })

  it('returns 401 JSON (no redirect) for unauthenticated API requests', async () => {
    const handler = createHandler()
    const res = await handler.fetch(
      new Request('http://127.0.0.1/api/session-files/download?sessionId=s1&path=/tmp/x', {
        headers: { accept: 'application/json' },
      }),
    )
    expect(res.status).toBe(401)
  })
})
