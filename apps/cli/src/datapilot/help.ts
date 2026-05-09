/**
 * Help spec types + per-entity registry + renderers for `dtpilot --help`,
 * `dtpilot <entity> --help`, and `dtpilot <entity> <action> --help`.
 *
 * Each command module exports its own `<ENTITY>_SPEC` next to its
 * `route<Entity>` function — single file, single source of truth. The
 * registry below imports them and routes help requests through one of
 * three renderers (top / entity / action).
 *
 * The same `flags` array drives `rejectUnknownFlags` in route handlers
 * (via `rejectActionFlags`), so a flag listed in help is always also
 * accepted by the parser, and vice versa.
 */

import { ok, fail } from './envelope.ts'
import { rejectUnknownFlags, type Flags } from './args.ts'
import { LABEL_SPEC } from './commands/label.ts'
import { SOURCE_SPEC } from './commands/source.ts'
import { AUTOMATION_SPEC } from './commands/automation.ts'
import { SKILL_SPEC } from './commands/skill.ts'
import { BATCH_SPEC } from './commands/batch.ts'
import { SESSION_SPEC } from './commands/session.ts'
import { WORKSPACE_SPEC } from './commands/workspace.ts'
import { STATUS_SPEC } from './commands/status.ts'
import { PREFERENCE_SPEC } from './commands/preference.ts'

export interface FlagSpec {
  name: string
  type: 'string' | 'int' | 'bool' | 'list'
  required?: boolean
  description: string
  default?: string | number
}

export interface PositionalSpec {
  name: string
  required?: boolean
  variadic?: boolean
  description: string
}

export interface ActionSpec {
  name: string
  description: string
  positionals?: PositionalSpec[]
  flags: FlagSpec[]
  /** Maps flat-flag name to JSON key when not the obvious camelCase. */
  renames?: Record<string, string>
  /** Whether `--input '<json>'` / `--stdin` are accepted (data fields). */
  takesInput?: boolean
  example: string
}

export interface EntitySpec {
  name: string
  description: string
  actions: ActionSpec[]
}

const REGISTRY: Record<string, EntitySpec> = {
  label: LABEL_SPEC,
  source: SOURCE_SPEC,
  automation: AUTOMATION_SPEC,
  skill: SKILL_SPEC,
  batch: BATCH_SPEC,
  session: SESSION_SPEC,
  workspace: WORKSPACE_SPEC,
  status: STATUS_SPEC,
  preference: PREFERENCE_SPEC,
}

export function getEntitySpec(name: string): EntitySpec | undefined {
  return REGISTRY[name]
}

export function getActionSpec(entity: string, action: string): ActionSpec | undefined {
  return REGISTRY[entity]?.actions.find((a) => a.name === action)
}

export function listEntities(): EntitySpec[] {
  return Object.values(REGISTRY)
}

/** Reject any flag not declared in the action spec (plus universal --input/--stdin). */
export function rejectActionFlags(flags: Flags, spec: ActionSpec): void {
  rejectUnknownFlags(
    flags,
    spec.flags.map((f) => f.name),
    spec.renames ?? {},
  )
}

// ---------------------------------------------------------------------------
// Renderers — top / entity / action. Each exits the process via ok()/fail().
// ---------------------------------------------------------------------------

export function printTopHelp(): never {
  const entities = listEntities()
  const data = {
    description: 'dtpilot — unified CLI for the DataPilot server',
    usage: 'dtpilot [global-flags] <entity> <action> [positionals...] [flags...]',
    entities: entities.map((e) => ({ name: e.name, description: e.description })),
  }
  ok(data, { human: () => renderTopHelpHuman(entities) })
}

export function printEntityHelp(entity: string): never {
  const spec = getEntitySpec(entity)
  if (!spec) {
    fail('USAGE_ERROR', `Unknown entity: ${entity}`, {
      suggestion: `Valid entities: ${Object.keys(REGISTRY).join(', ')}`,
    })
  }
  const data = {
    entity: spec.name,
    description: spec.description,
    usage: `dtpilot ${spec.name} <action> [positionals...] [flags...]`,
    actions: spec.actions.map((a) => ({ name: a.name, description: a.description })),
  }
  ok(data, { human: () => renderEntityHelpHuman(spec) })
}

export function printActionHelp(entity: string, action: string): never {
  const espec = getEntitySpec(entity)
  if (!espec) {
    fail('USAGE_ERROR', `Unknown entity: ${entity}`, {
      suggestion: `Valid entities: ${Object.keys(REGISTRY).join(', ')}`,
    })
  }
  const aspec = getActionSpec(entity, action)
  if (!aspec) {
    fail('USAGE_ERROR', `Unknown ${entity} action: ${action}`, {
      suggestion: `Valid actions: ${espec.actions.map((a) => a.name).join(', ')}`,
    })
  }
  const data = {
    entity: espec.name,
    action: aspec.name,
    description: aspec.description,
    usage: renderUsageLine(espec.name, aspec),
    positionals: (aspec.positionals ?? []).map((p) => ({
      name: p.name,
      required: p.required ?? true,
      variadic: p.variadic ?? false,
      description: p.description,
    })),
    flags: aspec.flags.map((f) => ({
      name: f.name,
      type: f.type,
      required: f.required ?? false,
      description: f.description,
      default: f.default,
    })),
    takesInput: aspec.takesInput ?? false,
    example: aspec.example,
  }
  ok(data, { human: () => renderActionHelpHuman(espec.name, aspec) })
}

