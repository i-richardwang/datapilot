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

  it('routes server health to credentials:healthCheck', async () => {
    server = startMockServer({
      handlers: {
        'credentials:healthCheck': () => ({ status: 'ok' }),
      },
    })
    const r = await runCli([
      '--url', server.url, '--token', 't', '--json',
      'server', 'health',
    ])
    expect(r.exitCode).toBe(0)
    expect(r.envelope?.data).toEqual({ status: 'ok' })
    expect(server.requests.find((req) => req.channel === 'credentials:healthCheck')).toBeDefined()
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
})
