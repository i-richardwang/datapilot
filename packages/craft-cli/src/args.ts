/**
 * Argument parsing for datapilot CLI.
 *
 * Parses: datapilot <entity> <action> [positionals...] [--flags]
 */

export interface ParsedArgs {
  entity: string | undefined
  action: string | undefined
  positionals: string[]
  flags: Record<string, string | boolean | string[]>
}

/** Flags that accumulate into arrays when repeated (e.g. --label a --label b). */
const REPEATABLE_FLAGS = new Set(['label'])

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags: Record<string, string | boolean | string[]> = {}
  let i = 0

  while (i < argv.length) {
    const arg = argv[i]!
    if (arg === '--') {
      // Everything after -- is positional
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const nextArg = argv[i + 1]
      if (nextArg !== undefined && !nextArg.startsWith('-')) {
        if (REPEATABLE_FLAGS.has(key)) {
          const existing = flags[key]
          if (Array.isArray(existing)) {
            existing.push(nextArg)
          } else {
            flags[key] = [nextArg]
          }
        } else {
          flags[key] = nextArg
        }
        i += 2
      } else {
        flags[key] = true
        i++
      }
    } else if (arg === '-h') {
      flags['help'] = true
      i++
    } else if (arg === '-v') {
      flags['version'] = true
      i++
    } else {
      positionals.push(arg)
      i++
    }
  }

  const [entity, action, ...rest] = positionals
  return { entity, action, positionals: rest, flags }
}

/** Extract a string flag value. */
export function strFlag(flags: Record<string, string | boolean | string[]>, key: string): string | undefined {
  const val = flags[key]
  return typeof val === 'string' ? val : undefined
}

/** Extract a boolean flag value. Returns undefined if not present. */
export function boolFlag(flags: Record<string, string | boolean | string[]>, key: string): boolean | undefined {
  const val = flags[key]
  if (val === undefined) return undefined
  if (val === true || val === 'true') return true
  if (val === false || val === 'false') return false
  return undefined
}

/** Extract a comma-separated list flag → string[]. */
export function listFlag(flags: Record<string, string | boolean | string[]>, key: string): string[] | undefined {
  const val = flags[key]
  if (val === undefined) return undefined
  if (Array.isArray(val)) return val
  if (typeof val === 'string') return val.split(',').map(s => s.trim()).filter(Boolean)
  return undefined
}

/** Extract an integer flag value. */
export function intFlag(flags: Record<string, string | boolean | string[]>, key: string): number | undefined {
  const val = flags[key]
  if (typeof val !== 'string') return undefined
  const n = parseInt(val, 10)
  return isNaN(n) ? undefined : n
}