// ---------------------------------------------------------------------------
// Human renderers (TTY mode). JSON path uses the same data, just stringified.
// ---------------------------------------------------------------------------

function renderTopHelpHuman(entities: EntitySpec[]): string {
  const lines: string[] = []
  lines.push('dtpilot — unified CLI for the DataPilot server')
  lines.push('')
  lines.push('Usage:')
  lines.push('  dtpilot [global-flags] <entity> <action> [positionals...] [flags...]')
  lines.push('')
  lines.push('Global flags:')
  lines.push('  --url <ws-url>              Server URL (default: ws://127.0.0.1:9100, env: DATAPILOT_SERVER_URL)')
  lines.push('  --token <secret>            Auth token (env: DATAPILOT_SERVER_TOKEN, or discovery file)')
  lines.push('  --workspace <id|slug|name>  Workspace identifier (auto-detected if omitted)')
  lines.push('  --timeout <ms>              Per-request timeout (default: 30000)')
  lines.push('  --tls-ca <path>             Custom CA cert for self-signed TLS (env: DATAPILOT_TLS_CA)')
  lines.push('  --json                      Force JSON envelope output (default for non-TTY stdout)')
  lines.push('  --human                     Force human-readable output (default for TTY stdout)')
  lines.push('  --help, -h                  Show help (works at every level: top, entity, action)')
  lines.push('  --version, -v               Show version')
  lines.push('')
  lines.push('Entities:')
  const w = Math.max(...entities.map((e) => e.name.length))
  for (const e of entities) {
    lines.push(`  ${e.name.padEnd(w)}  ${e.description}`)
  }
  lines.push('')
  lines.push("Run 'dtpilot <entity> --help' to list actions, 'dtpilot <entity> <action> --help' for action details.")
  return lines.join('\n')
}

function renderEntityHelpHuman(spec: EntitySpec): string {
  const lines: string[] = []
  lines.push(`dtpilot ${spec.name} — ${spec.description}`)
  lines.push('')
  lines.push('Usage:')
  lines.push(`  dtpilot ${spec.name} <action> [positionals...] [flags...]`)
  lines.push('')
  lines.push('Actions:')
  const w = Math.max(...spec.actions.map((a) => a.name.length))
  for (const a of spec.actions) {
    lines.push(`  ${a.name.padEnd(w)}  ${a.description}`)
  }
  lines.push('')
  lines.push(`Run 'dtpilot ${spec.name} <action> --help' for action details.`)
  return lines.join('\n')
}

function renderActionHelpHuman(entity: string, spec: ActionSpec): string {
  const lines: string[] = []
  lines.push(`dtpilot ${entity} ${spec.name} — ${spec.description}`)
  lines.push('')
  lines.push('Usage:')
  lines.push(`  ${renderUsageLine(entity, spec)}`)
  lines.push('')

  if (spec.positionals?.length) {
    lines.push('Positionals:')
    const w = Math.max(...spec.positionals.map((p) => p.name.length))
    for (const p of spec.positionals) {
      const tag = p.required === false ? ' (optional)' : ''
      lines.push(`  ${p.name.padEnd(w)}  ${p.description}${tag}`)
    }
    lines.push('')
  }

  if (spec.flags.length || spec.takesInput) {
    lines.push('Flags:')
    const flagLabels = spec.flags.map((f) => `--${f.name} ${typeTag(f.type)}`)
    if (spec.takesInput) {
      flagLabels.push(`--input '<json>'`)
      flagLabels.push(`--stdin`)
    }
    const w = Math.max(...flagLabels.map((s) => s.length))
    for (let i = 0; i < spec.flags.length; i++) {
      const f = spec.flags[i]!
      const label = flagLabels[i]!
      const req = f.required ? ' (required)' : ''
      const dflt = f.default !== undefined ? ` (default: ${f.default})` : ''
      lines.push(`  ${label.padEnd(w)}  ${f.description}${req}${dflt}`)
    }
    if (spec.takesInput) {
      const inputLabel = `--input '<json>'`
      const stdinLabel = `--stdin`
      lines.push(`  ${inputLabel.padEnd(w)}  Data fields as JSON (see datapilot-cli.md for the field schema)`)
      lines.push(`  ${stdinLabel.padEnd(w)}  Read JSON from stdin (alternative to --input)`)
    }
    lines.push('')
  }

  lines.push('Example:')
  lines.push(`  ${spec.example}`)
  return lines.join('\n')
}

function typeTag(t: FlagSpec['type']): string {
  switch (t) {
    case 'string': return '<string>'
    case 'int': return '<int>'
    case 'list': return '<v1,v2,...>'
    case 'bool': return ''
  }
}

function renderUsageLine(entity: string, spec: ActionSpec): string {
  const parts: string[] = ['dtpilot', entity, spec.name]
  for (const p of spec.positionals ?? []) {
    const required = p.required !== false
    const inner = p.variadic ? `${p.name}...` : p.name
    parts.push(required ? `<${inner}>` : `[${inner}]`)
  }
  for (const f of spec.flags) {
    const tag = typeTag(f.type)
    const flag = tag ? `--${f.name} ${tag}` : `--${f.name}`
    parts.push(f.required ? flag : `[${flag}]`)
  }
  if (spec.takesInput) {
    parts.push(`[--input '<json>' | --stdin]`)
  }
  return parts.join(' ')
}
