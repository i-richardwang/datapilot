# DataPilot CLI Guide

`datapilot` is the agent-facing CLI for the DataPilot server. Every command is a
thin client: it speaks WebSocket RPC to a running server and prints the
server's response. There is no direct file or SQLite access from the CLI —
all writes flow through the same handler layer the desktop app uses.

## Usage

```bash
datapilot [global-flags] <entity> <action> [positionals...] [flags...]
```

Every command follows the `<entity> <action>` shape. Run `datapilot` with no
arguments (or `datapilot <entity>` with no action) to discover the available
entities/actions.

### Global flags

| Flag | Description |
|------|-------------|
| `--url <ws-url>` | Server URL (default: `ws://127.0.0.1:9100`, env: `DATAPILOT_SERVER_URL`) |
| `--token <secret>` | Bearer token (env: `DATAPILOT_SERVER_TOKEN`, or discovery file) |
| `--workspace <id>` | Workspace ID (auto-detected from the server if omitted) |
| `--timeout <ms>` | Per-request timeout (default: `30000`) |
| `--tls-ca <path>` | Custom CA cert for self-signed `wss://` (env: `DATAPILOT_TLS_CA`) |
| `--json` | Force JSON envelope output (default for non-TTY stdout) |
| `--human` | Force human-readable output (default for TTY stdout) |
| `--help`, `-h` | Show help (entity-aware) |
| `--version`, `-v` | Print CLI version |

### Input modes

Per-action input is provided one of three ways (combine flat flags + structured
input freely; flat flags override fields parsed from `--input`):

- **Flat flags** for simple values, e.g. `--name "Bug" --color accent`
- **`--input '<json>'`** for nested or bulk fields
- **`--stdin`** to read a JSON object from piped stdin

## Output contract

All commands print a single JSON envelope on stdout (or human-readable text
when stdout is a TTY and `--json` is not forced).

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
- `1` execution / internal failure (incl. transport failures)
- `2` usage / validation / input failure

`events tail` streams one JSON object per line instead of a single envelope.

---

<!-- cli:label:start -->
## Label

Manage workspace labels.

### Commands
- `datapilot label list`
- `datapilot label get <id>`
- `datapilot label create --name "<name>" [--color "<color>"] [--parent-id <id|root>] [--value-type string|number|date]`
- `datapilot label update <id> [--name "<name>"] [--color "<color>"] [--value-type string|number|date|none]`
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
datapilot label update bug --input '{"name":"Bug Report","color":"destructive"}'
datapilot label update priority --value-type none
datapilot label move bug --parent root
datapilot label reorder --parent root development content bug
datapilot label auto-rule-add linear-issue --pattern "\\b([A-Z]{2,5}-\\d+)\\b" --value-template "$1"
datapilot label auto-rule-list linear-issue
datapilot label auto-rule-validate linear-issue
```

### Notes
- IDs are stable slugs generated from the name on create.
- Use `--value-type none` to clear a label's value type.
<!-- cli:label:end -->

---

<!-- cli:source:start -->
## Source

Manage workspace sources stored under `sources/{slug}/`.

### Commands
- `datapilot source list`
- `datapilot source get <slug>`
- `datapilot source create --name "<name>" --provider "<provider>" --type mcp|api|local [--input '<json>']`
- `datapilot source update <slug> --input '<json>'`
- `datapilot source delete <slug>`
- `datapilot source validate <slug>`
- `datapilot source test <slug>`
- `datapilot source init-guide <slug>`
- `datapilot source init-permissions <slug>`
- `datapilot source auth-help <slug>`
- `datapilot source save-credentials <slug> --credential <value>`
- `datapilot source get-permissions <slug>`
- `datapilot source get-mcp-tools <slug>`

### Required fields for `source create`

| Field | Description |
|-------|-------------|
| `--name` | Source display name |
| `--provider` | Provider identifier (e.g., `linear`, `github`, `generic`) |
| `--type` | `mcp`, `api`, or `local` |

Type-specific fields (e.g. MCP `transport` / `url` / `authType`, API `baseUrl`,
local `path`) live under nested keys passed via `--input`.

### Examples

```bash
datapilot source list
datapilot source get linear

