# DataPilot CLI Guide

`datapilot` is the preferred interface for managing workspace config domains such as labels, sources, skills, and automations.

## Usage

```bash
datapilot <entity> <action> [args] [--flags] [--json '<json>'] [--stdin]
```

### Global flags
- `datapilot --help`
- `datapilot --version`
- `datapilot --discover`

### Input modes
- Flat flags for simple values
- `--json` for structured inputs
- `--stdin` for piped JSON object input

---

<!-- cli:label:start -->
## Label

Manage workspace labels stored under `labels/`.

### Commands
- `datapilot label list`
- `datapilot label get <id>`
- `datapilot label create --name "<name>" [--color "<color>"] [--parent-id <id|root>] [--value-type string|number|date]`
- `datapilot label update <id> [--name "<name>"] [--color "<color>"] [--value-type string|number|date|none] [--clear-value-type]`
- `datapilot label delete <id>`
- `datapilot label move <id> --parent <id|root>`
- `datapilot label reorder [--parent <id|root>] <ordered-id-1> <ordered-id-2> ...`
- `datapilot label auto-rule-list <id>`
- `datapilot label auto-rule-add <id> --pattern "<regex>" [--flags "gi"] [--value-template "$1"] [--description "..."]`
- `datapilot label auto-rule-remove <id> --index <n>`
- `datapilot label auto-rule-clear <id>`
- `datapilot label auto-rule-validate <id>`

### Examples

```bash
datapilot label list
datapilot label get bug
datapilot label create --name "Bug" --color "accent"
datapilot label create --name "Priority" --value-type number
datapilot label update bug --json '{"name":"Bug Report","color":"destructive"}'
datapilot label update priority --value-type none
datapilot label move bug --parent root
datapilot label reorder --parent root development content bug
datapilot label auto-rule-add linear-issue --pattern "\\b([A-Z]{2,5}-\\d+)\\b" --value-template "$1"
datapilot label auto-rule-list linear-issue
datapilot label auto-rule-validate linear-issue
```

### Notes
- Use `--json` / `--stdin` for nested or bulk updates.
- IDs are stable slugs generated from name on create.
- Use `--value-type none` or `--clear-value-type` to remove a label value type.
<!-- cli:label:end -->

---

<!-- cli:source:start -->
## Source

Manage workspace sources stored under `sources/{slug}/`.

### Commands
- `datapilot source list [--include-builtins true|false]`
- `datapilot source get <slug>`
- `datapilot source create` (see flags below)
- `datapilot source update <slug> --json '{...}'`
- `datapilot source delete <slug>`
- `datapilot source validate <slug>`
- `datapilot source test <slug>`
- `datapilot source init-guide <slug> [--template generic|mcp|api|local]`
- `datapilot source init-permissions <slug> [--mode read-only]`
- `datapilot source auth-help <slug>`

### Flags for `source create`

| Flag | Description |
|------|-------------|
| `--name "<name>"` | **(required)** Source display name |
| `--provider "<provider>"` | **(required)** Provider identifier (e.g., `linear`, `github`) |
| `--type mcp\|api\|local` | **(required)** Source type |
| `--enabled true\|false` | Enable/disable source (default: `true`) |
| `--icon "<url-or-emoji>"` | Icon URL (auto-downloaded) or emoji |
| **MCP-specific** | |
| `--url "<url>"` | MCP server URL |
| `--transport http\|stdio` | MCP transport type |
| `--auth-type oauth\|bearer\|none` | MCP authentication type |
| **API-specific** | |
| `--base-url "<url>"` | **(required for api)** API base URL (must have trailing slash) |
| `--auth-type bearer\|header\|query\|basic\|none` | **(required for api)** API auth type |
| **Local-specific** | |
| `--path "<path>"` | **(required for local)** Filesystem path |

### Examples

```bash
datapilot source list
datapilot source get linear
# MCP source with flat flags
datapilot source create --name "Linear" --provider "linear" --type mcp --url "https://mcp.linear.app/sse" --auth-type oauth
# MCP source with --json for nested config
datapilot source create --name "Linear" --provider "linear" --type mcp --json '{"mcp":{"transport":"http","url":"https://mcp.linear.app/sse","authType":"oauth"}}'
# API source
datapilot source create --name "Exa" --provider "exa" --type api --base-url "https://api.exa.ai/" --auth-type header
# Local source
datapilot source create --name "Docs Folder" --provider "filesystem" --type local --path "~/Documents"
datapilot source update linear --json '{"enabled":false}'
datapilot source validate linear
datapilot source test linear
datapilot source init-guide linear --template mcp
datapilot source init-permissions linear --mode read-only
datapilot source auth-help linear
```

