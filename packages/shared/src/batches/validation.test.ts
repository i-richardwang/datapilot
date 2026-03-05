import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateBatchesContent, validateBatches } from './validation.ts'

describe('validateBatchesContent', () => {
  it('should accept a valid config', () => {
    const json = JSON.stringify({
      version: 1,
      batches: [{
        id: 'test',
        name: 'Test Batch',
        source: { type: 'json', path: 'data.json', idField: 'id' },
        action: { type: 'prompt', prompt: 'Analyze $BATCH_ITEM_NAME' },
      }],
    })
    const result = validateBatchesContent(json)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should accept an empty batches array with warning', () => {
    const json = JSON.stringify({ batches: [] })
    const result = validateBatchesContent(json)
    expect(result.valid).toBe(true)
    expect(result.warnings.some(w => w.message.includes('No batches configured'))).toBe(true)
  })

  it('should reject invalid JSON', () => {
    const result = validateBatchesContent('not json{')
    expect(result.valid).toBe(false)
    expect(result.errors[0]?.message).toContain('Invalid JSON')
  })

  it('should reject missing batches key', () => {
    const result = validateBatchesContent(JSON.stringify({}))
    expect(result.valid).toBe(false)
  })

  it('should reject batch without name', () => {
    const json = JSON.stringify({
      batches: [{
        source: { type: 'json', path: 'data.json', idField: 'id' },
        action: { type: 'prompt', prompt: 'test' },
      }],
    })
    const result = validateBatchesContent(json)
    expect(result.valid).toBe(false)
  })

  it('should reject empty source path', () => {
    const json = JSON.stringify({
      batches: [{
        name: 'Test',
        source: { type: 'json', path: '', idField: 'id' },
        action: { type: 'prompt', prompt: 'test' },
      }],
    })
    const result = validateBatchesContent(json)
    expect(result.valid).toBe(false)
  })

  it('should reject invalid source type', () => {
    const json = JSON.stringify({
      batches: [{
        name: 'Test',
        source: { type: 'xml', path: 'data.xml', idField: 'id' },
        action: { type: 'prompt', prompt: 'test' },
      }],
    })
    const result = validateBatchesContent(json)
    expect(result.valid).toBe(false)
  })

  it('should reject empty prompt', () => {
    const json = JSON.stringify({
      batches: [{
        name: 'Test',
        source: { type: 'json', path: 'data.json', idField: 'id' },
        action: { type: 'prompt', prompt: '' },
      }],
    })
    const result = validateBatchesContent(json)
    expect(result.valid).toBe(false)
  })

  it('should warn about allow-all permission mode', () => {
    const json = JSON.stringify({
      batches: [{
        name: 'Test',
        source: { type: 'json', path: 'data.json', idField: 'id' },
        execution: { permissionMode: 'allow-all' },
        action: { type: 'prompt', prompt: 'test' },
      }],
    })
    const result = validateBatchesContent(json)
    expect(result.valid).toBe(true)
    expect(result.warnings.some(w => w.message.includes('allow-all'))).toBe(true)
  })

  it('should reject maxConcurrency out of range', () => {
    const json = JSON.stringify({
      batches: [{
        name: 'Test',
        source: { type: 'json', path: 'data.json', idField: 'id' },
        execution: { maxConcurrency: 100 },
        action: { type: 'prompt', prompt: 'test' },
      }],
    })
    const result = validateBatchesContent(json)
    expect(result.valid).toBe(false)
  })

  it('should accept valid execution config', () => {
    const json = JSON.stringify({
      batches: [{
        name: 'Test',
        source: { type: 'csv', path: 'data.csv', idField: 'id' },
        execution: { maxConcurrency: 5, retryOnFailure: true, maxRetries: 3, permissionMode: 'ask' },
        action: { type: 'prompt', prompt: 'test $BATCH_ITEM_ID', labels: ['batch'] },
      }],
    })
    const result = validateBatchesContent(json)
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  it('should accept valid output config', () => {
    const json = JSON.stringify({
      batches: [{
        name: 'Test',
        source: { type: 'json', path: 'data.json', idField: 'id' },
        action: { type: 'prompt', prompt: 'test' },
        output: {
          path: 'output/results.jsonl',
          schema: {
            type: 'object',
            properties: { summary: { type: 'string' }, score: { type: 'number' } },
            required: ['summary'],
          },
        },
      }],
    })
    const result = validateBatchesContent(json)
    expect(result.valid).toBe(true)
  })

  it('should warn about non-.jsonl output path', () => {
    const json = JSON.stringify({
      batches: [{
        name: 'Test',
        source: { type: 'json', path: 'data.json', idField: 'id' },
        action: { type: 'prompt', prompt: 'test' },
        output: { path: 'output/results.json' },
      }],
    })
    const result = validateBatchesContent(json)
    expect(result.valid).toBe(true)
    expect(result.warnings.some(w => w.message.includes('.jsonl'))).toBe(true)
  })

  it('should warn about empty output schema properties', () => {
    const json = JSON.stringify({
      batches: [{
        name: 'Test',
        source: { type: 'json', path: 'data.json', idField: 'id' },
        action: { type: 'prompt', prompt: 'test' },
        output: {
          path: 'output/results.jsonl',
          schema: { type: 'object', properties: {} },
        },
      }],
    })
    const result = validateBatchesContent(json)
    expect(result.valid).toBe(true)
    expect(result.warnings.some(w => w.message.includes('no properties'))).toBe(true)
  })
})

describe('validateBatches', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'batch-validate-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('should return valid when no config exists', () => {
    const result = validateBatches(tempDir)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should validate config from disk', () => {
    writeFileSync(join(tempDir, 'data.json'), JSON.stringify([{ id: '1', name: 'Test' }]))
    writeFileSync(join(tempDir, 'batches.json'), JSON.stringify({
      batches: [{
        name: 'Test',
        source: { type: 'json', path: 'data.json', idField: 'id' },
        action: { type: 'prompt', prompt: 'test' },
      }],
    }))
    const result = validateBatches(tempDir)
    expect(result.valid).toBe(true)
  })

  it('should reject invalid JSON on disk', () => {
    writeFileSync(join(tempDir, 'batches.json'), 'not json')
    const result = validateBatches(tempDir)
    expect(result.valid).toBe(false)
    expect(result.errors[0]?.message).toContain('Invalid JSON')
  })

  it('should warn when data source file is missing', () => {
    writeFileSync(join(tempDir, 'batches.json'), JSON.stringify({
      batches: [{
        name: 'Test',
        source: { type: 'json', path: 'missing.json', idField: 'id' },
        action: { type: 'prompt', prompt: 'test' },
      }],
    }))
    const result = validateBatches(tempDir)
    expect(result.valid).toBe(true)
    expect(result.warnings.some(w => w.message.includes('not found'))).toBe(true)
  })

  it('should not warn when data source file exists', () => {
    writeFileSync(join(tempDir, 'data.csv'), 'id,name\n1,Test')
    writeFileSync(join(tempDir, 'batches.json'), JSON.stringify({
      batches: [{
        name: 'Test',
        source: { type: 'csv', path: 'data.csv', idField: 'id' },
        action: { type: 'prompt', prompt: 'test' },
      }],
    }))
    const result = validateBatches(tempDir)
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })
})