# MCP source — nested config via --input
datapilot source create --name "Linear" --provider "linear" --type mcp \
  --input '{"mcp":{"transport":"http","url":"https://mcp.linear.app/sse","authType":"oauth"}}'

# API source
datapilot source create --name "Exa" --provider "exa" --type api \
  --input '{"api":{"baseUrl":"https://api.exa.ai/","authType":"header"}}'

# Local source
datapilot source create --name "Docs Folder" --provider "filesystem" --type local \
  --input '{"local":{"path":"~/Documents"}}'

datapilot source update linear --input '{"enabled":false}'
datapilot source validate linear
datapilot source test linear
datapilot source init-guide linear
datapilot source init-permissions linear
datapilot source auth-help linear
```

### Notes
- `init-guide` scaffolds a starter `guide.md`.
- `init-permissions` scaffolds read-only `permissions.json` patterns for Explore mode.
- `auth-help` returns the recommended in-session auth tool and mode.
- `test` is lightweight CLI validation; for full in-session auth/connection probing use the `source_test` MCP tool.
<!-- cli:source:end -->

---

<!-- cli:skill:start -->
## Skill

Manage workspace skills stored under `skills/{slug}/SKILL.md`.

### Commands
- `datapilot skill list`
- `datapilot skill get <slug>`
- `datapilot skill where <slug>`
- `datapilot skill files <slug>`
- `datapilot skill create --name "<name>" --description "<desc>" [--input '<json>']`
- `datapilot skill update <slug> --input '<json>'`
- `datapilot skill delete <slug>`
- `datapilot skill validate <slug>`

### Examples

```bash
datapilot skill list
datapilot skill where commit-helper
datapilot skill create --name "Commit Helper" --description "Generate conventional commits"
datapilot skill update commit-helper \
  --input '{"requiredSources":["github"],"body":"Use concise, imperative commit messages."}'
datapilot skill validate commit-helper
datapilot skill files commit-helper
datapilot skill delete commit-helper
```

### Notes
- `create` / `update` write `SKILL.md` frontmatter and content body.
- `where` reports project/workspace/global resolution precedence.
- `files` lists the skill's files (icon, attachments, etc.).
<!-- cli:skill:end -->

---

<!-- cli:automation:start -->
## Automation

Manage workspace automations stored in `automations.json`.

### Commands
- `datapilot automation list`
- `datapilot automation get <id>`
- `datapilot automation create --event <EventName> [--prompt "..."] [--input '<json>']`
- `datapilot automation update <id> [--input '<json>']`
- `datapilot automation delete <id>`
- `datapilot automation enable <id>`
- `datapilot automation disable <id>`
- `datapilot automation duplicate <id>`
- `datapilot automation history [<id>] [--limit <n>]`
- `datapilot automation last-executed <id>`
- `datapilot automation test <id> [--match "..."]`
- `datapilot automation replay <id> --execution-id <eid>`
- `datapilot automation lint`
- `datapilot automation validate`

### Examples

```bash
datapilot automation list
datapilot automation validate

# Simple prompt automation
datapilot automation create --event UserPromptSubmit --prompt "Summarize this prompt"

# Scheduled automation with nested config via --input
datapilot automation create --event SchedulerTick \
  --input '{"cron":"0 9 * * 1-5","actions":[{"type":"prompt","prompt":"Daily summary"}]}'

