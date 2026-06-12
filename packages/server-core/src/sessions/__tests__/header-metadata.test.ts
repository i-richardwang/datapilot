import { describe, expect, test } from 'bun:test'
import { headerMetadataDiffers } from '../header-metadata'
import type { SessionHeader } from '@craft-agent/shared/sessions'

function header(overrides: Partial<SessionHeader> = {}): SessionHeader {
  return {
    id: 's1',
    name: 'My session',
    labels: ['a', 'b'],
    isFlagged: false,
    sessionStatus: 'done',
    ...overrides,
  } as SessionHeader
}

describe('headerMetadataDiffers', () => {
  test('persistence echo (header identical to memory) does NOT differ', () => {
    // Regression: in DB mode every save echoes back through the watcher with
    // isSelfWrite=false. Before the fix this echo was deferred into
    // pendingExternalMetadata during the post-set_session_status write-guard
    // window and, with no later turn to clear it, blocked hibernation forever.
    const current = { name: 'My session', labels: ['a', 'b'], isFlagged: false, sessionStatus: 'done' }
    expect(headerMetadataDiffers(current, header())).toBe(false)
  })

  test('undefined-vs-default normalization matches applyExternalSessionMetadata', () => {
    // labels undefined ≡ [], isFlagged undefined ≡ false
    expect(headerMetadataDiffers(
      { name: 'n', labels: undefined, isFlagged: undefined, sessionStatus: undefined },
      header({ name: 'n', labels: [], isFlagged: false, sessionStatus: undefined }),
    )).toBe(false)
  })

  test('each applied field is detected', () => {
    const current = { name: 'My session', labels: ['a', 'b'], isFlagged: false, sessionStatus: 'done' }
    expect(headerMetadataDiffers(current, header({ labels: ['a'] }))).toBe(true)
    expect(headerMetadataDiffers(current, header({ isFlagged: true }))).toBe(true)
    expect(headerMetadataDiffers(current, header({ sessionStatus: 'in-progress' }))).toBe(true)
    expect(headerMetadataDiffers(current, header({ name: 'Renamed' }))).toBe(true)
  })

  test('fields outside the applied set are ignored (e.g. preview, messageCount)', () => {
    const current = { name: 'My session', labels: ['a', 'b'], isFlagged: false, sessionStatus: 'done' }
    expect(headerMetadataDiffers(current, header({ preview: 'changed', messageCount: 99 } as Partial<SessionHeader>))).toBe(false)
  })
})