### Notes
- Use flat flags for simple values or `--json` for type-specific nested config fields (`mcp`, `api`, `local`).
- `init-guide` scaffolds a practical `guide.md` based on source type.
- `init-permissions` scaffolds read-only `permissions.json` patterns for Explore mode.
- `auth-help` returns the recommended in-session auth tool and mode.
- `test` is lightweight CLI validation; for full in-session auth/connection probing use `source_test` MCP tool.
<!-- cli:source:end -->

---

<!-- cli:skill:start -->
## Skill

Manage workspace skills stored under `skills/{slug}/SKILL.md`.

### Commands
- `datapilot skill list [--workspace-only] [--project-root <path>]`
- `datapilot skill get <slug> [--project-root <path>]`
- `datapilot skill where <slug> [--project-root <path>]`
- `datapilot skill create` (see flags below)
- `datapilot skill update <slug> --json '{...}' [--project-root <path>]`
- `datapilot skill delete <slug>`
- `datapilot skill validate <slug> [--source workspace|project|global] [--project-root <path>]`

### Flags for `skill create`

| Flag | Description |
|------|-------------|
| `--name "<name>"` | **(required)** Skill display name |
| `--description "<desc>"` | **(required)** Brief description (1-2 sentences) |
| `--slug "<slug>"` | Custom slug (auto-generated from name if omitted) |
| `--body "..."` | Skill content/instructions (markdown body) |
| `--icon "<url>"` | Icon URL (auto-downloaded to `icon.*`) |
| `--globs "*.ts,*.tsx"` | Comma-separated glob patterns for auto-suggestion |
| `--always-allow "Bash,Write"` | Comma-separated tool names to always allow |
| `--required-sources "linear,github"` | Comma-separated source slugs to auto-enable |

### Examples

```bash
datapilot skill list
datapilot skill list --workspace-only
datapilot skill where commit-helper
datapilot skill create --name "Commit Helper" --description "Generate conventional commits" --slug commit-helper
datapilot skill create --name "Code Review" --description "Review PRs" --globs "*.ts,*.tsx" --always-allow "Bash" --required-sources "github"
datapilot skill update commit-helper --json '{"requiredSources":["github"],"body":"Use concise, imperative commit messages."}'
datapilot skill validate commit-helper
datapilot skill validate commit-helper --source global
datapilot skill delete commit-helper
```

### Notes
- `create` / `update` write `SKILL.md` frontmatter and content body.
- Use `where` to inspect project/workspace/global resolution precedence.
- `--project-root` scopes resolution to a project directory (defaults to cwd).
<!-- cli:skill:end -->

---

<!-- cli:automation:start -->
## Automation

Manage workspace automations stored in `automations.json`.

### Commands
- `datapilot automation list`
- `datapilot automation get <id>`
- `datapilot automation create` (see flags below)
- `datapilot automation update <id>` (same flags as create, all optional)
- `datapilot automation delete <id>`
- `datapilot automation enable <id>`
- `datapilot automation disable <id>`
- `datapilot automation duplicate <id>`
- `datapilot automation history [<id>] [--limit <n>]`
- `datapilot automation last-executed <id>`
- `datapilot automation test <id> [--match "..."]`
- `datapilot automation lint`
- `datapilot automation validate`

### Flags for `automation create` / `update`

| Flag | Description |
|------|-------------|
| `--event <EventName>` | **(required for create)** Event trigger (e.g., `UserPromptSubmit`, `SchedulerTick`, `LabelAdd`) |
| `--name "<name>"` | Display name for the automation |
| `--matcher "<regex>"` | Regex pattern for event matching |
| `--cron "<expression>"` | Cron expression (for `SchedulerTick` events) |
| `--timezone "<tz>"` | IANA timezone (e.g., `Europe/Budapest`) |
| `--permission-mode safe\|ask\|allow-all` | Permission level for created sessions |
| `--enabled true\|false` | Enable/disable the automation |
| `--labels "label1,label2"` | Comma-separated labels for created sessions |
| `--prompt "..."` | Prompt text (creates a prompt action automatically) |
| `--llm-connection "<slug>"` | LLM connection slug for the created session |
| `--model "<model-id>"` | Model ID for the created session |

### Examples

