import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { resolveEndpoint, readDiscoveryFile, DEFAULT_URL, DISCOVERY_FILE } from './transport.ts'

const PREV_URL = process.env.DATAPILOT_SERVER_URL
const PREV_TOKEN = process.env.DATAPILOT_SERVER_TOKEN
const HAD_DISCOVERY = existsSync(DISCOVERY_FILE)
const PREV_DISCOVERY = HAD_DISCOVERY ? Bun.file(DISCOVERY_FILE).text() : null

beforeEach(() => {
  delete process.env.DATAPILOT_SERVER_URL
  delete process.env.DATAPILOT_SERVER_TOKEN
  if (existsSync(DISCOVERY_FILE)) unlinkSync(DISCOVERY_FILE)
})

afterEach(async () => {
  if (PREV_URL === undefined) delete process.env.DATAPILOT_SERVER_URL
  else process.env.DATAPILOT_SERVER_URL = PREV_URL
  if (PREV_TOKEN === undefined) delete process.env.DATAPILOT_SERVER_TOKEN
  else process.env.DATAPILOT_SERVER_TOKEN = PREV_TOKEN

  if (HAD_DISCOVERY && PREV_DISCOVERY) {
    const dir = dirname(DISCOVERY_FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(DISCOVERY_FILE, await PREV_DISCOVERY)
  } else if (existsSync(DISCOVERY_FILE)) {
    try { rmSync(DISCOVERY_FILE) } catch { /* ignore */ }
  }
})

describe('resolveEndpoint', () => {
  it('prefers --url flag over everything', () => {
    process.env.DATAPILOT_SERVER_URL = 'ws://env:1'
    const ep = resolveEndpoint({ url: 'ws://flag:2', token: 'flag-tok' })
    expect(ep.url).toBe('ws://flag:2')
    expect(ep.token).toBe('flag-tok')
    expect(ep.source).toBe('flag')
  })

  it('falls back to env when no flag', () => {
    process.env.DATAPILOT_SERVER_URL = 'ws://env:1'
    process.env.DATAPILOT_SERVER_TOKEN = 'env-tok'
    const ep = resolveEndpoint({})
    expect(ep.url).toBe('ws://env:1')
    expect(ep.token).toBe('env-tok')
    expect(ep.source).toBe('env')
  })

  it('reports source=env (not flag) when only env is set — regression for DEV-20 review item 3', () => {
    // parseArgs no longer back-fills env into global.url, so when nothing was
    // passed on the command line, resolveEndpoint must take the env branch and
    // report source: 'env'. Previously this branch was dead code because
    // parseArgs pre-filled opts.url from env, masking the env source as 'flag'.
    process.env.DATAPILOT_SERVER_URL = 'ws://env-only:9'
    const ep = resolveEndpoint({})
    expect(ep.source).toBe('env')
  })

  it('reads discovery file when no flag/env', () => {
    const dir = dirname(DISCOVERY_FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(DISCOVERY_FILE, JSON.stringify({ url: 'ws://disc:3', token: 'disc-tok', pid: 9999 }))
    const ep = resolveEndpoint({})
    expect(ep.url).toBe('ws://disc:3')
    expect(ep.token).toBe('disc-tok')
    expect(ep.source).toBe('discovery')
  })

  it('falls back to default URL when nothing set', () => {
    const ep = resolveEndpoint({})
    expect(ep.url).toBe(DEFAULT_URL)
    expect(ep.source).toBe('default')
  })
})

describe('readDiscoveryFile', () => {
  it('returns null when file missing', () => {
    expect(readDiscoveryFile()).toBeNull()
  })

  it('returns the parsed record when present', () => {
    const dir = dirname(DISCOVERY_FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(DISCOVERY_FILE, JSON.stringify({ url: 'ws://x:1', pid: 42 }))
    const r = readDiscoveryFile()
    expect(r?.url).toBe('ws://x:1')
    expect(r?.pid).toBe(42)
  })

  it('returns null on garbage content', () => {
    const dir = dirname(DISCOVERY_FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(DISCOVERY_FILE, 'not json at all')
    expect(readDiscoveryFile()).toBeNull()
  })
})
