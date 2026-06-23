import { describe, expect, it } from 'bun:test'
import type { LabelConfig } from '@craft-agent/shared/labels'
import { buildSessionListFilter } from '../session-list-filter'

const labels: LabelConfig[] = [
  {
    id: 'parent',
    name: 'Parent',
    children: [
      { id: 'child', name: 'Child' },
    ],
  },
  { id: 'other', name: 'Other' },
]

describe('buildSessionListFilter', () => {
  it('translates dynamic views to server-side view filters', () => {
    const filter = buildSessionListFilter(
      { kind: 'view', viewId: 'needs-review' } as any,
      new Map(),
      new Map(),
      labels,
    )

    expect(filter).toEqual({
      archived: false,
      viewId: 'needs-review',
    })
  })

  it('expands primary and secondary label filters into AND groups', () => {
    const filter = buildSessionListFilter(
      { kind: 'label', labelId: 'parent' } as any,
      new Map(),
      new Map([['other', 'include']]),
      labels,
    )

    expect(filter).toEqual({
      archived: false,
      labelIncludeGroups: [
        ['parent', 'child'],
        ['other'],
      ],
    })
  })

  it('uses an impossible status include when include chips conflict with a pinned state', () => {
    const filter = buildSessionListFilter(
      { kind: 'state', stateId: 'todo' } as any,
      new Map([['done', 'include']]),
      new Map(),
      labels,
    )

    expect(filter).toEqual({
      archived: false,
      batch: false,
      statusInclude: ['__none__'],
    })
  })
})
