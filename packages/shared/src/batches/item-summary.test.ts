/**
 * Unit tests for buildItemSummary — the per-item label rendered in the
 * batch items timeline. Pure function, no I/O.
 */

import { describe, it, expect } from 'bun:test'
import { buildItemSummary } from './batch-processor.ts'
import type { BatchItem } from './types.ts'

const SHORT_PROMPT = '# 定义学校域标签'
const LONG_PROMPT = '# 定义学校域标签\n\n你的任务:对一个学校域名单标签,通过 `define-tag` skill 完成 tag 字段注册 + 标准学校实体清单挂载。'.padEnd(150, 'x')

describe('buildItemSummary', () => {
  it('renders values only (no key= prefix) joined by · and appends prompt', () => {
    const item: BatchItem = {
      id: '1',
      fields: { tag_id: '1', domain: 'school', tag_name: '清北', disambiguation: '' },
    }
    expect(buildItemSummary(item, 'tag_id', SHORT_PROMPT))
      .toBe('school · 清北 — # 定义学校域标签')
  })

  it('skips idField and empty values, caps at 3 fields', () => {
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
    // emp_id skipped (idField), notes skipped (empty), first 3 of remainder
    expect(buildItemSummary(item, 'emp_id', SHORT_PROMPT))
      .toBe('Alice · Engineer · Data — # 定义学校域标签')
  })

  it('truncates long values at 40 chars and normalizes whitespace in the prompt', () => {
    const item: BatchItem = {
      id: '1',
      fields: {
        id: '1',
        description: 'a'.repeat(60),
        notes: 'line1\n\n  line2   line3',
      },
    }
    const summary = buildItemSummary(item, 'id', LONG_PROMPT)
    // value truncation
    expect(summary).toContain(`${'a'.repeat(40)}…`)
    // whitespace collapse in value
    expect(summary).toContain('line1 line2 line3')
    // prompt section follows ` — ` and has no newlines
    const promptSection = summary.split(' — ')[1]!
    expect(promptSection).not.toContain('\n')
    expect(promptSection).toMatch(/…$/)
  })

  it('returns only the truncated prompt when no usable fields exist', () => {
    const item: BatchItem = {
      id: '1',
      fields: { id: '1', a: '', b: '   ' },
    }
    expect(buildItemSummary(item, 'id', SHORT_PROMPT)).toBe('# 定义学校域标签')
    expect(buildItemSummary(item, 'id', LONG_PROMPT))
      .toMatch(/^# 定义学校域标签 你的任务.*…$/)
  })

  it('returns only the values when prompt is empty', () => {
    const item: BatchItem = {
      id: '1',
      fields: { id: '1', name: 'Alice' },
    }
    expect(buildItemSummary(item, 'id', '')).toBe('Alice')
  })
})
