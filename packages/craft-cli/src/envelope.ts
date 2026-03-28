/**
 * JSON Envelope — all craft-agent CLI output goes through this.
 *
 * Success: { ok: true, data, warnings } → exit 0
 * Failure: { ok: false, error: { code, message, suggestion? }, warnings } → exit 1 or 2
 */

const warnings: string[] = []

export function warn(msg: string): void {
  warnings.push(msg)
}

export function ok(data: unknown): never {
  console.log(JSON.stringify({ ok: true, data, warnings }, null, 2))
  process.exit(0)
}

type ErrorCode = 'USAGE_ERROR' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'INTERNAL_ERROR'

export function fail(code: ErrorCode, message: string, suggestion?: string): never {
  const error: Record<string, string> = { code, message }
  if (suggestion) error.suggestion = suggestion
  console.log(JSON.stringify({ ok: false, error, warnings }, null, 2))
  process.exit(code === 'USAGE_ERROR' ? 2 : 1)
}
