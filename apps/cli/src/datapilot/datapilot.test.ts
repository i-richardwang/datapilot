/**
 * Round-trip CLI tests against an in-process mock WebSocket server.
 *
 * The mock implements the server side of the handshake + RPC protocol so
 * we can exercise the full client → router → entity-command path without
 * needing the real DataPilot server.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import {
  serializeEnvelope,
  deserializeEnvelope,
} from '@craft-agent/server-core/transport'
import type { MessageEnvelope } from '@craft-agent/shared/protocol'

const ENTRY = join(import.meta.dir, '..', 'datapilot.ts')

interface RecordedRequest { channel: string; args: unknown[] }

interface MockOptions {
  /** Per-channel response handler. Returns the result, or throws to send an error. */
  handlers?: Record<string, (args: unknown[]) => unknown>
  /** When true, never ack the handshake. Used to exercise CONNECTION_ERROR. */
  failHandshake?: boolean
}

interface MockServer {
  url: string
  port: number
  requests: RecordedRequest[]
  close: () => void
}

function startMockServer(opts: MockOptions = {}): MockServer {
  const requests: RecordedRequest[] = []
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      if (srv.upgrade(req)) return undefined
      return new Response('Not found', { status: 404 })
    },
    websocket: {
      message(ws, raw) {
        const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
        const env = deserializeEnvelope(text)
        if (env.type === 'handshake') {
          if (opts.failHandshake) return
          ws.send(serializeEnvelope({
            id: crypto.randomUUID(),
            type: 'handshake_ack',
            clientId: 'mock-client',
            protocolVersion: '1.0',
          }))
          return
        }
        if (env.type === 'request' && env.channel) {
          requests.push({ channel: env.channel, args: env.args ?? [] })
          const handler = opts.handlers?.[env.channel]
          let response: MessageEnvelope
          try {
            const result = handler ? handler(env.args ?? []) : null
            response = {
              id: env.id,
              type: 'response',
              channel: env.channel,
              result,
            }
          } catch (e) {
            response = {
              id: env.id,
              type: 'response',
              channel: env.channel,
              error: { code: 'HANDLER_ERROR', message: (e as Error).message },
            }
          }
          ws.send(serializeEnvelope(response))
        }
      },
    },
  })

  return {
    url: `ws://127.0.0.1:${server.port}`,
    port: server.port!,
    requests,
    close: () => server.stop(true),
  }
}

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
  envelope: { ok: boolean; data?: unknown; error?: { code: string; message: string }; warnings?: string[] } | null
}

