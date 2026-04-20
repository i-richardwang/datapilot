# DataPilot CLI Guide

`dtpilot` is the agent-facing CLI for the DataPilot server. Every command is a
thin client: it speaks WebSocket RPC to a running server and prints the
server's response. There is no direct file or SQLite access from the CLI —
all writes flow through the same handler layer the desktop app uses.

## Usage

```bash
dtpilot [global-flags] <entity> <action> [positionals...] [flags...]
```

Every command follows the `<entity> <action>` shape. Run `dtpilot` with no
arguments (or `dtpilot <entity>` with no action) to discover the available
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

### Input rule

One rule, no exceptions: **identity goes flat, data goes JSON.**

- `create` accepts flat flags only for `--name` (identity) and
  **schema-branch selectors** that decide which other fields are valid —
  `--event` (automation), `--provider` and `--type` (source). Every other
  field — `color`, `parentId`, `valueType`, `description`, `permissionMode`,
  `enabledSourceSlugs`, matcher rules, etc. — goes through
  `--input '<json>'` or `--stdin`.
- `update` is strictly `<id>` + `--input '<json>'`. No data flat flags.
- `enable`, `disable`, `start`, `pause`, `resume`, `cancel`, `delete` take
  a positional id only.
- Read-side query params (`--limit`, `--offset`, `--sample-size`, `--index`,
  `--session`) stay as flat flags — they describe *how to read*, not what
  the entity *is*.

Anything not in that list gets rejected with `USAGE_ERROR` and a hint at the
`--input` JSON key. Passing both `--input` and a flat identity flag is fine;
flat flags win on conflict.

> **Breaking change note (0.1.0-phase3+):** Several flat data flags that
> previously worked (`label create --color`, `label update --name`,
> `label auto-rule-add --pattern`, `skill create --slug`, `skill create
> --description`, `session create --mode`, `session create --source`) now
> fail fast. Move the value to `--input '{"<jsonKey>":"..."}'`.

### Input modes

- **Flat flags** for identity (`--name`) and schema-branch selectors
  (`--event`, `--provider`, `--type`).
- **`--input '<json>'`** for every data field.
- **`--stdin`** to read a JSON object from piped stdin (same semantics as
  `--input`).

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
- `dtpilot label list`
- `dtpilot label get <id>` — returns label with `autoRules`
- `dtpilot label create --name "<name>" [--input '<json>']` — data fields (`color`, `parentId`, `valueType`) go in `--input`
- `dtpilot label update <id> --input '<json>'`
- `dtpilot label delete <id>`
- `dtpilot label auto-rule-add <id> --input '<json>'` — rule fields (`pattern`, `flags`, `valueTemplate`, `description`) go in `--input`
- `dtpilot label auto-rule-remove <id> --index <n>`

### Examples

```bash
dtpilot label list
dtpilot label get bug

# Identity flat, data via --input
dtpilot label create --name "Bug" --input '{"color":"accent"}'
dtpilot label create --name "Priority" --input '{"valueType":"number"}'

# Update is strictly <id> + --input
dtpilot label update bug --input '{"name":"Bug Report","color":"destructive"}'
dtpilot label update priority --input '{"valueType":"none"}'

# Auto-rules: pattern is data, lives in --input
dtpilot label auto-rule-add linear-issue \
  --input '{"pattern":"\\b([A-Z]{2,5}-\\d+)\\b","valueTemplate":"$1"}'
dtpilot label auto-rule-remove linear-issue --index 0
```

### Notes
- IDs are stable slugs generated from the name on create.
- Pass `"valueType":"none"` inside `--input` to clear a label's value type.
<!-- cli:label:end -->

---

<!-- cli:source:start -->
## Source

Manage workspace sources stored under `sources/{slug}/`.

### Commands
- `dtpilot source list`
- `dtpilot source get <slug>` — returns source with `permissions` and `mcpTools`
- `dtpilot source create --name "<name>" --provider "<provider>" --type mcp|api|local [--input '<json>']`
- `dtpilot source update <slug> --input '<json>'`
- `dtpilot source delete <slug>`