datapilot automation update abc123 --input '{"enabled":false}'
datapilot automation enable abc123
datapilot automation duplicate abc123
datapilot automation history abc123 --limit 10
datapilot automation last-executed abc123
datapilot automation test abc123 --match "UserPromptSubmit"
datapilot automation lint
datapilot automation delete abc123
```

### Notes
- `--prompt` is a shortcut that wraps the text as a prompt action; use `--input` with `actions` for multi-action automations.
- `lint` runs hygiene checks (regex validity, missing actions, oversized prompt mention sets).
- `history` and `last-executed` read from `automations-history.jsonl` when present.
<!-- cli:automation:end -->

---

<!-- cli:permission:start -->
## Permission

Manage Explore-mode permissions in `permissions.json` (workspace-level and
per-source).

### Commands
- `datapilot permission list`
- `datapilot permission get [--source <slug>]`
- `datapilot permission set [--source <slug>] --input '<json>'`
- `datapilot permission add-mcp-pattern "<pattern>" [--comment "..."] [--source <slug>]`
- `datapilot permission add-api-endpoint --method GET|POST|... --path "<regex>" [--comment "..."] [--source <slug>]`
- `datapilot permission add-bash-pattern "<pattern>" [--comment "..."] [--source <slug>]`
- `datapilot permission add-write-path "<glob>" [--source <slug>]`
- `datapilot permission remove <index> --type mcp|api|bash|write-path|blocked [--source <slug>]`
- `datapilot permission validate [--source <slug>]`
- `datapilot permission reset [--source <slug>]`
- `datapilot permission defaults`

### Scope

Without `--source`: operates on workspace-level `permissions.json`.
With `--source <slug>`: operates on that source's `permissions.json`
(auto-scoped at runtime).

### Examples

```bash
datapilot permission list
datapilot permission get
datapilot permission get --source linear
datapilot permission add-mcp-pattern "list" --comment "List operations" --source linear
datapilot permission add-api-endpoint --method GET --path ".*" --comment "All GET" --source stripe
datapilot permission add-bash-pattern "^ls\\s" --comment "Allow ls"
datapilot permission add-write-path "/tmp/**"
datapilot permission remove 1 --type mcp --source linear
datapilot permission set --source github \
  --input '{"allowedMcpPatterns":[{"pattern":"list","comment":"List ops"}]}'
datapilot permission validate
datapilot permission validate --source linear
datapilot permission reset --source linear
datapilot permission defaults
```

### Notes
- Source-level MCP patterns are auto-scoped at runtime (e.g., `list` becomes `mcp__<slug>__.*list`).
- `remove` uses 0-based index within the specified rule type array. Use `get` to see indices.
- `defaults` returns the built-in baseline permission set.
<!-- cli:permission:end -->

---

<!-- cli:theme:start -->
## Theme

Manage app-level and workspace-level theme settings.

### Commands
- `datapilot theme get`
- `datapilot theme list-presets`
- `datapilot theme load-preset <id>`
- `datapilot theme get-color`
- `datapilot theme set-color <preset-id>`
- `datapilot theme get-workspace-color`
- `datapilot theme set-workspace-color [<preset-id|null>]`
- `datapilot theme list-workspace-themes`
- `datapilot theme set-override --input '<json>'`
- `datapilot theme reset-override`
- `datapilot theme validate [--theme <id> | --input '<json>']`

### Examples

```bash
datapilot theme get
datapilot theme list-presets
datapilot theme load-preset dracula
datapilot theme set-color nord
datapilot theme set-workspace-color dracula
# Clear workspace override (inherit app default)
datapilot theme set-workspace-color
datapilot theme set-override --input '{"accent":"oklch(0.62 0.21 293)"}'
datapilot theme reset-override
datapilot theme validate --theme nord
```

### Notes
- Color presets must exist; `default` is always valid for `set-workspace-color`.
- `set-override` validates `theme.json` shape before writing.
- App override lives in `~/.datapilot/theme.json`; workspace overrides live under the workspace folder.
<!-- cli:theme:end -->

---

<!-- cli:batch:start -->
## Batch

Manage batch processing jobs stored in `batches.json`.

### Commands
- `datapilot batch list`
- `datapilot batch get <id>`
- `datapilot batch create --name "<name>" [--input '<json>']`
- `datapilot batch update <id> --input '<json>'`
- `datapilot batch delete <id>`
- `datapilot batch start <id>`
- `datapilot batch pause <id>`
- `datapilot batch resume <id>`
- `datapilot batch duplicate <id>`
- `datapilot batch status <id>`
- `datapilot batch state <id>`
- `datapilot batch items <id>`
- `datapilot batch validate [--input '<json>']`
- `datapilot batch test --input '<json>'`
- `datapilot batch test-result <test-id>`
- `datapilot batch retry-item <batch-id> <item-id>`

### Examples

```bash
datapilot batch list
datapilot batch get abc123
datapilot batch validate

# Create — most fields live under --input
datapilot batch create --name "User Analysis" \
  --input '{"source":"data/users.csv","idField":"user_id","promptFile":"prompt.txt"}'

datapilot batch update abc123 \
  --input '{"execution":{"retryOnFailure":true,"maxRetries":3}}'

