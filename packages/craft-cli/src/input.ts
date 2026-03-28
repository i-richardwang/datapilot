/**
 * Structured input parsing for --json and --stdin flags.
 */

import { fail } from './envelope.ts'

export function parseInput(flags: Record<string, string | boolean | string[]>): Record<string, unknown> | null {
  const jsonStr = flags['json']
  const useStdin = flags['stdin'] === true

  if (typeof jsonStr === 'string') {
    try {
      const parsed = JSON.parse(jsonStr)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        fail('USAGE_ERROR', '--json must be a JSON object')
      }
      return parsed as Record<string, unknown>
    } catch (e) {
      fail('USAGE_ERROR', `Invalid --json: ${(e as Error).message}`)
    }
  }

  if (useStdin) {
    try {
      const input = require('fs').readFileSync('/dev/stdin', 'utf-8').trim()
      if (!input) return null
      const parsed = JSON.parse(input)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        fail('USAGE_ERROR', '--stdin input must be a JSON object')
      }
      return parsed as Record<string, unknown>
    } catch (e) {
      fail('USAGE_ERROR', `Invalid --stdin JSON: ${(e as Error).message}`)
    }
  }

  return null
}
