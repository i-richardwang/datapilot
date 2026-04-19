/**
 * Argument parser for the unified `datapilot` CLI.
 *
 * Grammar:
 *   datapilot [global-flags] <entity> [action] [positionals...] [flags...]
 *
 * Global flags (consumed before entity is detected):
 *   --url <ws-url>           Override server URL
 *   --token <secret>         Override server auth token
 *   --workspace <id>         Workspace ID (or auto-detected)
 *   --timeout <ms>           Per-request timeout
 *   --tls-ca <path>          Custom CA cert
 *   --json                   Force JSON envelope output
 *   --human                  Force human-readable output
 *   --help, -h               Print help
 *   --version, -v            Print version
 *
 * Per-action flags are returned in `flags`; `--` ends flag parsing.
 * Repeatable flags (--source, --label) accumulate into arrays.
 */

export interface ParsedArgs {
  /** Global connection / output flags. */
  global: {
    url?: string
    token?: string
    workspace?: string
    tlsCa?: string
    timeout?: number
    json?: boolean
    human?: boolean
    help?: boolean
    version?: boolean
  }
  entity: string | undefined
  action: string | undefined
  positionals: string[]
  flags: Flags
}

export type FlagValue = string | boolean | string[]
export type Flags = Record<string, FlagValue>

const REPEATABLE = new Set(['source', 'label', 'pattern'])
const GLOBAL_KEYS = new Set([
  'url',
  'token',
  'workspace',
  'tls-ca',
  'timeout',
  'json',
  'human',
  'help',
  'version',
])

/**
 * Flags whose presence alone is meaningful (no value consumed). Any flag not
 * in this set takes the next non-flag arg as its value. This is the canonical
 * boolean list — keep it synced with new boolean per-action flags as they're
 * added (currently: --stdin, --dry-run).
 */
const BOOLEAN_FLAGS = new Set([
  // global
  'json', 'human', 'help', 'version',
  // per-action
  'stdin', 'dry-run',
])

function takesValue(key: string, next: string | undefined): boolean {
  if (BOOLEAN_FLAGS.has(key)) return false
  if (next === undefined) return false
  if (!next.startsWith('-')) return true
  // Allow negative numbers as values
  return /^-\d/.test(next)
}

export function parseArgs(argv: string[]): ParsedArgs {
  const global: ParsedArgs['global'] = {}
  const positionals: string[] = []
  const flags: Flags = {}
  let i = 0

  while (i < argv.length) {
    const arg = argv[i]!
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (takesValue(key, next)) {
        if (GLOBAL_KEYS.has(key)) {
          assignGlobal(global, key, next!)
        } else if (REPEATABLE.has(key)) {
          const existing = flags[key]
          if (Array.isArray(existing)) existing.push(next!)
          else flags[key] = [next!]
        } else {
          flags[key] = next!
        }
        i += 2
      } else {
        if (GLOBAL_KEYS.has(key)) {
          assignGlobal(global, key, true)
        } else {
          flags[key] = true
        }
        i++
      }
    } else if (arg === '-h') {
      global.help = true
      i++
    } else if (arg === '-v') {
      global.version = true
      i++
    } else {
      positionals.push(arg)
      i++
    }
  }

  // Connection-detail env vars ($DATAPILOT_SERVER_URL / _TOKEN / _TLS_CA)
  // are intentionally NOT applied here — they're resolved later in
  // `transport.resolveEndpoint` / `connect`, so the `source` field on the
  // resolved endpoint can correctly distinguish flag vs env vs discovery.

  const [entity, action, ...rest] = positionals
  return { global, entity, action, positionals: rest, flags }
}

function assignGlobal(global: ParsedArgs['global'], key: string, value: string | boolean): void {
  switch (key) {
    case 'url': global.url = String(value); break
    case 'token': global.token = String(value); break
    case 'workspace': global.workspace = String(value); break
    case 'tls-ca': global.tlsCa = String(value); break
    case 'timeout': {
      const n = parseInt(String(value), 10)
      if (!isNaN(n)) global.timeout = n
      break
    }
    case 'json': global.json = value === true || value === 'true'; break
    case 'human': global.human = value === true || value === 'true'; break
    case 'help': global.help = value === true || value === 'true'; break
    case 'version': global.version = value === true || value === 'true'; break
  }
}

// ---------------------------------------------------------------------------
// Flag value helpers
// ---------------------------------------------------------------------------

export function strFlag(flags: Flags, key: string): string | undefined {
  const v = flags[key]
  return typeof v === 'string' ? v : undefined
}

export function boolFlag(flags: Flags, key: string): boolean | undefined {
  const v = flags[key]
  if (v === undefined) return undefined
  if (v === true || v === 'true') return true
  if (v === false || v === 'false') return false
  return undefined
}

export function intFlag(flags: Flags, key: string): number | undefined {
  const v = flags[key]
  if (typeof v !== 'string') return undefined
  const n = parseInt(v, 10)
  return isNaN(n) ? undefined : n
}

export function listFlag(flags: Flags, key: string): string[] | undefined {
  const v = flags[key]
  if (v === undefined) return undefined
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean)
  return undefined
}

/**
 * Parse a `--input '<json>'` flag, or read JSON from stdin when `--stdin` is set.
 * Returns undefined when neither is present.
 */
export async function parseInput(flags: Flags): Promise<Record<string, unknown> | undefined> {
  const input = strFlag(flags, 'input')
  if (input) {
    return parseObjectJson(input, '--input must be valid JSON object')
  }
  if (boolFlag(flags, 'stdin')) {
    const text = await readStdin()
    if (!text.trim()) return undefined
    return parseObjectJson(text, 'stdin must be valid JSON object')
  }
  return undefined
}

function parseObjectJson(raw: string, errorMessage: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new UsageError(errorMessage)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UsageError(errorMessage)
  }
  return parsed as Record<string, unknown>
}

/**
 * Thrown for input-shape errors that should surface as USAGE_ERROR (exit 2)
 * instead of INTERNAL_ERROR. Caught by the entry's main loop.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

async function readStdin(): Promise<string> {
  const chunks: string[] = []
  const decoder = new TextDecoder()
  // Prefer Bun.stdin when available, fall back to node:stream
  const bunGlobal = (globalThis as { Bun?: { stdin: { stream(): ReadableStream<Uint8Array> } } }).Bun
  if (bunGlobal) {
    const reader = bunGlobal.stdin.stream().getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(decoder.decode(value, { stream: true }))
    }
    return chunks.join('')
  }
  const { Readable } = await import('node:stream')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reader = (Readable.toWeb(process.stdin as any) as ReadableStream<Uint8Array>).getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(decoder.decode(value, { stream: true }))
  }
  return chunks.join('')
}