### Required fields for `source create`

| Flat flag | Why flat | Description |
|-------|----------|-------------|
| `--name` | identity | Source display name |
| `--provider` | schema-branch | Provider identifier (e.g., `linear`, `github`, `generic`) |
| `--type` | schema-branch | `mcp`, `api`, or `local` — picks which nested config is valid |

Type-specific fields (e.g. MCP `transport` / `url` / `authType`, API `baseUrl`,
local `path`) live under nested keys passed via `--input`.

### Examples

```bash
dtpilot source list
dtpilot source get linear
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
dtpilot source create --name "Linear" --provider "linear" --type mcp \
  --input '{"mcp":{"transport":"http","url":"https://mcp.linear.app/sse","authType":"oauth"}}'

# API source
dtpilot source create --name "Exa" --provider "exa" --type api \
  --input '{"api":{"baseUrl":"https://api.exa.ai/","authType":"header"}}'

# Local source
dtpilot source create --name "Docs Folder" --provider "filesystem" --type local \
  --input '{"local":{"path":"~/Documents"}}'

dtpilot source update linear --input '{"enabled":false}'
```
<!-- cli:source:end -->

---

<!-- cli:skill:start -->
## Skill

Manage workspace skills stored under `skills/{slug}/SKILL.md`.

### Commands
- `dtpilot skill list`
- `dtpilot skill get <slug>`
- `dtpilot skill create --name "<name>" --input '<json>'` — `description` (required), `body`, `globs`, `requiredSources`, `alwaysAllow`, and an optional explicit `slug` live in `--input`
- `dtpilot skill update <slug> --input '<json>'`
- `dtpilot skill delete <slug>`

### Examples

```bash
dtpilot skill list

# Name is identity; everything else (including required `description`) via --input.
# Slug is auto-derived from the name — pass `"slug":"..."` in --input to override.
dtpilot skill create --name "Commit Helper" \
  --input '{"description":"Generate conventional commits"}'

dtpilot skill update commit-helper \
  --input '{"requiredSources":["github"],"body":"Use concise, imperative commit messages."}'
dtpilot skill delete commit-helper
```

### Notes
- `create` / `update` write `SKILL.md` frontmatter and content body.
- The server derives `slug` from `name` when not provided (see
  `packages/server-core/src/handlers/rpc/skills.ts:145`).
<!-- cli:skill:end -->

---

<!-- cli:automation:start -->
## Automation

Manage workspace automations stored in `automations.json`.

### Commands
- `dtpilot automation list`
- `dtpilot automation get <id>`
- `dtpilot automation create --event <EventName> --name "<name>" --input '<json>'`
- `dtpilot automation update <id> --input '<json>'`
- `dtpilot automation delete <id>`
- `dtpilot automation enable <id>`
- `dtpilot automation disable <id>`
- `dtpilot automation history <id> [--limit <n>]`
- `dtpilot automation test [--input '<json>']`

### Examples

```bash
dtpilot automation list

# Simple prompt automation
dtpilot automation create --event UserPromptSubmit --name "Summarize" \
  --input '{"actions":[{"type":"prompt","prompt":"Summarize this prompt"}]}'

# Scheduled automation with nested config via --input
dtpilot automation create --event SchedulerTick --name "Daily Summary" \
  --input '{"cron":"0 9 * * 1-5","actions":[{"type":"prompt","prompt":"Daily summary"}]}'

dtpilot automation update abc123 --input '{"enabled":false}'
dtpilot automation enable abc123
dtpilot automation history abc123 --limit 10
dtpilot automation test --input '{"automationId":"abc123","actions":[{"type":"prompt","prompt":"Test"}]}'
dtpilot automation delete abc123
```

### Notes
- `--name` is required for `create` (or pass it inside `--input`); use `--input` with `actions` for multi-action automations.
<!-- cli:automation:end -->

