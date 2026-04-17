/**
 * Session commands — share session or an HTML artifact to the public viewer.
 *
 * Unlike other datapilot entities, these commands print just the resulting URL
 * to stdout (no JSON envelope) so agents can capture it via `$(datapilot ...)`.
 * Errors still go through `fail()` for a structured non-zero exit.
 *
 * Storage: session data read via @craft-agent/shared/sessions,
 * metadata updates persisted via `updateSessionMetadata`.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { ok, fail } from '../envelope.ts'
import { strFlag } from '../args.ts'
import { loadSession, updateSessionMetadata } from '@craft-agent/shared/sessions'
import { VIEWER_URL } from '@craft-agent/shared/branding'

export async function routeSession(
  ws: string,
  action: string | undefined,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): Promise<void> {
  if (!action) ok({
    usage: 'datapilot session <action> [args] [--flags]',
    actions: ['share', 'share-html'],
  })

  switch (action) {
    case 'share': return await cmdShare(ws, positionals)
    case 'share-html': return await cmdShareHtml(ws, positionals, flags)
    default:
      fail('USAGE_ERROR', `Unknown session action: ${action}`, 'Valid actions: share, share-html')
  }
}

function resolveSessionId(positional: string | undefined, flagValue: string | undefined): string {
  const id = positional ?? flagValue ?? process.env.CRAFT_SESSION_ID
  if (!id) {
    fail(
      'USAGE_ERROR',
      'Session ID required',
      'pass <session-id>, --session <id>, or run inside a session where $CRAFT_SESSION_ID is set',
    )
  }
  return id
}

function printUrlAndExit(url: string): never {
  process.stdout.write(url + '\n')
  process.exit(0)
}

// ─── share ───────────────────────────────────────────────────────────────────

async function cmdShare(ws: string, positionals: string[]): Promise<void> {
  const sessionId = resolveSessionId(positionals[0], undefined)

  const stored = loadSession(ws, sessionId)
  if (!stored) {
    fail('NOT_FOUND', `Session '${sessionId}' not found in workspace`)
  }

  let response: Response
  try {
    response = await fetch(`${VIEWER_URL}/s/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stored),
    })
  } catch (e) {
    fail('INTERNAL_ERROR', `Upload failed: ${(e as Error).message}`)
  }

  if (!response.ok) {
    if (response.status === 413) {
      fail('VALIDATION_ERROR', 'Session is too large to share')
    }
    fail('INTERNAL_ERROR', `Upload failed (status ${response.status})`)
  }

  const data = await response.json() as { id: string; url: string }

  await updateSessionMetadata(ws, sessionId, {
    sharedUrl: data.url,
    sharedId: data.id,
  })

  printUrlAndExit(data.url)
}

// ─── share-html ──────────────────────────────────────────────────────────────

async function cmdShareHtml(
  ws: string,
  positionals: string[],
  flags: Record<string, string | boolean | string[]>,
): Promise<void> {
  const filePath = positionals[0]
  if (!filePath) {
    fail('USAGE_ERROR', 'Missing HTML file path', 'datapilot session share-html <file> [--session <id>]')
  }

  const sessionId = resolveSessionId(undefined, strFlag(flags, 'session'))

  let html: string
  try {
    html = readFileSync(resolve(filePath), 'utf8')
  } catch (e) {
    fail('NOT_FOUND', `Cannot read ${filePath}: ${(e as Error).message}`)
  }
  if (html.length === 0) {
    fail('VALIDATION_ERROR', 'HTML file is empty')
  }

  const stored = loadSession(ws, sessionId)
  if (!stored) {
    fail('NOT_FOUND', `Session '${sessionId}' not found in workspace`)
  }

  const contentHash = createHash('sha256').update(html).digest('hex')
  const existing = stored.htmlShares?.[contentHash]
  if (existing) {
    printUrlAndExit(existing.sharedUrl)
  }

  let response: Response
  try {
    response = await fetch(`${VIEWER_URL}/s/api/html`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    })
  } catch (e) {
    fail('INTERNAL_ERROR', `Upload failed: ${(e as Error).message}`)
  }

  if (!response.ok) {
    if (response.status === 413) {
      fail('VALIDATION_ERROR', 'HTML is too large to share')
    }
    fail('INTERNAL_ERROR', `Upload failed (status ${response.status})`)
  }

  const data = await response.json() as { id: string; url: string }

  const nextShares = {
    ...(stored.htmlShares ?? {}),
    [contentHash]: { sharedUrl: data.url, sharedId: data.id },
  }
  await updateSessionMetadata(ws, sessionId, { htmlShares: nextShares })

  printUrlAndExit(data.url)
}
