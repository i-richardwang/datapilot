/**
 * Unit tests for SessionManager.setSharePassword
 *
 * Tests the client-side behavior when interacting with the viewer-server
 * password endpoint. Uses fetch mocking to verify error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { SessionManager } from '../SessionManager'
import type { Workspace } from '@craft-agent/shared/config'

const mockWorkspace: Workspace = {
  id: 'test-workspace',
  name: 'Test Workspace',
  rootPath: '/tmp/test-workspace',
}

describe('SessionManager.setSharePassword', () => {
  let sessionManager: SessionManager

  beforeEach(() => {
    sessionManager = new SessionManager()
  })

  afterEach(() => {
    sessionManager.destroy()
  })

  it('rejects first-time-set on unprotected share with password_already_set error', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'password_already_set' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }) as typeof fetch

    try {
      const managed = sessionManager.createManagedSession(
        { id: 'session-1' },
        mockWorkspace,
      )
      managed.sharedId = 'share-123'
      managed.sharedUrl = 'https://view.example.com/s/share-123'
      sessionManager.sessions.set('session-1', managed)

      const result = await sessionManager.setSharePassword('session-1', null, 'newpassword')

      expect(result.success).toBe(false)
      expect(result.error).toBe('password_already_set')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('allows password change when current password is correct', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(JSON.stringify({ hasPassword: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }) as typeof fetch

    try {
      const managed = sessionManager.createManagedSession(
        { id: 'session-2' },
        mockWorkspace,
      )
      managed.sharedId = 'share-456'
      managed.sharedUrl = 'https://view.example.com/s/share-456'
      managed.sharedPasswordSet = true
      sessionManager.sessions.set('session-2', managed)

      const result = await sessionManager.setSharePassword('session-2', 'oldpassword', 'newpassword')

      expect(result.success).toBe(true)
      expect(result.hasPassword).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns error when current password is invalid', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => {
      return Promise.resolve(
        new Response(JSON.stringify({ error: 'password_invalid' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }) as typeof fetch

    try {
      const managed = sessionManager.createManagedSession(
        { id: 'session-3' },
        mockWorkspace,
      )
      managed.sharedId = 'share-789'
      managed.sharedUrl = 'https://view.example.com/s/share-789'
      managed.sharedPasswordSet = true
      sessionManager.sessions.set('session-3', managed)

      const result = await sessionManager.setSharePassword('session-3', 'wrongpassword', 'newpassword')

      expect(result.success).toBe(false)
      expect(result.error).toBe('password_invalid')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns session not found for unknown session', async () => {
    const result = await sessionManager.setSharePassword('non-existent', null, 'password')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Session not found')
  })

  it('returns session not shared when sharedId is missing', async () => {
    const managed = sessionManager.createManagedSession(
      { id: 'session-4' },
      mockWorkspace,
    )
    sessionManager.sessions.set('session-4', managed)

    const result = await sessionManager.setSharePassword('session-4', null, 'password')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Session not shared')
  })
})