import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { resolveEndpoint, readDiscoveryFile, describeConnection, resolveWorkspaceId, DEFAULT_URL, DISCOVERY_FILE } from './transport.ts'
import type { CliRpcClient } from '../client.ts'

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

describe('describeConnection', () => {
  it('marks loopback hosts as same-machine', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', '0.0.0.0']) {
      const url = host === '::1' ? `ws://[${host}]:9100` : `ws://${host}:9100`
      const info = describeConnection({ url, token: undefined, source: 'default' })
      expect(info.sameMachine).toBe(true)
      expect(info.host).toBe(host)
      expect(info.urlSource).toBe('default')
    }
  })

  it('marks remote hosts as not same-machine', () => {
    const info = describeConnection({
      url: 'wss://datapilot.example.com:443',
      token: 'x',
      source: 'env',
    })
    expect(info.sameMachine).toBe(false)
    expect(info.host).toBe('datapilot.example.com')
    expect(info.urlSource).toBe('env')
  })

  it('handles malformed URLs without crashing', () => {
    const info = describeConnection({ url: 'not a url', token: undefined, source: 'flag' })
    expect(info.host).toBe('')
    expect(info.sameMachine).toBe(false)
  })
})

describe('resolveWorkspaceId', () => {
  const PREV_WORKSPACE = process.env.DATAPILOT_WORKSPACE
  const WORKSPACES = [
    { id: 'ws-alpha', slug: 'alpha', name: 'Alpha' },
    { id: 'ws-beta', slug: 'beta', name: 'Beta' },
  ]

  beforeEach(() => {
    delete process.env.DATAPILOT_WORKSPACE
  })

  afterEach(() => {
    if (PREV_WORKSPACE === undefined) delete process.env.DATAPILOT_WORKSPACE
    else process.env.DATAPILOT_WORKSPACE = PREV_WORKSPACE
  })

  function fakeClient(): CliRpcClient {
    return {
      invoke: async (channel: string) => {
        if (channel === 'workspaces:get') return WORKSPACES
        return undefined
      },
    } as unknown as CliRpcClient
  }

  it('reports source=flag when --workspace given', async () => {
    process.env.DATAPILOT_WORKSPACE = 'beta' // should be overridden
    const r = await resolveWorkspaceId(fakeClient(), 'alpha')
    expect(r?.id).toBe('ws-alpha')
    expect(r?.source).toBe('flag')
    expect(r?.ambiguous).toBe(false)
  })

  it('reports source=env when only $DATAPILOT_WORKSPACE set', async () => {
    process.env.DATAPILOT_WORKSPACE = 'beta'
    const r = await resolveWorkspaceId(fakeClient(), undefined)
    expect(r?.id).toBe('ws-beta')
    expect(r?.source).toBe('env')
    expect(r?.ambiguous).toBe(false)
  })

  it('reports source=fallback + ambiguous when multi-workspace and nothing set', async () => {
    const r = await resolveWorkspaceId(fakeClient(), undefined)
    expect(r?.id).toBe('ws-alpha')
    expect(r?.source).toBe('fallback')
    expect(r?.ambiguous).toBe(true)
  })

  it('reports source=fallback + NOT ambiguous when server has exactly one workspace', async () => {
    const single = {
      invoke: async (channel: string) => {
        if (channel === 'workspaces:get') return [{ id: 'ws-only', slug: 'only', name: 'Only' }]
        return undefined
      },
    } as unknown as CliRpcClient
    const r = await resolveWorkspaceId(single, undefined)
    expect(r?.id).toBe('ws-only')
    expect(r?.source).toBe('fallback')
    expect(r?.ambiguous).toBe(false)
  })

  it('returns undefined when server has zero workspaces and nothing requested', async () => {
    const empty = { invoke: async () => [] } as unknown as CliRpcClient
    const r = await resolveWorkspaceId(empty, undefined)
    expect(r).toBeUndefined()
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
