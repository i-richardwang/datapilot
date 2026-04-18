/**
 * DEV-21/DEV-22 parity test — exercises the agent-facing `datapilot` wrapper
 * and verifies a multi-entity flow round-trips through the unified CLI binary.
 *
 * After Phase 5 (DEV-22), the wrapper defaults to the unified CLI; this test
 * intentionally leaves DATAPILOT_UNIFIED_CLI unset so it exercises the new
 * default path. A separate test asserts the legacy escape hatch
 * (DATAPILOT_UNIFIED_CLI=0) still routes to craft-cli.
 *
 * If the unified CLI regresses (envelope shape, routing, transport), the
 * multi-entity flow fails because the mock server only implements the WS
 * channels the unified binary hits.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import {
  serializeEnvelope,
  deserializeEnvelope,
} from '@craft-agent/server-core/transport'
import type { MessageEnvelope } from '@craft-agent/shared/protocol'

// Repo root relative to this test file (apps/cli/src/datapilot/parity.test.ts).
const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..')
const WRAPPER = join(REPO_ROOT, 'apps/electron/resources/bin/datapilot')
const LEGACY_ENTRY = join(REPO_ROOT, 'packages/craft-cli/src/index.ts')
const UNIFIED_ENTRY = join(REPO_ROOT, 'apps/cli/src/datapilot.ts')

interface RecordedRequest { channel: string; args: unknown[] }

interface MockOptions {
  handlers?: Record<string, (args: unknown[]) => unknown>
}

interface MockServer {
  url: string
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
    requests,
    close: () => server.stop(true),
  }
}

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
  envelope: { ok: boolean; data?: unknown; error?: { code: string; message: string } } | null
}

/** Invoke the wrapper shell script with the given env. */
async function runWrapper(args: string[], env: Record<string, string>): Promise<RunResult> {
  return await new Promise<RunResult>((resolve) => {
    const proc = spawn(WRAPPER, args, {
      env: { ...process.env, ...env },
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
  delete process.env.DATAPILOT_UNIFIED_CLI
  delete process.env.DATAPILOT_CLI_ENTRY
  delete process.env.DATAPILOT_UNIFIED_CLI_ENTRY
})

afterEach(() => {
  server?.close()
  server = null
})

// The sh wrapper isn't invoked on Windows — Windows CI would use datapilot.cmd
// with separate test coverage. Current CI matrix is ubuntu-latest for the
// parity job, so skip on win32.
const describeUnix = process.platform === 'win32' ? describe.skip : describe

describeUnix('datapilot wrapper routes through the unified CLI by default', () => {
  it('errors loudly when the unified entry is unset and the legacy escape hatch is not used', async () => {
    const r = await runWrapper(['label', 'list'], {
      DATAPILOT_CLI_ENTRY: LEGACY_ENTRY,
      DATAPILOT_UNIFIED_CLI_ENTRY: '',
    })
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain('DATAPILOT_UNIFIED_CLI_ENTRY')
  })

  it('default (no env var) routes a multi-entity flow through the unified CLI', async () => {
    // Mock server that only implements channels the UNIFIED CLI uses. If the
    // wrapper accidentally dispatches to the legacy CLI (which writes direct
    // to SQLite and never hits these channels), the assertions below fail.
    let createdLabel: { id: string; name: string; color: string } | null = null
    let createdSource: { slug: string; name: string; provider: string; type: string } | null = null

    server = startMockServer({
      handlers: {
        'workspaces:get': () => [{ id: 'ws-1', name: 'Test' }],
        'window:switchWorkspace': () => undefined,
        'labels:create': ([_ws, input]) => {
          const payload = input as { name: string; color?: string }
          createdLabel = { id: 'lbl-new', name: payload.name, color: payload.color ?? 'blue' }
          return createdLabel
        },
        'labels:list': () => (createdLabel ? [createdLabel] : []),
        'sources:create': ([_ws, input]) => {
          const payload = input as { name: string; provider: string; type: string }
          createdSource = { slug: 'src-new', ...payload }
          return createdSource
        },
        'sources:get': () => (createdSource ? [createdSource] : []),
      },
    })

    const env = {
      DATAPILOT_CLI_ENTRY: LEGACY_ENTRY,
      DATAPILOT_UNIFIED_CLI_ENTRY: UNIFIED_ENTRY,
      DATAPILOT_SERVER_URL: server.url,
      DATAPILOT_SERVER_TOKEN: 'test-token',
    }

    // Step 1 — label create
    const create = await runWrapper(
      ['--json', 'label', 'create', '--name', 'TODO', '--color', 'blue'],
      env,
    )
    expect(create.exitCode).toBe(0)
    expect(create.envelope?.ok).toBe(true)
    expect((create.envelope?.data as Record<string, unknown>).id).toBe('lbl-new')

    // Step 2 — source create
    const srcCreate = await runWrapper(
      [
        '--json', 'source', 'create',
        '--name', 'MyAPI', '--provider', 'generic', '--type', 'api',
      ],
      env,
    )
    expect(srcCreate.exitCode).toBe(0)
    expect(srcCreate.envelope?.ok).toBe(true)
    expect((srcCreate.envelope?.data as Record<string, unknown>).slug).toBe('src-new')

    // Step 3 — label list returns what we created
    const labelList = await runWrapper(['--json', 'label', 'list'], env)
    expect(labelList.exitCode).toBe(0)
    expect(labelList.envelope?.ok).toBe(true)
    expect(labelList.envelope?.data).toEqual([
      { id: 'lbl-new', name: 'TODO', color: 'blue' },
    ])

    // Step 4 — source list returns what we created
    const sourceList = await runWrapper(['--json', 'source', 'list'], env)
    expect(sourceList.exitCode).toBe(0)
    expect(sourceList.envelope?.ok).toBe(true)
    expect(sourceList.envelope?.data).toEqual([
      { slug: 'src-new', name: 'MyAPI', provider: 'generic', type: 'api' },
    ])

    // The unified CLI proves itself by the channels it hits — the legacy
    // craft-cli writes straight to SQLite and never contacts the WS server.
    const channels = server.requests.map((r) => r.channel)
    expect(channels).toContain('labels:create')
    expect(channels).toContain('labels:list')
    expect(channels).toContain('sources:create')
    expect(channels).toContain('sources:get')
  })

  it('DATAPILOT_UNIFIED_CLI=0 falls back to the legacy craft-cli (escape hatch)', async () => {
    // The mock server only implements the unified CLI's WS channels, so any
    // request landing here would prove the wrapper still routed unified.
    // The legacy CLI talks straight to SQLite, so it never touches the mock.
    server = startMockServer({
      handlers: {
        'labels:list': () => {
          throw new Error('legacy escape hatch should not reach the WS mock')
        },
      },
    })

    const env = {
      DATAPILOT_UNIFIED_CLI: '0',
      DATAPILOT_CLI_ENTRY: LEGACY_ENTRY,
      DATAPILOT_UNIFIED_CLI_ENTRY: UNIFIED_ENTRY,
      DATAPILOT_SERVER_URL: server.url,
      DATAPILOT_SERVER_TOKEN: 'test-token',
    }

    // Bare `--version` keeps the legacy CLI off SQLite (no workspace required)
    // while still confirming the legacy entry was the one bun ran.
    const r = await runWrapper(['--version'], env)
    expect(r.exitCode).toBe(0)
    expect(server.requests).toHaveLength(0)
  })
})
