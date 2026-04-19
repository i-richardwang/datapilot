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
- `datapilot label auto-rule-list <id>`
- `datapilot label auto-rule-add <id> --pattern "<regex>" [--flags "gi"] [--value-template "$1"] [--description "..."]`
- `datapilot label auto-rule-remove <id> --index <n>`
- `datapilot label auto-rule-clear <id>`

### Examples

```bash
datapilot label list
datapilot label get bug
datapilot label create --name "Bug" --color "accent"
datapilot label create --name "Priority" --value-type number
datapilot label update bug --input '{"name":"Bug Report","color":"destructive"}'
datapilot label update priority --value-type none
datapilot label auto-rule-add linear-issue --pattern "\\b([A-Z]{2,5}-\\d+)\\b" --value-template "$1"
datapilot label auto-rule-list linear-issue
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
- `datapilot source get <slug>` — returns source with `permissions` and `mcpTools`
- `datapilot source create --name "<name>" --provider "<provider>" --type mcp|api|local [--input '<json>']`
- `datapilot source update <slug> --input '<json>'`
- `datapilot source delete <slug>`
- `datapilot source validate <slug>`
- `datapilot source test <slug>`

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
```

`source get <slug>` returns the source record merged with permissions and MCP tools:

```json
{
  "slug": "linear",
  "name": "Linear",
  "provider": "linear",
  "type": "mcp",
  "permissions": {
    "allowedTools": ["linear_search"],
    "defaultPolicy": "allow"
  },
  "mcpTools": [
    { "name": "linear_search", "permissionStatus": "allowed" }
  ]
}
```

```bash
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
```

### Notes
- `test` is lightweight CLI validation; for full in-session auth/connection probing use the `source_test` MCP tool.
<!-- cli:source:end -->

---

<!-- cli:skill:start -->
## Skill

Manage workspace skills stored under `skills/{slug}/SKILL.md`.

### Commands
- `datapilot skill list`
- `datapilot skill get <slug>`
- `datapilot skill create --name "<name>" --description "<desc>" [--input '<json>']`
- `datapilot skill update <slug> --input '<json>'`
- `datapilot skill delete <slug>`
- `datapilot skill validate <slug>`

### Examples

```bash
datapilot skill list
datapilot skill create --name "Commit Helper" --description "Generate conventional commits"
datapilot skill update commit-helper \
  --input '{"requiredSources":["github"],"body":"Use concise, imperative commit messages."}'
datapilot skill validate commit-helper
datapilot skill delete commit-helper
```

### Notes
- `create` / `update` write `SKILL.md` frontmatter and content body.
<!-- cli:skill:end -->

---

<!-- cli:automation:start -->
## Automation

Manage workspace automations stored in `automations.json`.

### Commands
- `datapilot automation list`
- `datapilot automation get <id>`
- `datapilot automation create --event <EventName> --name "<name>" [--input '<json>']`
- `datapilot automation update <id> [--input '<json>']`
- `datapilot automation delete <id>`
- `datapilot automation enable <id>`
- `datapilot automation disable <id>`
- `datapilot automation history <id> [--limit <n>]`
- `datapilot automation test [--input '<json>']`
- `datapilot automation replay <id>`
- `datapilot automation validate`

### Examples

```bash
datapilot automation list
datapilot automation validate

# Simple prompt automation
datapilot automation create --event UserPromptSubmit --name "Summarize" \
  --input '{"actions":[{"type":"prompt","prompt":"Summarize this prompt"}]}'

# Scheduled automation with nested config via --input
datapilot automation create --event SchedulerTick --name "Daily Summary" \
  --input '{"cron":"0 9 * * 1-5","actions":[{"type":"prompt","prompt":"Daily summary"}]}'

datapilot automation update abc123 --input '{"enabled":false}'
datapilot automation enable abc123
datapilot automation history abc123 --limit 10
datapilot automation test --input '{"automationId":"abc123","actions":[{"type":"prompt","prompt":"Test"}]}'
datapilot automation delete abc123
```

### Notes
- `--name` is required for `create` (or pass it inside `--input`); use `--input` with `actions` for multi-action automations.
- `validate` checks the workspace `automations.json` schema; it takes no input flags.
<!-- cli:automation:end -->

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
- `datapilot batch status <id>`
- `datapilot batch state <id>`
- `datapilot batch items <id>`
- `datapilot batch validate`
- `datapilot batch test <id> [--sample-size <n>]`
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
- `test` runs a dry-run against a batch with optional sample size; pull the result back with `test-result`.
- `delete` removes the batch from `batches.json` and cleans up its `batch-state-{id}.json`.
<!-- cli:batch:end -->

---

<!-- cli:session:start -->
## Session

Manage sessions inside a workspace. This entity is request/response.

### Commands
- `datapilot session list`
- `datapilot session get <id>`
- `datapilot session create [--name "..."] [--mode safe|ask|allow-all] [--source <slug> ...] [--input '<json>']`
- `datapilot session delete <id>`
- `datapilot session messages <id>`
- `datapilot session send <id> <message-text...>`
- `datapilot session cancel <id>`
- `datapilot session set-model <id> <model> [--connection <slug>]`
- `datapilot session get-files <id>`
- `datapilot session share <id>`
- `datapilot session share-html <file> --session <id>`

### Permission mode default

`session create` defaults to `--mode allow-all` when neither `--mode` nor
`--input '{"permissionMode":"..."}'` is supplied. The CLI is invoked by agents
running without a human to confirm `ask` prompts, so `allow-all` is the only
mode that does not stall the session. Pass `--mode safe`, `--mode ask`, or
set `permissionMode` via `--input` to override. Electron UI sessions keep
their own `ask` default — this fallback lives only in the CLI layer.

### Examples

```bash
datapilot session list
# --mode omitted → session starts in allow-all
datapilot session create --name "Daily standup" --source linear --source github
# explicit override
datapilot session create --name "Audit" --mode safe
datapilot session send sess-abc "Summarize today's open PRs"
datapilot session cancel sess-abc
datapilot session share sess-abc
datapilot session share-html ./report.html --session sess-abc
```
<!-- cli:session:end -->

---

<!-- cli:workspace:start -->
## Workspace

Query workspace metadata (the top-level container for sources, labels,
sessions, etc.).

### Commands
- `datapilot workspace list`
- `datapilot workspace get [<id>]`

### Examples

```bash
datapilot workspace list
datapilot workspace get ws-abc123
```

### Response

The `workspace get` command returns the workspace record enriched with
permissions and settings:

```json
{
  "id": "ws-abc123",
  "name": "My Workspace",
  "permissions": {
    "admins": ["user-1"],
    "members": ["user-2"]
  },
  "settings": {
    "theme": "dark",
    "language": "zh"
  }
}
```
<!-- cli:workspace:end -->

---

<!-- cli:server:start -->
## Server

Read-only introspection of a running datapilot server.

### Commands
- `datapilot server status`

### Examples

```bash
datapilot server status
```

### Response

Returns workspace runtime snapshot containing only the `workspaces` array:

```json
{
  "workspaces": [
    {
      "id": "ws-abc123",
      "name": "My Workspace",
      "slug": "my-workspace",
      "activeSessions": 3,
      "automationCount": 5,
      "schedulerRunning": true
    }
  ]
}
```
<!-- cli:server:end -->


