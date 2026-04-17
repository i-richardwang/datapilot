/**
 * Output envelope for the unified `datapilot` CLI.
 *
 * Contract:
 *   - Non-TTY stdout (piped, redirected, CI): JSON envelope
 *       Success: { ok: true, data, warnings } → exit 0
 *       Failure: { ok: false, error: { code, message, suggestion? }, warnings }
 *                exit 2 for USAGE_ERROR, 1 otherwise
 *   - TTY stdout: human-readable rendering via the optional `human` formatter,
 *     falling back to a JSON pretty-print when no formatter is provided.
 *
 * The TTY check is done once per process at module-load time so that a single
 * call site can override it via `setOutputMode` (used by tests).
 */

import { format as formatHuman } from './output.ts'

export type ErrorCode =
  | 'USAGE_ERROR'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONNECTION_ERROR'
  | 'INTERNAL_ERROR'

export interface OkOptions {
  /** Optional TTY-mode renderer. Receives the data, returns a string to print. */
  human?: (data: unknown) => string
  /** Override TTY detection — useful for tests / forced JSON mode. */
  json?: boolean
}

export interface FailOptions {
  json?: boolean
  suggestion?: string
}

const warnings: string[] = []

let forcedMode: 'json' | 'human' | null = null

/**
 * Force the output mode for the rest of the process.
 * Called by the entry once `--json` / `--no-tty` flags are parsed.
 */
export function setOutputMode(mode: 'json' | 'human' | null): void {
  forcedMode = mode
}

export function isJsonMode(): boolean {
  if (forcedMode) return forcedMode === 'json'
  return process.stdout.isTTY !== true
}

export function warn(msg: string): void {
  warnings.push(msg)
}

export function getWarnings(): readonly string[] {
  return warnings
}

export function clearWarnings(): void {
  warnings.length = 0
}

/** Print success and exit 0. */
export function ok(data: unknown, opts?: OkOptions): never {
  const useJson = opts?.json ?? isJsonMode()
  if (useJson) {
    process.stdout.write(JSON.stringify({ ok: true, data, warnings }, null, 2) + '\n')
  } else {
    const text = opts?.human ? opts.human(data) : formatHuman(data)
    process.stdout.write(text + (text.endsWith('\n') ? '' : '\n'))
    if (warnings.length > 0) {
      for (const w of warnings) process.stderr.write(`warning: ${w}\n`)
    }
  }
  process.exit(0)
}

/** Print failure and exit. USAGE_ERROR exits 2, all others exit 1. */
export function fail(code: ErrorCode, message: string, opts?: FailOptions): never {
  const useJson = opts?.json ?? isJsonMode()
  const exitCode = code === 'USAGE_ERROR' ? 2 : 1
  if (useJson) {
    const error: Record<string, string> = { code, message }
    if (opts?.suggestion) error.suggestion = opts.suggestion
    process.stdout.write(JSON.stringify({ ok: false, error, warnings }, null, 2) + '\n')
  } else {
    process.stderr.write(`error (${code}): ${message}\n`)
    if (opts?.suggestion) process.stderr.write(`  hint: ${opts.suggestion}\n`)
    if (warnings.length > 0) {
      for (const w of warnings) process.stderr.write(`warning: ${w}\n`)
    }
  }
  process.exit(exitCode)
}