async function runCli(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  return await new Promise<RunResult>((resolve) => {
    const proc = spawn('bun', ['run', ENTRY, ...args], {
      env: {
        ...process.env,
        // Force JSON envelope so output is parseable in tests
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => { stdout += String(d) })
    proc.stderr.on('data', (d) => { stderr += String(d) })
    proc.on('close', (code) => {
      let envelope: RunResult['envelope'] = null
      try { envelope = JSON.parse(stdout.trim()) } catch { /* not JSON */ }
      resolve({ exitCode: code ?? 0, stdout, stderr, envelope })
    })
  })
}

let server: MockServer | null = null

beforeEach(() => {
  delete process.env.DATAPILOT_SERVER_URL
  delete process.env.DATAPILOT_SERVER_TOKEN
})

afterEach(() => {
  server?.close()
  server = null
})

describe('datapilot CLI', () => {
  it('label list returns envelope with ok:true', async () => {
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1', name: 'Test' }],
        'window:switchWorkspace': () => undefined,
        'labels:list': () => [{ id: 'lbl-1', name: 'TODO', color: 'blue' }],
      },
    })
    const r = await runCli(['--url', server.url, '--token', 't', '--json', 'label', 'list'])
    expect(r.exitCode).toBe(0)
    expect(r.envelope?.ok).toBe(true)
    expect(r.envelope?.data).toEqual([{ id: 'lbl-1', name: 'TODO', color: 'blue' }])
  })

  it('label create + list round-trip via the same mock server', async () => {
    let lastCreate: { name?: string; color?: string } | null = null
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
        'labels:create': ([_ws, input]) => {
          lastCreate = input as { name?: string; color?: string }
          return { id: 'lbl-new', ...lastCreate }
        },
        'labels:list': () => (lastCreate ? [{ id: 'lbl-new', ...lastCreate }] : []),
      },
    })

    const create = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'label', 'create', '--name', 'TODO', '--color', 'blue',
    ])
    expect(create.exitCode).toBe(0)
    expect(create.envelope?.ok).toBe(true)
    expect((create.envelope?.data as Record<string, unknown>).id).toBe('lbl-new')

    const list = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'label', 'list',
    ])
    expect(list.exitCode).toBe(0)
    expect(list.envelope?.ok).toBe(true)
    expect(list.envelope?.data).toEqual([{ id: 'lbl-new', name: 'TODO', color: 'blue' }])
  })

  it('connection failure returns CONNECTION_ERROR envelope, exit 1', async () => {
    // Pick a port that nothing is listening on
    const r = await runCli([
      '--url', 'ws://127.0.0.1:1', '--token', 't', '--json',
      '--timeout', '500',
      'label', 'list',
    ])
    expect(r.exitCode).toBe(1)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('CONNECTION_ERROR')
    expect(r.envelope?.error?.message).toContain('no server detected')
    expect(r.envelope?.error?.message).toContain('--url')
  })

  it('unknown entity returns USAGE_ERROR with exit 2', async () => {
    const r = await runCli(['--json', 'no-such-entity', 'whatever'])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
  })

  it('label create without --name fails with USAGE_ERROR (no server connect needed)', async () => {
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'label', 'create',
    ])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
  })

  it('server entity is no longer routed', async () => {
    const r = await runCli(['--json', 'server', 'status'])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
    expect(r.envelope?.error?.message).toContain('Unknown entity')
  })

  it('source test action returns USAGE_ERROR', async () => {
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'source', 'test', 'linear',
    ])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
    expect(r.envelope?.error?.message).toContain('Unknown source action: test')
  })

  it('--input with non-object JSON returns USAGE_ERROR, not INTERNAL_ERROR', async () => {
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'label', 'create', '--input', '123',
    ])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
    expect(r.envelope?.error?.message).toContain('--input')
  })

  it('skill create merges --slug into input and invokes with 2 business args', async () => {
    let lastArgs: unknown[] | null = null
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
        'skills:create': (args) => {
          lastArgs = args
          const input = args[1] as { slug: string; name: string; description: string }
          return { slug: input.slug, path: `/skills/${input.slug}`, metadata: { name: input.name, description: input.description } }
        },
      },
    })

    // Path 1 — slug via --slug flag, other fields via --input
    const viaFlag = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'skill', 'create', '--slug', 'test-skill',
      '--input', '{"name":"Test","description":"desc"}',
    ])
    expect(viaFlag.exitCode).toBe(0)
    expect(viaFlag.envelope?.ok).toBe(true)
    expect((viaFlag.envelope?.data as Record<string, unknown>).slug).toBe('test-skill')
    expect(lastArgs).not.toBeNull()
    expect(lastArgs!.length).toBe(2)
    expect(lastArgs![1]).toEqual({ slug: 'test-skill', name: 'Test', description: 'desc' })

    // Path 2 — slug embedded inside --input
    const viaInput = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'skill', 'create',
      '--input', '{"slug":"test-skill-2","name":"Test 2","description":"d2"}',
    ])
    expect(viaInput.exitCode).toBe(0)
    expect(viaInput.envelope?.ok).toBe(true)
    expect((viaInput.envelope?.data as Record<string, unknown>).slug).toBe('test-skill-2')
    expect(lastArgs!.length).toBe(2)
    expect(lastArgs![1]).toEqual({ slug: 'test-skill-2', name: 'Test 2', description: 'd2' })
  })

  it('TTY detection: --json forces envelope output', async () => {
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
        'labels:list': () => [],
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'label', 'list',
    ])
    expect(r.envelope?.ok).toBe(true)
    expect(r.envelope?.data).toEqual([])
  })

  it('session create without --mode defaults to allow-all', async () => {
    let createArgs: unknown[] = []
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
        'sessions:create': (args) => {
          createArgs = args
          const opts = args[1] as { permissionMode?: string; name?: string }
          return { id: 'sess-1', permissionMode: opts.permissionMode, name: opts.name }
        },
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'session', 'create', '--name', 'foo',
    ])
    expect(r.exitCode).toBe(0)
    expect(r.envelope?.ok).toBe(true)
    expect((r.envelope?.data as Record<string, unknown>).permissionMode).toBe('allow-all')
    expect((createArgs[1] as Record<string, unknown>).permissionMode).toBe('allow-all')
  })

  it('session create --mode safe overrides the CLI default', async () => {
    let createArgs: unknown[] = []
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
        'sessions:create': (args) => {
          createArgs = args
          const opts = args[1] as { permissionMode?: string }
          return { id: 'sess-1', permissionMode: opts.permissionMode }
        },
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'session', 'create', '--name', 'foo', '--mode', 'safe',
    ])
    expect(r.exitCode).toBe(0)
    expect((createArgs[1] as Record<string, unknown>).permissionMode).toBe('safe')
  })

  it('session create --input {"permissionMode":"ask"} overrides the CLI default', async () => {
    let createArgs: unknown[] = []
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
        'sessions:create': (args) => {
          createArgs = args
          const opts = args[1] as { permissionMode?: string }
          return { id: 'sess-1', permissionMode: opts.permissionMode }
        },
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'session', 'create', '--input', '{"name":"foo","permissionMode":"ask"}',
    ])
    expect(r.exitCode).toBe(0)
    expect((createArgs[1] as Record<string, unknown>).permissionMode).toBe('ask')
  })

  it('workspace get returns settings but not permissions', async () => {
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1', name: 'Test Workspace' }],
        'window:switchWorkspace': () => undefined,
        'workspaceSettings:get': () => ({ theme: 'dark', language: 'zh' }),
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'workspace', 'get', 'ws-1',
    ])
    expect(r.exitCode).toBe(0)
    expect(r.envelope?.ok).toBe(true)
    expect(r.envelope?.data).toEqual({
      id: 'ws-1',
      name: 'Test Workspace',
      settings: { theme: 'dark', language: 'zh' },
    })
    expect(r.envelope?.data).not.toHaveProperty('permissions')
    expect(server.requests.find((req) => req.channel === 'workspaceSettings:get')).toBeDefined()
  })

  it('permission entity is no longer routed', async () => {
    const r = await runCli(['--json', 'permission', 'list'])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
    expect(r.envelope?.error?.message).toContain('Unknown entity')
  })

  it('source get returns merged response with permissions and mcpTools', async () => {
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
        'sources:get': () => [{ slug: 'linear', name: 'Linear', provider: 'linear', type: 'mcp' }],
        'sources:getPermissions': () => ({ allowedTools: ['linear_search'], defaultPolicy: 'allow' }),
        'sources:getMcpTools': () => [{ name: 'linear_search', permissionStatus: 'allowed' }],
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'source', 'get', 'linear',
    ])
    expect(r.exitCode).toBe(0)
    expect(r.envelope?.ok).toBe(true)
    const data = r.envelope?.data as Record<string, unknown>
    expect(data.slug).toBe('linear')
    expect(data.name).toBe('Linear')
    expect(data.permissions).toEqual({ allowedTools: ['linear_search'], defaultPolicy: 'allow' })
    expect(data.mcpTools).toEqual([{ name: 'linear_search', permissionStatus: 'allowed' }])
  })

  it('source get-permissions returns USAGE_ERROR', async () => {
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'source', 'get-permissions', 'linear',
    ])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
  })

  it('source get-mcp-tools returns USAGE_ERROR', async () => {
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'source', 'get-mcp-tools', 'linear',
    ])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
  })

  it('batch items sends default offset=0 and limit=100', async () => {
    let lastArgs: unknown[] = []
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
        'batches:getItems': (args) => {
          lastArgs = args
          return { items: [], total: 0, offset: args[2] as number, limit: args[3] as number, runningOffset: 0 }
        },
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'batch', 'items', 'abc123',
    ])
    expect(r.exitCode).toBe(0)
    expect(r.envelope?.ok).toBe(true)
    expect(lastArgs[2]).toBe(0)
    expect(lastArgs[3]).toBe(100)
  })

  it('batch items --offset 5 --limit 10 passes explicit pagination', async () => {
    let lastArgs: unknown[] = []
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
        'batches:getItems': (args) => {
          lastArgs = args
          return { items: [], total: 50, offset: args[2] as number, limit: args[3] as number, runningOffset: 5 }
        },
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'batch', 'items', 'abc123', '--offset', '5', '--limit', '10',
    ])
    expect(r.exitCode).toBe(0)
    expect(r.envelope?.ok).toBe(true)
    expect(lastArgs[2]).toBe(5)
    expect(lastArgs[3]).toBe(10)
  })

  it('batch get returns merged response with progress', async () => {
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
        'batches:list': () => [{ id: 'batch-1', name: 'Test Batch', status: 'running' }],
        'batches:getStatus': () => ({ status: 'in_progress', pendingItems: 5, completedItems: 10 }),
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'batch', 'get', 'batch-1',
    ])
    expect(r.exitCode).toBe(0)
    expect(r.envelope?.ok).toBe(true)
    const data = r.envelope?.data as Record<string, unknown>
    expect(data.id).toBe('batch-1')
    expect(data.name).toBe('Test Batch')
    expect(data.progress).toEqual({ status: 'in_progress', pendingItems: 5, completedItems: 10 })
    expect(server.requests.find((req) => req.channel === 'batches:getStatus')).toBeDefined()
  })

  it('batch status returns USAGE_ERROR', async () => {
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'batch', 'status', 'batch-1',
    ])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
  })

  it('label get returns merged response with autoRules', async () => {
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
        'labels:list': () => [{ id: 'lbl-1', name: 'TODO', color: 'blue' }],
        'labels:autoRuleList': () => [{ pattern: '\\bBUG\\b', flags: 'gi' }],
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'label', 'get', 'lbl-1',
    ])
    expect(r.exitCode).toBe(0)
    expect(r.envelope?.ok).toBe(true)
    const data = r.envelope?.data as Record<string, unknown>
    expect(data.id).toBe('lbl-1')
    expect(data.name).toBe('TODO')
    expect(data.autoRules).toEqual([{ pattern: '\\bBUG\\b', flags: 'gi' }])
    expect(server.requests.find((req) => req.channel === 'labels:autoRuleList')).toBeDefined()
  })

  it('label auto-rule-list returns USAGE_ERROR', async () => {
    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1' }],
        'window:switchWorkspace': () => undefined,
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'label', 'auto-rule-list', 'lbl-1',
    ])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
  })

  it('session set-model returns USAGE_ERROR', async () => {
    const r = await runCli(['--json', 'session', 'set-model', 'sess-1', 'gpt-4'])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
  })

  it('session get-files returns USAGE_ERROR', async () => {
    const r = await runCli(['--json', 'session', 'get-files', 'sess-1'])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
  })

  it('label auto-rule-clear returns USAGE_ERROR', async () => {
    const r = await runCli(['--json', 'label', 'auto-rule-clear', 'lbl-1'])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
  })

  it('automation replay returns USAGE_ERROR', async () => {
    const r = await runCli(['--json', 'automation', 'replay', 'abc123'])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
    expect(r.envelope?.error?.message).toContain('Unknown automation action: replay')
  })

  it('batch state returns USAGE_ERROR', async () => {
    const r = await runCli(['--json', 'batch', 'state', 'abc123'])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
    expect(r.envelope?.error?.message).toContain('Unknown batch action: state')
  })

  it('batch test-result returns USAGE_ERROR', async () => {
    const r = await runCli(['--json', 'batch', 'test-result', 'abc123'])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
    expect(r.envelope?.error?.message).toContain('Unknown batch action: test-result')
  })

  it('batch validate returns USAGE_ERROR', async () => {
    const r = await runCli(['--json', 'batch', 'validate'])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
    expect(r.envelope?.error?.message).toContain('Unknown batch action: validate')
  })

  it('automation validate returns USAGE_ERROR', async () => {
    const r = await runCli(['--json', 'automation', 'validate'])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
    expect(r.envelope?.error?.message).toContain('Unknown automation action: validate')
  })

  it('skill validate returns USAGE_ERROR', async () => {
    const r = await runCli(['--json', 'skill', 'validate', 'some-slug'])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
    expect(r.envelope?.error?.message).toContain('Unknown skill action: validate')
  })

  it('source validate returns USAGE_ERROR', async () => {
    const r = await runCli(['--json', 'source', 'validate', 'some-slug'])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
    expect(r.envelope?.error?.message).toContain('Unknown source action: validate')
  })
})
