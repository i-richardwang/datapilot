#!/usr/bin/env bun
/**
 * craft-agent-batch CLI
 *
 * Standalone binary for batch processing commands.
 * Named craft-agent-batch to avoid conflicting with the private craft-agent CLI
 * that handles other domains (label, source, skill, automation, etc.).
 */

import { readFileSync } from 'node:fs'
import { resolveWorkspaceRoot } from './workspace.ts'
import { cmdList } from './commands/list.ts'
import { cmdGet } from './commands/get.ts'
import { cmdValidate } from './commands/validate.ts'
import { cmdStatus } from './commands/status.ts'
import { cmdCreate } from './commands/create.ts'
import { cmdUpdate, type UpdateOptions } from './commands/update.ts'
import { cmdEnable, cmdDisable } from './commands/enable.ts'
import { cmdDelete } from './commands/delete.ts'

const VERSION = '0.7.3'

const HELP = `
craft-agent-batch — Batch processing CLI

USAGE
  craft-agent-batch <command> [options]

COMMANDS
  list                          List all batches
  get <id>                      Show full config for a batch
  validate                      Validate batches.json
  status <id> [--items]         Show progress for a batch
  create [flags]                Create a new batch (see: create --help)
  update <id> [flags]           Update a batch (see: update --help)
  enable <id>                   Enable a batch
  disable <id>                  Disable a batch
  delete <id>                   Delete a batch

GLOBAL OPTIONS
  --workspace-root <path>       Explicit workspace root (default: auto-detect)
  --json                        Machine-readable JSON output
  --help, -h                    Show this help
  --version, -v                 Show version

EXAMPLES
  craft-agent-batch list
  craft-agent-batch get abc123
  craft-agent-batch validate
  craft-agent-batch status abc123 --items
  craft-agent-batch create --name "My batch" --source data.csv --id-field id --prompt-file prompt.txt
  craft-agent-batch update abc123 --name "Renamed" --concurrency 5
  craft-agent-batch update abc123 --enabled false
  craft-agent-batch enable abc123
  craft-agent-batch disable abc123
  craft-agent-batch delete abc123
`.trim()

const CREATE_HELP = `
craft-agent-batch create — Create a new batch

USAGE
  craft-agent-batch create [options]

REQUIRED
  --name <name>                 Display name for the batch
  --source <path>               Path to data source file (.csv, .json, .jsonl)
  --id-field <field>            Field name to use as unique item identifier
  --prompt-file <path>          Prompt template file (use $BATCH_ITEM_<FIELD> placeholders)

OPTIONAL
  --concurrency <n>             Max concurrent sessions (default: 3)
  --model <id>                  Model ID for created sessions
  --connection <slug>           LLM connection slug
  --permission-mode <mode>      safe | ask | allow-all
  --label <label>               Label to apply (repeatable)
  --working-directory <path>    Working directory for sessions (absolute path; omit for workspace default)
  --output-path <path>          Output file path (.jsonl) for structured results
  --output-schema <json>        JSON Schema for output validation
  --patch <json>                Raw JSON merged into the batch config (advanced)
  --json                        Output created batch as JSON

EXAMPLES
  craft-agent-batch create --name "User Analysis" --source data/users.csv --id-field user_id \\
    --prompt-file prompt.txt

  craft-agent-batch create --name "Extraction" --source data.csv --id-field id \\
    --prompt-file prompt.txt --output-path output/results.jsonl \\
    --output-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}'
`.trim()

const UPDATE_HELP = `
craft-agent-batch update — Update an existing batch

USAGE
  craft-agent-batch update <id> [options]

FLAGS (all optional, same as create)
  --name <name>                 Display name
  --prompt-file <path>          Prompt template file
  --source <path>               Data source file path
  --id-field <field>            Unique item identifier field
  --concurrency <n>             Max concurrent sessions
  --model <id>                  Model ID
  --connection <slug>           LLM connection slug
  --permission-mode <mode>      safe | ask | allow-all
  --label <label>               Labels (repeatable, replaces existing)
  --working-directory <path>    Working directory for sessions (absolute path; omit for workspace default)
  --enabled true|false          Enable or disable the batch
  --output-path <path>          Output file path (.jsonl)
  --output-schema <json>        JSON Schema for output validation
  --patch <json>                Raw JSON patch (flags override --patch values)
  --json                        Output updated batch as JSON

EXAMPLES
  craft-agent-batch update abc123 --name "Renamed Batch" --concurrency 10
  craft-agent-batch update abc123 --enabled false
  craft-agent-batch update abc123 --output-path output/new.jsonl
  craft-agent-batch update abc123 --patch '{"execution":{"retryOnFailure":true,"maxRetries":3}}'

CLEARING FIELDS
  Pass an empty string to clear an optional field back to its default:
    craft-agent-batch update abc123 --model ""
    craft-agent-batch update abc123 --output-path ""      (removes entire output config)
    craft-agent-batch update abc123 --label ""             (removes all labels)

  Or use --patch with null values:
    craft-agent-batch update abc123 --patch '{"execution":{"model":null}}'
`.trim()

