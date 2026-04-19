import { describe, it, expect } from 'bun:test'
import { parseArgs, parseInput, strFlag, intFlag, boolFlag, listFlag, UsageError } from './args.ts'

describe('parseArgs', () => {
  it('parses entity + action without flags', () => {
    const a = parseArgs(['label', 'list'])
    expect(a.entity).toBe('label')
    expect(a.action).toBe('list')
    expect(a.positionals).toEqual([])
    expect(a.global.url).toBeUndefined()
  })

  it('parses positionals', () => {
    const a = parseArgs(['label', 'get', 'lbl-1'])
    expect(a.positionals).toEqual(['lbl-1'])
  })

  it('separates global flags from per-action flags', () => {
    const a = parseArgs(['--url', 'ws://x:1', '--workspace', 'ws-1', 'label', 'create', '--name', 'TODO'])
    expect(a.global.url).toBe('ws://x:1')
    expect(a.global.workspace).toBe('ws-1')
    expect(a.entity).toBe('label')
    expect(a.action).toBe('create')
    expect(strFlag(a.flags, 'name')).toBe('TODO')
  })

  it('treats lone --json as boolean global flag', () => {
    const a = parseArgs(['--json', 'label', 'list'])
    expect(a.global.json).toBe(true)
    expect(a.entity).toBe('label')
  })

  it('handles --human and --version as global booleans', () => {
    expect(parseArgs(['--human', 'label']).global.human).toBe(true)
    expect(parseArgs(['--version']).global.version).toBe(true)
  })

  it('handles -h / -v shortcuts', () => {
    expect(parseArgs(['-h']).global.help).toBe(true)
    expect(parseArgs(['-v']).global.version).toBe(true)
  })

  it('parses --timeout as integer', () => {
    const a = parseArgs(['--timeout', '5000', 'label', 'list'])
    expect(a.global.timeout).toBe(5000)
  })

  it('repeatable flags accumulate into arrays', () => {
    const a = parseArgs(['session', 'create', '--source', 'a', '--source', 'b'])
    expect(listFlag(a.flags, 'source')).toEqual(['a', 'b'])
  })

  it('--input is a per-action flag, not global', () => {
    const a = parseArgs(['label', 'create', '--input', '{"name":"x"}'])
    expect(strFlag(a.flags, 'input')).toBe('{"name":"x"}')
  })

  it('-- ends flag parsing', () => {
    const a = parseArgs(['session', 'send', 'sess-1', '--', '--literal-arg'])
    expect(a.positionals).toEqual(['sess-1', '--literal-arg'])
  })

  it('does NOT apply env vars (resolveEndpoint owns that priority)', () => {
    const prevUrl = process.env.DATAPILOT_SERVER_URL
    const prevToken = process.env.DATAPILOT_SERVER_TOKEN
    process.env.DATAPILOT_SERVER_URL = 'ws://env:1'
    process.env.DATAPILOT_SERVER_TOKEN = 'env-token'
    try {
      const a = parseArgs(['label', 'list'])
      expect(a.global.url).toBeUndefined()
      expect(a.global.token).toBeUndefined()
    } finally {
      if (prevUrl === undefined) delete process.env.DATAPILOT_SERVER_URL
      else process.env.DATAPILOT_SERVER_URL = prevUrl
      if (prevToken === undefined) delete process.env.DATAPILOT_SERVER_TOKEN
      else process.env.DATAPILOT_SERVER_TOKEN = prevToken
    }
  })

  it('intFlag and boolFlag round-trip', () => {
    const a = parseArgs(['label', 'auto-rule-remove', 'lbl', '--index', '2'])
    expect(intFlag(a.flags, 'index')).toBe(2)
    const b = parseArgs(['automation', 'test', 'h-1', '--dry-run'])
    expect(boolFlag(b.flags, 'dry-run')).toBe(true)
  })
})

describe('parseInput', () => {
  it('returns undefined when neither --input nor --stdin is set', async () => {
    const r = await parseInput({})
    expect(r).toBeUndefined()
  })

  it('parses a valid JSON object from --input', async () => {
    const r = await parseInput({ input: '{"name":"x","color":"blue"}' })
    expect(r).toEqual({ name: 'x', color: 'blue' })
  })

  it('throws UsageError on invalid JSON', async () => {
    await expect(parseInput({ input: 'not json' })).rejects.toBeInstanceOf(UsageError)
  })

  it('throws UsageError on JSON that parses to a non-object (number)', async () => {
    await expect(parseInput({ input: '123' })).rejects.toBeInstanceOf(UsageError)
  })

  it('throws UsageError on JSON that parses to a non-object (null)', async () => {
    await expect(parseInput({ input: 'null' })).rejects.toBeInstanceOf(UsageError)
  })

  it('throws UsageError on JSON that parses to a non-object (array)', async () => {
    await expect(parseInput({ input: '[1,2,3]' })).rejects.toBeInstanceOf(UsageError)
  })
})
