/**
 * Unit tests for buildItemSummary — the per-item label rendered in the
 * batch items timeline. Pure function, no I/O.
 */

import { describe, it, expect } from 'bun:test'
import { buildItemSummary } from './batch-processor.ts'
import type { BatchItem } from './types.ts'

const PROMPT_PREFIX = 'a'.repeat(150)

describe('buildItemSummary', () => {
  it('renders first 3 non-id fields as key=value pairs', () => {
    const item: BatchItem = {
      id: '1',
      fields: { tag_id: '1', domain: 'school', tag_name: '清北', disambiguation: '' },
    }
    expect(buildItemSummary(item, 'tag_id', PROMPT_PREFIX))
      .toBe('domain=school · tag_name=清北')
  })

  it('skips the idField and empty values, caps at 3 fields', () => {
    const item: BatchItem = {
      id: 'emp-1',
      fields: {
        emp_id: 'emp-1',
        name: 'Alice',
        title: 'Engineer',
        department: 'Data',
        notes: '',
        location: 'SF',
      },
    }
    // emp_id skipped (idField), notes skipped (empty), then first 3 of remainder
    expect(buildItemSummary(item, 'emp_id', PROMPT_PREFIX))
      .toBe('name=Alice · title=Engineer · department=Data')
  })

  it('truncates long values at 40 chars with ellipsis and collapses whitespace', () => {
    const item: BatchItem = {
      id: '1',
      fields: {
        id: '1',
        description: 'a'.repeat(60),
        notes: 'line1\n\n  line2   line3',
      },
    }
    const summary = buildItemSummary(item, 'id', PROMPT_PREFIX)
    expect(summary).toContain(`description=${'a'.repeat(40)}…`)
    expect(summary).toContain('notes=line1 line2 line3')
  })

  it('falls back to truncated prompt when only idField has a value', () => {
    const item: BatchItem = {
      id: '1',
      fields: { id: '1', a: '', b: '   ' },
    }
    const summary = buildItemSummary(item, 'id', PROMPT_PREFIX)
    expect(summary).toBe(`${'a'.repeat(100)}…`)
  })
})