function parseArgs(argv: string[]): {
  subcommand: string | undefined
  args: string[]
  flags: Record<string, string | boolean | string[]>
} {
  const args: string[] = []
  const flags: Record<string, string | boolean | string[]> = {}
  let i = 0

  while (i < argv.length) {
    const arg = argv[i]!
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const nextArg = argv[i + 1]
      if (nextArg !== undefined && !nextArg.startsWith('-')) {
        // Multi-value flags (--label can be repeated)
        if (key === 'label') {
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
    } else if (arg === '-h' || arg === '--help') {
      flags['help'] = true
      i++
    } else if (arg === '-v' || arg === '--version') {
      flags['version'] = true
      i++
    } else {
      args.push(arg)
      i++
    }
  }

  const [subcommand, ...rest] = args
  return { subcommand, args: rest, flags }
}

/** Parse --enabled flag as boolean. Returns undefined if not present. */
function parseEnabledFlag(flags: Record<string, string | boolean | string[]>): boolean | undefined {
  const val = flags['enabled']
  if (val === undefined) return undefined
  if (val === true || val === 'true') return true
  if (val === 'false') return false
  console.error('Invalid --enabled value (must be true or false)')
  process.exit(1)
}

/** Parse a string flag, returning undefined if not present or not a string. */
function strFlag(flags: Record<string, string | boolean | string[]>, key: string): string | undefined {
  const val = flags[key]
  return typeof val === 'string' ? val : undefined
}

/** Parse --concurrency as integer. Returns undefined if not present. */
function parseConcurrency(flags: Record<string, string | boolean | string[]>): number | undefined {
  const raw = flags['concurrency']
  if (raw === undefined || typeof raw !== 'string') return undefined
  const n = parseInt(raw, 10)
  if (isNaN(n)) {
    console.error('Invalid --concurrency value (must be a number)')
    process.exit(1)
  }
  return n
}

/** Parse --permission-mode, validating against allowed values. */
function parsePermissionMode(flags: Record<string, string | boolean | string[]>): 'safe' | 'ask' | 'allow-all' | undefined {
  const raw = flags['permission-mode']
  if (raw === undefined || typeof raw !== 'string') return undefined
  const validModes = ['safe', 'ask', 'allow-all'] as const
  if (!validModes.includes(raw as typeof validModes[number])) {
    console.error(`Invalid --permission-mode (must be one of: ${validModes.join(', ')})`)
    process.exit(1)
  }
  return raw as typeof validModes[number]
}

/** Parse --label flag (repeatable). Returns undefined if not present. */
function parseLabels(flags: Record<string, string | boolean | string[]>): string[] | undefined {
  const val = flags['label']
  if (val === undefined) return undefined
  if (Array.isArray(val)) return val
  if (typeof val === 'string') return [val]
  return undefined
}

/** Build UpdateOptions from parsed flags. Empty strings on clearable fields become null. */
function buildUpdateOptions(flags: Record<string, string | boolean | string[]>): UpdateOptions {
  const promptFile = strFlag(flags, 'prompt-file')
  const rawModel = strFlag(flags, 'model')
  const rawConnection = strFlag(flags, 'connection')
  const rawPermMode = strFlag(flags, 'permission-mode')
  const rawWorkDir = strFlag(flags, 'working-directory')
  const rawOutputPath = strFlag(flags, 'output-path')
  const rawOutputSchema = strFlag(flags, 'output-schema')
  const rawLabels = parseLabels(flags)

  return {
    name: strFlag(flags, 'name'),
    prompt: promptFile ? readFileSync(promptFile, 'utf-8').trim() : undefined,
    source: strFlag(flags, 'source'),
    idField: strFlag(flags, 'id-field'),
    concurrency: parseConcurrency(flags),
    model: rawModel === '' ? null : rawModel,
    connection: rawConnection === '' ? null : rawConnection,
    permissionMode: rawPermMode === '' ? null : parsePermissionMode(flags),
    labels: rawLabels?.length === 1 && rawLabels[0] === '' ? null : rawLabels,
    workingDirectory: rawWorkDir === '' ? null : rawWorkDir,
    enabled: parseEnabledFlag(flags),
    outputPath: rawOutputPath === '' ? null : rawOutputPath,
    outputSchema: rawOutputSchema === '' ? null : rawOutputSchema,
    patch: strFlag(flags, 'patch'),
  }
}

/** Check if any update option was provided. */
function hasUpdateOptions(opts: UpdateOptions): boolean {
  return Object.values(opts).some(v => v !== undefined)
}

function main(): void {
  const rawArgs = process.argv.slice(2)
  const { subcommand, args, flags } = parseArgs(rawArgs)

  // Global flags
  if (flags['version']) {
    console.log(VERSION)
    return
  }

  if (!subcommand) {
    console.log(HELP)
    return
  }

  // Show main help for --help without a subcommand (handled above).
  // Subcommand-specific --help is handled in each case branch below.
  if (flags['help'] && !['create', 'update'].includes(subcommand)) {
    console.log(HELP)
    return
  }

  const workspaceRoot = resolveWorkspaceRoot(
    typeof flags['workspace-root'] === 'string' ? flags['workspace-root'] : undefined
  )
  const asJson = flags['json'] === true

  switch (subcommand) {
    case 'list':
      cmdList(workspaceRoot, asJson)
      break

    case 'get': {
      const id = args[0]
      if (!id) {
        console.error('Usage: craft-agent-batch get <id>')
        process.exit(1)
      }
      cmdGet(workspaceRoot, id)
      break
    }

    case 'validate':
      cmdValidate(workspaceRoot, asJson)
      break

    case 'status': {
      const id = args[0]
      if (!id) {
        console.error('Usage: craft-agent-batch status <id> [--items]')
        process.exit(1)
      }
      const showItems = flags['items'] === true
      cmdStatus(workspaceRoot, id, showItems, asJson)
      break
    }

    case 'create': {
      if (flags['help']) {
        console.log(CREATE_HELP)
        break
      }
      const name = strFlag(flags, 'name')
      const source = strFlag(flags, 'source')
      const idField = strFlag(flags, 'id-field')
      const promptFile = strFlag(flags, 'prompt-file')
      if (!name || !source || !idField || !promptFile) {
        console.error('Missing required flags: --name, --source, --id-field, --prompt-file')
        console.error('Run: craft-agent-batch create --help')
        process.exit(1)
      }
      const prompt = readFileSync(promptFile, 'utf-8').trim()
      if (!prompt) {
        console.error('Prompt file is empty')
        process.exit(1)
      }

      cmdCreate(workspaceRoot, {
        name,
        source,
        idField,
        prompt,
        concurrency: parseConcurrency(flags),
        model: strFlag(flags, 'model'),
        connection: strFlag(flags, 'connection'),
        permissionMode: parsePermissionMode(flags),
        labels: parseLabels(flags),
        workingDirectory: strFlag(flags, 'working-directory'),
        outputPath: strFlag(flags, 'output-path'),
        outputSchema: strFlag(flags, 'output-schema'),
        patch: strFlag(flags, 'patch'),
      }, asJson)
      break
    }

    case 'update': {
      if (flags['help']) {
        console.log(UPDATE_HELP)
        break
      }
      const id = args[0]
      if (!id) {
        console.error('Usage: craft-agent-batch update <id> [flags]')
        console.error('Run: craft-agent-batch update --help')
        process.exit(1)
      }
      const opts = buildUpdateOptions(flags)
      if (!hasUpdateOptions(opts)) {
        console.error('No update flags provided. Use --help to see available flags.')
        process.exit(1)
      }
      cmdUpdate(workspaceRoot, id, opts, asJson)
      break
    }

    case 'enable': {
      const id = args[0]
      if (!id) {
        console.error('Usage: craft-agent-batch enable <id>')
        process.exit(1)
      }
      cmdEnable(workspaceRoot, id, asJson)
      break
    }

    case 'disable': {
      const id = args[0]
      if (!id) {
        console.error('Usage: craft-agent-batch disable <id>')
        process.exit(1)
      }
      cmdDisable(workspaceRoot, id, asJson)
      break
    }

    case 'delete': {
      const id = args[0]
      if (!id) {
        console.error('Usage: craft-agent-batch delete <id>')
        process.exit(1)
      }
      cmdDelete(workspaceRoot, id, asJson)
      break
    }

    default:
      console.error(`Unknown subcommand: ${subcommand}`)
      console.error('')
      console.error('Run: craft-agent-batch --help')
      process.exit(1)
  }
}

main()
