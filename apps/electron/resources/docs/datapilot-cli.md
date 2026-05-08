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
| `--workspace <id\|slug\|name>` | Workspace identifier (env: `DATAPILOT_WORKSPACE`; auto-detected from the server if omitted) |
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

## Output contract

JSON envelope on stdout (`{ok, data?, error?, warnings}`); switches to human-readable text on a TTY unless `--json` forces JSON. Error envelopes carry `error.code` (`USAGE_ERROR`, `VALIDATION_ERROR`, `NOT_FOUND`, `CONNECTION_ERROR`, `INTERNAL_ERROR`) and an optional `error.suggestion`. Exit codes: `0` success, `1` execution / internal failure, `2` usage / validation / input failure.

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

Type-specific config (MCP `transport`/`url`/`authType`, API `baseUrl`, local `path`) goes nested under `--input`.

### Examples

```bash
dtpilot source list
dtpilot source get linear

# MCP source — nested config via --input
dtpilot source create --name "Linear" --provider "linear" --type mcp \
  --input '{"mcp":{"transport":"http","url":"https://mcp.linear.app/sse","authType":"oauth"}}'

# API source
dtpilot source create --name "Exa" --provider "exa" --type api \
  --input '{"api":{"baseUrl":"https://api.exa.ai/","authType":"header","headerName":"x-api-key"}}'

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
- The server derives `slug` from `name` when not provided.
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
- `dtpilot automation test <id>`

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
dtpilot automation test abc123
dtpilot automation delete abc123
```
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

# Create — `source` and `action` are nested objects (see batches.md for full schema)
dtpilot batch create --name "User Analysis" \
  --input '{"source":{"type":"csv","path":"data/users.csv","idField":"user_id"},"action":{"type":"prompt","prompt":"Summarize $BATCH_ITEM_NAME"}}'

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
- `items` only returns per-item state; for overall progress call `batch get`.
<!-- cli:batch:end -->

---

<!-- cli:session:start -->
## Session

Manage sessions inside a workspace. This entity is request/response.

### Commands
- `dtpilot session list [--status <id>] [--label <name>] [--search <text>] [--sort recent|name|status] [--limit <n>] [--offset <n>]` — server-side filter/sort/paginate; default `--limit 20`, max 100
- `dtpilot session get <id>` — returns the curated 10-field shape (id, name, labels, status, permissionMode, createdAt, workingDirectory, llmConnection, model, isActive)
- `dtpilot session create [--name "..."] [--input '<json>']` — `permissionMode` and `enabledSourceSlugs` go in `--input`
- `dtpilot session delete <id>`
- `dtpilot session messages <id>`
- `dtpilot session send <id> [<message-text...>] [--input '<json>']` — message via positional or `--input.message`; `--input.skillSlugs` loads skills for that turn
- `dtpilot session cancel <id>`
- `dtpilot session share <id>`
- `dtpilot session share <id> --html <file>`

### Examples

```bash
dtpilot session list
dtpilot session list --status todo --sort name --limit 50
dtpilot session list --label urgent --search "weekly report"

dtpilot session get sess-abc
# → { id, name, labels[], status, permissionMode, createdAt,
#     workingDirectory?, llmConnection?, model?, isActive }

dtpilot session create --name "Daily standup" \
  --input '{"enabledSourceSlugs":["linear","github"]}'
dtpilot session create --name "Audit" --input '{"permissionMode":"safe"}'

dtpilot session send sess-abc "Summarize today's open PRs"

# Load specific skills for this turn
dtpilot session send sess-abc "Run the audit" \
  --input '{"skillSlugs":["security-audit"]}'

dtpilot session cancel sess-abc
dtpilot session share sess-abc
dtpilot session share sess-abc --html ./report.html
```

### Notes
- `session list` returns `{ total, returned, sessions: [{id, name, labels, status, createdAt}] }`. Pagination is server-side — don't fetch everything and slice client-side on large workspaces.
- `session list --label` accepts a single label (only the first is honored if repeated).
- `session create` defaults `permissionMode` to `allow-all` when not set — `ask` would stall a non-interactive CLI. Override with `--input '{"permissionMode":"safe"}'` (or `"ask"`).
<!-- cli:session:end -->

---

<!-- cli:workspace:start -->
## Workspace

Query workspace metadata (the top-level container for sources, labels,
sessions, etc.).

### Commands
- `dtpilot workspace list`
- `dtpilot workspace get [<id|slug|name>]` — returns the workspace record merged with `settings` and `connection` info

### Examples

```bash
dtpilot workspace list
dtpilot workspace get my-workspace
```
<!-- cli:workspace:end -->

---

<!-- cli:status:start -->
## Status

Workspace session statuses (Todo, In Progress, Done, ...).

### Commands
- `dtpilot status list`
- `dtpilot status get <id>`
- `dtpilot status create --name "<label>" --category open|closed [--input '<json>']` — `color`, `icon` go in `--input`
- `dtpilot status update <id> --input '<json>'`
- `dtpilot status delete <id>`
- `dtpilot status reorder --ids <id1,id2,...>` — replaces the full order

### Examples

```bash
dtpilot status list
dtpilot status create --name "Needs Review" --category open --input '{"color":"#f59e0b","icon":"eye"}'
dtpilot status update needs-review --input '{"color":"#fbbf24"}'
dtpilot status reorder --ids todo,in-progress,needs-review,done
```

### Notes
- IDs are stable slugs generated from the `--name` (label) on create.
- `category` controls whether sessions in this status show in the inbox (`open`) or archive (`closed`).
<!-- cli:status:end -->

---

<!-- cli:preference:start -->
## Preference

User-level preferences (name, timezone, location, notes, language, `includeCoAuthoredBy`).

### Commands
- `dtpilot preference get`
- `dtpilot preference update --input '<json>'`

### Examples

```bash
dtpilot preference get

dtpilot preference update --input '{"name":"Alex","timezone":"Asia/Shanghai"}'

# Clear a key by passing null; omitting the key keeps the existing value
dtpilot preference update --input '{"timezone":null}'
```

### Notes
- Top-level `null` clears that key; empty string `""` is stored as-is and is *not* the same as cleared.
- Nested objects (`location`) shallow-merge with the stored value.
<!-- cli:preference:end -->

