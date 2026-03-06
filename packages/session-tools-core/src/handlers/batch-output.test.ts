import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { handleBatchOutput } from './batch-output.ts'
import type { SessionToolContext, BatchContext } from '../context.ts'

/**
 * Create a minimal SessionToolContext stub for testing.
 */
function createTestContext(batchContext?: BatchContext): SessionToolContext {
  return {
    sessionId: 'test-session',
    workspacePath: '/tmp/test-workspace',
    get sourcesPath() { return join(this.workspacePath, 'sources') },
    get skillsPath() { return join(this.workspacePath, 'skills') },
    plansFolderPath: '/tmp/test-workspace/plans',
    callbacks: {
      onPlanSubmitted: () => {},
      onAuthRequest: () => {},
    },
    fs: {
      exists: (p: string) => existsSync(p),
      readFile: (p: string) => readFileSync(p, 'utf-8'),
      readFileBuffer: (p: string) => readFileSync(p),
      writeFile: () => {},
      isDirectory: () => false,
      readdir: () => [],
      stat: () => ({ size: 0, isDirectory: () => false }),
    },
    loadSourceConfig: () => null,
    batchContext,
  }
}

describe('handleBatchOutput', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'batch-output-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should reject when not in a batch session', async () => {
    const ctx = createTestContext(undefined)
    const result = await handleBatchOutput(ctx, { data: { summary: 'test' } })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('batch session')
  })

  it('should write JSONL output with metadata', async () => {
    const outputPath = join(tempDir, 'output.jsonl')
    const ctx = createTestContext({
      batchId: 'batch-1',
      itemId: 'item-42',
      outputPath,
    })

    const result = await handleBatchOutput(ctx, {
      data: { summary: 'High value user', score: 95 },
    })

    expect(result.isError).toBeFalsy()
    expect(result.content[0]!.text).toContain('item-42')

    // Verify JSONL output
    const content = readFileSync(outputPath, 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(1)

    const record = JSON.parse(lines[0]!)
    expect(record._item_id).toBe('item-42')
    expect(record._timestamp).toBeDefined()
    expect(record.summary).toBe('High value user')
    expect(record.score).toBe(95)
  })

  it('should append multiple records to same file', async () => {
    const outputPath = join(tempDir, 'output.jsonl')
    const ctx1 = createTestContext({
      batchId: 'batch-1',
      itemId: 'item-1',
      outputPath,
    })
    const ctx2 = createTestContext({
      batchId: 'batch-1',
      itemId: 'item-2',
      outputPath,
    })

    await handleBatchOutput(ctx1, { data: { value: 'first' } })
    await handleBatchOutput(ctx2, { data: { value: 'second' } })

    const lines = readFileSync(outputPath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!)._item_id).toBe('item-1')
    expect(JSON.parse(lines[1]!)._item_id).toBe('item-2')
  })

  it('should create output directory if it does not exist', async () => {
    const outputPath = join(tempDir, 'nested', 'dir', 'output.jsonl')
    const ctx = createTestContext({
      batchId: 'batch-1',
      itemId: 'item-1',
      outputPath,
    })

    const result = await handleBatchOutput(ctx, { data: { test: true } })
    expect(result.isError).toBeFalsy()
    expect(existsSync(outputPath)).toBe(true)
  })

  it('should validate against schema and reject missing required fields', async () => {
    const outputPath = join(tempDir, 'output.jsonl')
    const ctx = createTestContext({
      batchId: 'batch-1',
      itemId: 'item-1',
      outputPath,
      outputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          score: { type: 'number' },
        },
        required: ['summary', 'score'],
      },
    })

    // Missing 'score' field
    const result = await handleBatchOutput(ctx, {
      data: { summary: 'test' },
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('score')
  })

  it('should validate type constraints', async () => {
    const outputPath = join(tempDir, 'output.jsonl')
    const ctx = createTestContext({
      batchId: 'batch-1',
      itemId: 'item-1',
      outputPath,
      outputSchema: {
        type: 'object',
        properties: {
          score: { type: 'number' },
        },
      },
    })

    const result = await handleBatchOutput(ctx, {
      data: { score: 'not a number' },
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('number')
  })

  it('should validate enum constraints', async () => {
    const outputPath = join(tempDir, 'output.jsonl')
    const ctx = createTestContext({
      batchId: 'batch-1',
      itemId: 'item-1',
      outputPath,
      outputSchema: {
        type: 'object',
        properties: {
          risk: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
    })

    const result = await handleBatchOutput(ctx, {
      data: { risk: 'extreme' },
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('one of')
  })

  it('should pass validation with valid data and schema', async () => {
    const outputPath = join(tempDir, 'output.jsonl')
    const ctx = createTestContext({
      batchId: 'batch-1',
      itemId: 'item-1',
      outputPath,
      outputSchema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          risk: { type: 'string', enum: ['low', 'medium', 'high'] },
          score: { type: 'number' },
        },
        required: ['summary', 'risk'],
      },
    })

    const result = await handleBatchOutput(ctx, {
      data: { summary: 'All good', risk: 'low', score: 95 },
    })
    expect(result.isError).toBeFalsy()
  })

  it('should coerce a JSON-encoded string to an object', async () => {
    const outputPath = join(tempDir, 'output.jsonl')
    const ctx = createTestContext({
      batchId: 'batch-1',
      itemId: 'item-1',
      outputPath,
    })

    const result = await handleBatchOutput(ctx, {
      data: '{"summary": "parsed from string", "score": 88}',
    })
    expect(result.isError).toBeFalsy()

    const record = JSON.parse(readFileSync(outputPath, 'utf-8').trim())
    expect(record.summary).toBe('parsed from string')
    expect(record.score).toBe(88)
  })

  it('should return parse error details for malformed JSON strings', async () => {
    const outputPath = join(tempDir, 'output.jsonl')
    const ctx = createTestContext({
      batchId: 'batch-1',
      itemId: 'item-1',
      outputPath,
    })

    // Unescaped quotes inside string value
    const malformed = '{"reason": "评论给出"还可以"的评价"}'
    const result = await handleBatchOutput(ctx, { data: malformed })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('malformed JSON')
    expect(result.content[0]!.text).toContain('Parse error')
    expect(result.content[0]!.text).toContain('escaped with backslash')
  })

  it('should reject a non-JSON string', async () => {
    const outputPath = join(tempDir, 'output.jsonl')
    const ctx = createTestContext({
      batchId: 'batch-1',
      itemId: 'item-1',
      outputPath,
    })

    const result = await handleBatchOutput(ctx, {
      data: 'not valid json',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('malformed JSON')
  })

  it('should reject a JSON string that parses to a non-object', async () => {
    const outputPath = join(tempDir, 'output.jsonl')
    const ctx = createTestContext({
      batchId: 'batch-1',
      itemId: 'item-1',
      outputPath,
    })

    const result = await handleBatchOutput(ctx, {
      data: '[1, 2, 3]',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('JSON object')
  })

  it('should accept nullable type with non-null value', async () => {
    const outputPath = join(tempDir, 'output.jsonl')
    const ctx = createTestContext({
      batchId: 'batch-1',
      itemId: 'item-1',
      outputPath,
      outputSchema: {
        type: 'object',
        properties: {
          count: { type: ['number', 'null'] },
          label: { type: 'string' },
        },
        required: ['count', 'label'],
      },
    })

    const result = await handleBatchOutput(ctx, {
      data: { count: 280, label: 'test' },
    })
    expect(result.isError).toBeFalsy()
  })

  it('should accept nullable type with null value', async () => {
    const outputPath = join(tempDir, 'output.jsonl')
    const ctx = createTestContext({
      batchId: 'batch-1',
      itemId: 'item-1',
      outputPath,
      outputSchema: {
        type: 'object',
        properties: {
          count: { type: ['number', 'null'] },
        },
        required: ['count'],
      },
    })

    const result = await handleBatchOutput(ctx, {
      data: { count: null },
    })
    expect(result.isError).toBeFalsy()
  })

  it('should reject null for non-nullable required field', async () => {
    const outputPath = join(tempDir, 'output.jsonl')
    const ctx = createTestContext({
      batchId: 'batch-1',
      itemId: 'item-1',
      outputPath,
      outputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number' },
        },
        required: ['count'],
      },
    })

    const result = await handleBatchOutput(ctx, {
      data: { count: null },
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain('count')
  })

  it('should allow output without schema (freeform)', async () => {
    const outputPath = join(tempDir, 'output.jsonl')
    const ctx = createTestContext({
      batchId: 'batch-1',
      itemId: 'item-1',
      outputPath,
      // No outputSchema
    })

    const result = await handleBatchOutput(ctx, {
      data: { anything: 'goes', nested: { deep: true } },
    })
    expect(result.isError).toBeFalsy()

    const record = JSON.parse(readFileSync(outputPath, 'utf-8').trim())
    expect(record.anything).toBe('goes')
    expect(record.nested).toEqual({ deep: true })
  })
})
