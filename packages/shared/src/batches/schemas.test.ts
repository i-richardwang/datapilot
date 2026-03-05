import { describe, it, expect } from 'bun:test'
import {
  BatchSourceSchema,
  BatchExecutionSchema,
  BatchPromptActionSchema,
  BatchOutputConfigSchema,
  BatchConfigSchema,
  BatchesFileConfigSchema,
  zodErrorToIssues,
} from './schemas.ts'

describe('BatchSourceSchema', () => {
  it('should accept valid source', () => {
    const result = BatchSourceSchema.safeParse({ type: 'csv', path: 'data.csv', idField: 'id' })
    expect(result.success).toBe(true)
  })

  it('should reject invalid source type', () => {
    const result = BatchSourceSchema.safeParse({ type: 'xml', path: 'data.xml', idField: 'id' })
    expect(result.success).toBe(false)
  })

  it('should reject empty path', () => {
    const result = BatchSourceSchema.safeParse({ type: 'csv', path: '', idField: 'id' })
    expect(result.success).toBe(false)
  })

  it('should reject empty idField', () => {
    const result = BatchSourceSchema.safeParse({ type: 'csv', path: 'data.csv', idField: '' })
    expect(result.success).toBe(false)
  })
})

describe('BatchExecutionSchema', () => {
  it('should accept valid execution config', () => {
    const result = BatchExecutionSchema.safeParse({
      maxConcurrency: 5,
      retryOnFailure: true,
      maxRetries: 3,
      permissionMode: 'safe',
    })
    expect(result.success).toBe(true)
  })

  it('should accept empty object (all optional)', () => {
    const result = BatchExecutionSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('should reject maxConcurrency < 1', () => {
    const result = BatchExecutionSchema.safeParse({ maxConcurrency: 0 })
    expect(result.success).toBe(false)
  })

  it('should reject maxConcurrency > 50', () => {
    const result = BatchExecutionSchema.safeParse({ maxConcurrency: 51 })
    expect(result.success).toBe(false)
  })

  it('should reject invalid permissionMode', () => {
    const result = BatchExecutionSchema.safeParse({ permissionMode: 'yolo' })
    expect(result.success).toBe(false)
  })
})

describe('BatchPromptActionSchema', () => {
  it('should accept valid action', () => {
    const result = BatchPromptActionSchema.safeParse({
      type: 'prompt',
      prompt: 'Analyze $BATCH_ITEM_NAME',
      labels: ['batch'],
      mentions: ['linear'],
    })
    expect(result.success).toBe(true)
  })

  it('should reject empty prompt', () => {
    const result = BatchPromptActionSchema.safeParse({ type: 'prompt', prompt: '' })
    expect(result.success).toBe(false)
  })
})

describe('BatchOutputConfigSchema', () => {
  it('should accept valid output config', () => {
    const result = BatchOutputConfigSchema.safeParse({
      path: 'output/results.jsonl',
      schema: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          score: { type: 'number' },
        },
        required: ['summary'],
      },
    })
    expect(result.success).toBe(true)
  })

  it('should accept output without schema', () => {
    const result = BatchOutputConfigSchema.safeParse({
      path: 'output/results.jsonl',
    })
    expect(result.success).toBe(true)
  })

  it('should reject empty path', () => {
    const result = BatchOutputConfigSchema.safeParse({ path: '' })
    expect(result.success).toBe(false)
  })

  it('should reject schema with wrong type', () => {
    const result = BatchOutputConfigSchema.safeParse({
      path: 'output.jsonl',
      schema: {
        type: 'array',
        properties: {},
      },
    })
    expect(result.success).toBe(false)
  })
})

describe('BatchConfigSchema', () => {
  it('should accept valid batch config', () => {
    const result = BatchConfigSchema.safeParse({
      name: 'My Batch',
      source: { type: 'json', path: 'data.json', idField: 'id' },
      action: { type: 'prompt', prompt: 'test' },
    })
    expect(result.success).toBe(true)
  })

  it('should accept optional id', () => {
    const result = BatchConfigSchema.safeParse({
      id: 'abc123',
      name: 'My Batch',
      source: { type: 'json', path: 'data.json', idField: 'id' },
      action: { type: 'prompt', prompt: 'test' },
    })
    expect(result.success).toBe(true)
  })

  it('should reject missing name', () => {
    const result = BatchConfigSchema.safeParse({
      source: { type: 'json', path: 'data.json', idField: 'id' },
      action: { type: 'prompt', prompt: 'test' },
    })
    expect(result.success).toBe(false)
  })

  it('should accept batch config with output', () => {
    const result = BatchConfigSchema.safeParse({
      name: 'My Batch',
      source: { type: 'json', path: 'data.json', idField: 'id' },
      action: { type: 'prompt', prompt: 'test' },
      output: {
        path: 'output/results.jsonl',
        schema: {
          type: 'object',
          properties: { summary: { type: 'string' } },
          required: ['summary'],
        },
      },
    })
    expect(result.success).toBe(true)
  })
})

describe('BatchesFileConfigSchema', () => {
  it('should accept valid config file', () => {
    const result = BatchesFileConfigSchema.safeParse({
      version: 1,
      batches: [
        {
          id: 'batch1',
          name: 'Batch 1',
          source: { type: 'csv', path: 'data.csv', idField: 'id' },
          action: { type: 'prompt', prompt: 'test' },
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('should accept empty batches array', () => {
    const result = BatchesFileConfigSchema.safeParse({ batches: [] })
    expect(result.success).toBe(true)
  })

  it('should reject missing batches', () => {
    const result = BatchesFileConfigSchema.safeParse({ version: 1 })
    expect(result.success).toBe(false)
  })
})

describe('zodErrorToIssues', () => {
  it('should convert Zod errors to ValidationIssues', () => {
    const result = BatchConfigSchema.safeParse({ source: {} })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issues = zodErrorToIssues(result.error, 'batches.json')
      expect(issues.length).toBeGreaterThan(0)
      expect(issues[0]!.file).toBe('batches.json')
      expect(issues[0]!.severity).toBe('error')
    }
  })
})
