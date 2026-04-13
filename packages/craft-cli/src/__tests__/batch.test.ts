import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const CLI_ENTRY = join(import.meta.dir, '..', 'index.ts')

let tempDir: string | null = null

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

describe('datapilot batch CLI', () => {
  it('lists batches without requiring pre-registered SQLite driver', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'datapilot-craft-cli-batch-'))

    writeFileSync(
      join(tempDir, 'batches.json'),
      JSON.stringify({
        batches: [
          {
            id: 'abc123',
            name: 'Test batch',
            source: { type: 'csv', path: 'data.csv', idField: 'id' },
            action: { type: 'prompt', prompt: 'Summarize this row' },
          },
        ],
      }, null, 2) + '\n',
      'utf-8',
    )

    const run = Bun.spawnSync([
      process.execPath,
      CLI_ENTRY,
      'batch',
      'list',
      '--workspace-root',
      tempDir,
    ], {
      env: process.env,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdout = run.stdout.toString()
    const stderr = run.stderr.toString()

    expect(run.exitCode, `stderr:\n${stderr}\nstdout:\n${stdout}`).toBe(0)
    expect(stderr).toBe('')
    expect(stdout).not.toContain('SQLite driver not registered')

    const output = JSON.parse(stdout) as {
      ok: boolean
      data: Array<{
        id: string
        name: string
        enabled: boolean
        status: string
        total: number
        completed: number
        failed: number
      }>
      warnings: string[]
    }

    expect(output.ok).toBe(true)
    expect(output.warnings).toEqual([])
    expect(output.data).toEqual([
      {
        id: 'abc123',
        name: 'Test batch',
        enabled: true,
        status: 'not started',
        total: 0,
        completed: 0,
        failed: 0,
      },
    ])
  })
})