```bash
datapilot automation list
datapilot automation validate
# Simple prompt automation with flat flags
datapilot automation create --event UserPromptSubmit --prompt "Summarize this prompt"
# Scheduled automation with flat flags
datapilot automation create --event SchedulerTick --cron "0 9 * * 1-5" --timezone "Europe/Budapest" --prompt "Give me a morning briefing" --labels "Scheduled" --permission-mode safe
# Complex automation with --json
datapilot automation create --event SchedulerTick --json '{"cron":"0 9 * * 1-5","actions":[{"type":"prompt","prompt":"Daily summary"}]}'
datapilot automation update abc123 --name "Morning Report" --prompt "Updated prompt"
datapilot automation update abc123 --enabled false
datapilot automation enable abc123
datapilot automation duplicate abc123
datapilot automation history abc123 --limit 10
datapilot automation last-executed abc123
datapilot automation test abc123 --match "UserPromptSubmit"
datapilot automation lint
datapilot automation delete abc123
```

### Notes
- Use flat flags for simple automations or `--json` for complex matchers with multiple `actions`.
- `--prompt` is a shortcut that auto-wraps the text as a prompt action. Use `--json` with `actions` for multi-action automations.
- `lint` provides quick matcher/action hygiene checks (regex validity, missing actions, oversized prompt mention sets).
- `history` and `last-executed` read from `automations-history.jsonl` when present.
- `validate` runs full schema and semantic checks.
<!-- cli:automation:end -->

---

<!-- cli:permission:start -->
## Permission

Manage Explore mode permissions stored in `permissions.json` (workspace-level and per-source).

### Commands
- `datapilot permission list`
- `datapilot permission get [--source <slug>]`
- `datapilot permission set [--source <slug>] --json '{...}'`
- `datapilot permission add-mcp-pattern "<pattern>" [--comment "..."] [--source <slug>]`
- `datapilot permission add-api-endpoint --method GET|POST|... --path "<regex>" [--comment "..."] [--source <slug>]`
- `datapilot permission add-bash-pattern "<pattern>" [--comment "..."] [--source <slug>]`
- `datapilot permission add-write-path "<glob>" [--source <slug>]`
- `datapilot permission remove <index> --type mcp|api|bash|write-path|blocked [--source <slug>]`
- `datapilot permission validate [--source <slug>]`
- `datapilot permission reset [--source <slug>]`

### Scope

Without `--source`: operates on workspace-level `permissions.json` (global rules).
With `--source <slug>`: operates on that source's `permissions.json` (auto-scoped).

### Examples

```bash
# List all permissions files (workspace + sources)
datapilot permission list
# Get workspace permissions
datapilot permission get
# Get source-specific permissions
datapilot permission get --source linear
# Add read-only MCP patterns for a source
datapilot permission add-mcp-pattern "list" --comment "List operations" --source linear
datapilot permission add-mcp-pattern "get" --comment "Get operations" --source linear
datapilot permission add-mcp-pattern "search" --comment "Search operations" --source linear
# Add API endpoint rules
datapilot permission add-api-endpoint --method GET --path ".*" --comment "All GET requests" --source stripe
# Add bash patterns
datapilot permission add-bash-pattern "^ls\\s" --comment "Allow ls"
# Add write path globs
datapilot permission add-write-path "/tmp/**"
# Remove a rule by index and type
datapilot permission remove 1 --type mcp --source linear
# Replace entire config
datapilot permission set --source github --json '{"allowedMcpPatterns":[{"pattern":"list","comment":"List ops"}]}'
# Validate all permissions
datapilot permission validate
# Validate source-specific
datapilot permission validate --source linear
# Delete permissions file (revert to defaults)
datapilot permission reset --source linear
```

### Notes
- Source-level MCP patterns are auto-scoped at runtime (e.g., `list` becomes `mcp__<slug>__.*list`).
- `remove` uses 0-based index within the specified rule type array. Use `get` to see indices.
- `validate` runs schema + regex validation. Without `--source`, validates workspace + all sources.
- `reset` deletes the permissions file, reverting to defaults.
<!-- cli:permission:end -->

---

<!-- cli:theme:start -->
## Theme

Manage app-level and workspace-level theme settings.

### Commands
- `datapilot theme get`
- `datapilot theme validate [--preset <id>]`
- `datapilot theme list-presets`
- `datapilot theme get-preset <id>`
- `datapilot theme set-color-theme <id>`
- `datapilot theme set-workspace-color-theme <id|default>`
- `datapilot theme set-override --json '{...}'`
- `datapilot theme reset-override`

### Examples

```bash
# Inspect current theme state
datapilot theme get

# Validate app override file
datapilot theme validate

# Validate one preset file
datapilot theme validate --preset nord

# List available presets
datapilot theme list-presets

# Inspect a specific preset
datapilot theme get-preset dracula

# Set app default preset
datapilot theme set-color-theme nord

# Set workspace override
datapilot theme set-workspace-color-theme dracula

# Clear workspace override (inherit app default)
datapilot theme set-workspace-color-theme default

# Replace app-level theme.json override
datapilot theme set-override --json '{"accent":"oklch(0.62 0.21 293)","dark":{"accent":"oklch(0.68 0.21 293)"}}'

# Remove app-level override file
datapilot theme reset-override
```

