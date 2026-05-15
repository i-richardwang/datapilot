/**
 * Help system tests — covers spec consistency (in-process) and the
 * three --help levels (CLI integration via subprocess).
 *
 * The integration tests spawn the CLI directly without a mock server
 * because the help path exits before any RPC connect attempt.
 */

import { describe, it, expect } from 'bun:test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { listEntities, getEntitySpec, getActionSpec } from './help.ts'

const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..')
const CLI_ENTRY = join(REPO_ROOT, 'apps/cli/src/datapilot.ts')

interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
  envelope: { ok: boolean; data?: unknown; error?: { code: string; message: string; suggestion?: string } } | null
}

async function runCli(args: string[]): Promise<RunResult> {
  return await new Promise<RunResult>((resolve) => {
    const proc = spawn('bun', ['run', CLI_ENTRY, ...args, '--json'], {
      env: { ...process.env, DATAPILOT_CLI_JSON_ONLY: '1' },
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

describe('spec consistency', () => {
  it('registry covers all 9 entities', () => {
    const entities = listEntities()
    expect(entities.length).toBe(9)
    const names = entities.map((e) => e.name).sort()
    expect(names).toEqual([
      'automation', 'batch', 'label', 'preference',
      'session', 'skill', 'source', 'status', 'workspace',
    ])
  })

  it('every action has required fields', () => {
    for (const e of listEntities()) {
      expect(e.name).toBeTruthy()
      expect(e.description).toBeTruthy()
      expect(e.actions.length).toBeGreaterThan(0)
      for (const a of e.actions) {
        expect(a.name).toBeTruthy()
        expect(a.description).toBeTruthy()
        expect(a.example).toContain(`datapilot ${e.name} ${a.name}`)
        // Required positionals come before optional ones.
        const positionals = a.positionals ?? []
        const firstOptional = positionals.findIndex((p) => p.required === false)
        if (firstOptional !== -1) {
          for (let i = firstOptional + 1; i < positionals.length; i++) {
            // Variadic-tail positionals (like `send`'s message) are allowed
            // after an optional positional only if they themselves are
            // optional.
            expect(positionals[i]!.required === false).toBe(true)
          }
        }
      }
    }
  })

  it('action names are unique within each entity', () => {
    for (const e of listEntities()) {
      const names = e.actions.map((a) => a.name)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('renames keys are NOT in the flag whitelist (they are flat-flag mistakes the user might try)', () => {
    // `renames` maps an invalid flat flag (e.g. `--mode`) to the JSON key it
    // should go under (`permissionMode`). If a rename key is in the flag
    // whitelist, the rename hint never fires.
    for (const e of listEntities()) {
      for (const a of e.actions) {
        if (!a.renames) continue
        const flagNames = new Set(a.flags.map((f) => f.name))
        for (const [flatKey, jsonKey] of Object.entries(a.renames)) {
          expect(flagNames.has(flatKey)).toBe(false)
          expect(typeof jsonKey).toBe('string')
          expect(jsonKey.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('lookup helpers find what the registry contains', () => {
    expect(getEntitySpec('batch')?.name).toBe('batch')
    expect(getEntitySpec('nope')).toBeUndefined()
    expect(getActionSpec('batch', 'create')?.name).toBe('create')
    expect(getActionSpec('batch', 'nope')).toBeUndefined()
    expect(getActionSpec('nope', 'create')).toBeUndefined()
  })
})

describe('CLI --help integration', () => {
  it('top-level --help returns entity list with descriptions', async () => {
    const r = await runCli(['--help'])
    expect(r.exitCode).toBe(0)
    expect(r.envelope?.ok).toBe(true)
    const data = r.envelope?.data as { entities: Array<{ name: string; description: string }> }
    const names = data.entities.map((e) => e.name)
    expect(names).toContain('batch')
    expect(names).toContain('label')
    expect(names.length).toBe(9)
    for (const e of data.entities) {
      expect(e.description).toBeTruthy()
    }
  })

  it('bare invocation (no args) routes to top help', async () => {
    const r = await runCli([])
    expect(r.exitCode).toBe(0)
    const data = r.envelope?.data as { entities?: unknown[] }
    expect(Array.isArray(data.entities)).toBe(true)
  })

  it('entity --help returns action list with descriptions', async () => {
    const r = await runCli(['batch', '--help'])
    expect(r.exitCode).toBe(0)
    expect(r.envelope?.ok).toBe(true)
    const data = r.envelope?.data as { entity: string; actions: Array<{ name: string; description: string }> }
    expect(data.entity).toBe('batch')
    const names = data.actions.map((a) => a.name)
    expect(names).toContain('create')
    expect(names).toContain('start')
    expect(names).toContain('retry-item')
  })

  it('action --help returns usage + flags + example', async () => {
    const r = await runCli(['batch', 'create', '--help'])
    expect(r.exitCode).toBe(0)
    expect(r.envelope?.ok).toBe(true)
    const data = r.envelope?.data as {
      entity: string
      action: string
      usage: string
      flags: Array<{ name: string; required: boolean; type: string }>
      takesInput: boolean
      example: string
    }
    expect(data.entity).toBe('batch')
    expect(data.action).toBe('create')
    expect(data.usage).toContain('datapilot batch create')
    expect(data.flags.find((f) => f.name === 'name')?.required).toBe(true)
    expect(data.takesInput).toBe(true)
    expect(data.example).toContain('datapilot batch create')
  })

  it('action --help on action without input does not advertise --input', async () => {
    const r = await runCli(['batch', 'list', '--help'])
    expect(r.exitCode).toBe(0)
    const data = r.envelope?.data as { takesInput: boolean; flags: unknown[] }
    expect(data.takesInput).toBe(false)
    expect(data.flags).toEqual([])
  })

  it('action --help fails with USAGE_ERROR for unknown action', async () => {
    const r = await runCli(['batch', 'nonexistent', '--help'])
    expect(r.exitCode).toBe(2)
    expect(r.envelope?.ok).toBe(false)
    expect(r.envelope?.error?.code).toBe('USAGE_ERROR')
    expect(r.envelope?.error?.suggestion).toContain('Valid actions')
  })

  it('-h is equivalent to --help at the action level', async () => {
    const r = await runCli(['batch', 'create', '-h'])
    expect(r.exitCode).toBe(0)
    const data = r.envelope?.data as { action: string }
    expect(data.action).toBe('create')
  })
})