---

<!-- cli:batch:start -->
## Batch

Manage batch processing jobs stored in `batches.json`.

### Commands
- `dtpilot batch list`
- `dtpilot batch get <id>` — returns batch with `progress`
- `dtpilot batch create --name "<name>" [--input '<json>']`
- `dtpilot batch update <id> --input '<json>'`
- `dtpilot batch delete <id>`
- `dtpilot batch start <id>`
- `dtpilot batch pause <id>`
- `dtpilot batch resume <id>`
- `dtpilot batch items <id> [--offset <n>] [--limit <n>]`
- `dtpilot batch test <id> [--sample-size <n>]`
- `dtpilot batch retry-item <batch-id> <item-id>`

### Examples

```bash
dtpilot batch list
dtpilot batch get abc123

# Create — most fields live under --input
dtpilot batch create --name "User Analysis" \
  --input '{"source":"data/users.csv","idField":"user_id","promptFile":"prompt.txt"}'

dtpilot batch update abc123 \
  --input '{"execution":{"retryOnFailure":true,"maxRetries":3}}'

dtpilot batch start abc123
dtpilot batch items abc123

# Paginated — skip first 20, fetch next 10
dtpilot batch items abc123 --offset 20 --limit 10

# Retry one failed item; the batch transitions paused → in_progress on resume
dtpilot batch retry-item abc123 item-42
dtpilot batch resume abc123

dtpilot batch delete abc123
```

### Notes
- `items` returns the per-item breakdown, supporting `--offset` (default 0) and `--limit` (default 100) for pagination. Use `batch get` for progress information.
- `test` runs a dry-run against a batch with optional sample size and returns the result directly.
- `delete` removes the batch from `batches.json` and cleans up its `batch-state-{id}.json`.
<!-- cli:batch:end -->

---

<!-- cli:session:start -->
## Session

Manage sessions inside a workspace. This entity is request/response.

### Commands
- `dtpilot session list`
- `dtpilot session get <id>`
- `dtpilot session create [--name "..."] [--input '<json>']` — `permissionMode` and `enabledSourceSlugs` go in `--input`
- `dtpilot session delete <id>`
- `dtpilot session messages <id>`
- `dtpilot session send <id> <message-text...>`
- `dtpilot session cancel <id>`
- `dtpilot session share <id>`
- `dtpilot session share <id> --html <file>`

### Permission mode default

`session create` defaults `permissionMode` to `allow-all` when neither the
flat `--name` nor `--input '{"permissionMode":"..."}'` supplies one. The CLI
is invoked by agents running without a human to confirm `ask` prompts, so
`allow-all` is the only mode that does not stall the session. Override via
`--input '{"permissionMode":"safe"}'` (or `"ask"`). Electron UI sessions keep
their own `ask` default — this fallback lives only in the CLI layer.

### Examples

```bash
dtpilot session list

# permissionMode omitted → session starts in allow-all
dtpilot session create --name "Daily standup" \
  --input '{"enabledSourceSlugs":["linear","github"]}'

# explicit override
dtpilot session create --name "Audit" --input '{"permissionMode":"safe"}'

dtpilot session send sess-abc "Summarize today's open PRs"
dtpilot session cancel sess-abc
dtpilot session share sess-abc
dtpilot session share sess-abc --html ./report.html
```
<!-- cli:session:end -->

---

<!-- cli:workspace:start -->
## Workspace

Query workspace metadata (the top-level container for sources, labels,
sessions, etc.).

### Commands
- `dtpilot workspace list`
- `dtpilot workspace get [<id>]`

### Examples

```bash
dtpilot workspace list
dtpilot workspace get ws-abc123
```

### Response

The `workspace get` command returns the workspace record enriched with settings:

```json
{
  "id": "ws-abc123",
  "name": "My Workspace",
  "settings": {
    "theme": "dark",
    "language": "zh"
  }
}
```
<!-- cli:workspace:end -->