### Notes
- `set-color-theme` and `set-workspace-color-theme` require an existing preset ID (`default` is always valid).
- `set-override` validates `theme.json` shape before writing.
- Workspace override is stored in `workspace/config.json` under `defaults.colorTheme`.
- App override is stored in `~/.datapilot/theme.json`.
<!-- cli:theme:end -->

---

<!-- cli:batch:start -->
## Batch

Manage batch processing jobs stored in `batches.json`.

> **Note:** Batch commands use a separate binary `datapilot-batch` (not `datapilot`).
> This binary ships with the `@craft-agent/batch-cli` package and has plain-text output
> (not the JSON envelope format of the main `datapilot` CLI).

### Commands
- `datapilot-batch list`
- `datapilot-batch get <id>`
- `datapilot-batch validate`
- `datapilot-batch status <id> [--items]`
- `datapilot-batch create` (see flags below)
- `datapilot-batch update <id>` (same flags as create, all optional)
- `datapilot-batch enable <id>`
- `datapilot-batch disable <id>`
- `datapilot-batch delete <id>`

### Flags for `batch create` / `update`

| Flag | Description |
|------|-------------|
| `--name "<name>"` | **(required for create)** Display name for the batch |
| `--source <path>` | **(required for create)** Path to data source file (`.csv`, `.json`, or `.jsonl`) |
| `--id-field <field>` | **(required for create)** Field name used as the unique item identifier |
| `--prompt-file <path>` | **(required for create)** Prompt template file with `$BATCH_ITEM_<FIELD>` placeholders |
| `--concurrency <n>` | Max concurrent sessions (default: 3) |
| `--model "<model-id>"` | Model ID for created sessions |
| `--connection "<slug>"` | LLM connection slug |
| `--permission-mode safe\|ask\|allow-all` | Permission level for created sessions |
| `--label "<label>"` | Label to apply to created sessions (repeatable) |
| `--enabled true\|false` | Enable/disable the batch (update only) |
| `--output-path <path>` | Output file path (`.jsonl`) for structured results |
| `--output-schema <json>` | JSON Schema for output validation |
| `--patch <json>` | Raw JSON patch for advanced fields (flags override `--patch` values) |

### Global flags
- `--workspace-root <path>` — Override workspace root (default: auto-detected)
- `--json` — Machine-readable JSON output (for list/get/validate/status)
- `--help`, `--version`

### Examples

```bash
# Read operations (allowed in Explore mode)
datapilot-batch list
datapilot-batch get abc123
datapilot-batch validate
datapilot-batch status abc123
datapilot-batch status abc123 --items

# Create (prompt template in a file)
datapilot-batch create --name "User Analysis" --source data/users.csv --id-field user_id --prompt-file prompt.txt
datapilot-batch create --name "Reports" --source reports.json --id-field report_id --prompt-file prompt.txt --concurrency 5 --permission-mode safe
# Create with structured output
datapilot-batch create --name "Extraction" --source data.csv --id-field id --prompt-file prompt.txt --output-path output/results.jsonl --output-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}'
# Update with flat flags
datapilot-batch update abc123 --name "Renamed Batch" --concurrency 10
datapilot-batch update abc123 --enabled false
# Update with --patch for complex changes
datapilot-batch update abc123 --patch '{"execution":{"retryOnFailure":true,"maxRetries":3}}'
datapilot-batch enable abc123
datapilot-batch disable abc123
datapilot-batch delete abc123
```

### Notes
- `list` shows batch id, name, enabled state, status, and item progress counts.
- `status` displays a progress bar; `--items` adds a per-item breakdown table.
- `update` accepts flags and/or `--patch`. Flags override `--patch` values. The result is deep-merged into the existing config.
- `delete` removes the batch from `batches.json` and cleans up its `batch-state-{id}.json` file.
- `create` infers source type from the file extension (`.csv` → `csv`, `.json` → `json`, `.jsonl` → `jsonl`).
- Workspace root is auto-detected by walking up from CWD looking for `batches.json` or `.datapilot/`.
<!-- cli:batch:end -->

---

## Output contract

All commands return a single JSON envelope on stdout.

### Success
```json
{ "ok": true, "data": {}, "warnings": [] }
```

### Error
```json
{
  "ok": false,
  "error": {
    "code": "USAGE_ERROR",
    "message": "...",
    "suggestion": "..."
  },
  "warnings": []
}
```

Exit codes:
- `0` success
- `1` execution/internal failure
- `2` usage/validation/input failure