datapilot batch start abc123
datapilot batch status abc123
datapilot batch items abc123

# Retry one failed item; the batch transitions paused → in_progress on resume
datapilot batch retry-item abc123 item-42
datapilot batch resume abc123

datapilot batch delete abc123
```

### Notes
- `status` returns counts/state summary; `state` returns the persisted batch-state document.
- `items` returns the per-item breakdown.
- `test` runs a dry-run against a payload supplied via `--input`; pull the result back with `test-result`.
- `delete` removes the batch from `batches.json` and cleans up its `batch-state-{id}.json`.
<!-- cli:batch:end -->

---

<!-- cli:session:start -->
## Session

Manage sessions inside a workspace. Streaming output (live deltas, tool calls)
is exposed via `events tail`; this entity is request/response.

### Commands
- `datapilot session list`
- `datapilot session get <id>`
- `datapilot session create [--name "..."] [--mode safe|ask|allow-all] [--source <slug> ...] [--input '<json>']`
- `datapilot session delete <id>`
- `datapilot session messages <id>`
- `datapilot session send <id> <message-text...>`
- `datapilot session cancel <id>`
- `datapilot session get-model <id>`
- `datapilot session set-model <id> <model> [--connection <slug>]`
- `datapilot session unread-summary`
- `datapilot session mark-all-read`
- `datapilot session get-files <id>`
- `datapilot session get-notes <id>`
- `datapilot session set-notes <id> [--notes "..."]`
- `datapilot session export <id>`
- `datapilot session share <id>`

### Examples

```bash
datapilot session list
datapilot session create --name "Daily standup" --mode safe --source linear --source github
datapilot session send sess-abc "Summarize today's open PRs"
datapilot session cancel sess-abc
datapilot session export sess-abc
datapilot session share sess-abc
```
<!-- cli:session:end -->

---

<!-- cli:workspace:start -->
## Workspace

Manage workspaces themselves (the top-level container for sources, labels,
sessions, etc.).

### Commands
- `datapilot workspace list`
- `datapilot workspace get [<id>]`
- `datapilot workspace create <path> [--name "<name>"]`
- `datapilot workspace check-slug <slug>`
- `datapilot workspace update-remote <id> --input '<json>'`
- `datapilot workspace switch <id>`
- `datapilot workspace permissions [<id>]`
- `datapilot workspace settings [<id>]`
- `datapilot workspace set-settings [<id>] --input '<json>'`

### Examples

```bash
datapilot workspace list
datapilot workspace create ~/work/team-ws --name "Team"
datapilot workspace switch ws-abc123
datapilot workspace settings ws-abc123
datapilot workspace set-settings ws-abc123 --input '{"defaultMode":"ask"}'
```
<!-- cli:workspace:end -->

---

<!-- cli:server:start -->
## Server

Local-server lifecycle. `start` runs in the foreground and writes a discovery
file; other actions talk to a running server.

### Commands
- `datapilot server start [--port <n>] [--host <addr>] [--server-entry <path>]`
- `datapilot server stop`
- `datapilot server health`
- `datapilot server status`
- `datapilot server versions`
- `datapilot server endpoint`
- `datapilot server home-dir`

### Examples

```bash
datapilot server start --port 9100
datapilot server health
datapilot server status
datapilot server endpoint
datapilot server stop
```

### Notes
- `start` blocks until SIGINT/SIGTERM; backgrounding (`--detach`) is not yet supported — wrap with `nohup` / a service supervisor.
- `endpoint` resolves the URL/token without connecting (useful for scripting).
<!-- cli:server:end -->

---

<!-- cli:events:start -->
## Events

Subscribe to push events from the server. Default channel is `session:event`.

### Commands
- `datapilot events tail [--channel <name>] [--session <id>]`

### Examples

```bash
# Tail session events for the current workspace
datapilot events tail

# Tail label-change events
datapilot events tail --channel labels:changed

# Filter to a specific session
datapilot events tail --session sess-abc
```

### Notes
- Output is newline-delimited JSON (`{channel, args, ts}`) on non-TTY stdout; compact human-readable lines on TTY.
- The command runs until interrupted (Ctrl+C).
<!-- cli:events:end -->
