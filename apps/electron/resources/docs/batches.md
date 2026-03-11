# Batch Processing Guide

This guide explains batch processing in Craft Agent — running actions across large lists of items.

> **Always use CLI commands** to manage batches. See [craft-cli.md](./craft-cli.md) for the full command reference.

## CLI Commands

```bash
craft-agent-batch list
craft-agent-batch get <id>
craft-agent-batch validate
craft-agent-batch status <id>
craft-agent-batch status <id> --items
craft-agent-batch create --name "My batch" --source data.csv --id-field id --prompt "Process $BATCH_ITEM_ID"
craft-agent-batch create --name "Extraction" --source data.csv --id-field id --prompt "Extract $BATCH_ITEM_ID" --output-path output/results.jsonl --output-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}'
craft-agent-batch update <id> --name "Renamed" --concurrency 5
craft-agent-batch update <id> --enabled false
craft-agent-batch update <id> --patch '{"execution":{"retryOnFailure":true}}'
craft-agent-batch enable <id>
craft-agent-batch disable <id>
craft-agent-batch delete <id>
```

## What Are Batches?

Batches allow you to process a list of items from a data file (CSV, JSON, or JSONL) by executing a prompt action for each item. You can:
- Process hundreds of items with configurable concurrency
- Use template variables to inject item fields into prompts
- Retry failed items automatically
- Pause, resume, and monitor batch progress

## Data Sources

The `--source` flag points to a data file. Source type is inferred from the file extension.

The `--id-field` must name a field that exists in every item with unique values. It is used to track per-item progress and retry state.

### CSV

Standard CSV with a header row. Quoted fields with commas and escaped quotes are supported.

```csv
user_id,name,email
u001,Alice,alice@example.com
u002,Bob,bob@example.com
```

### JSON

A JSON array of objects.

```json
[
  { "report_id": "r1", "title": "Q1 Sales", "region": "EMEA" },
  { "report_id": "r2", "title": "Q2 Sales", "region": "APAC" }
]
```

### JSONL

One JSON object per line.

```jsonl
{"content_id": "c1", "text": "Hello world", "target_lang": "es"}
{"content_id": "c2", "text": "Good morning", "target_lang": "fr"}
```

## Prompt Templates

Use `$BATCH_ITEM_{FIELDNAME}` placeholders in `--prompt` to inject item fields. Field names are uppercased.

For a CSV with columns `user_id`, `name`, `email`:

```
--prompt "Create a welcome email for $BATCH_ITEM_NAME at $BATCH_ITEM_EMAIL (account $BATCH_ITEM_USER_ID)"
```

Additional action fields (set via `--patch`):
- `mentions` (string[]) — @mentions to resolve (sources/skills), e.g. `--patch '{"action":{"mentions":["project-docs"]}}'`

## Execution Settings

These fields control how items are processed. Common ones have dedicated flags; others can be set via `--patch`.

| Field | CLI flag | Default | Description |
|-------|----------|---------|-------------|
| `maxConcurrency` | `--concurrency <n>` | 3 | Max concurrent sessions (1-50) |
| `model` | `--model <id>` | Workspace default | Model ID for created sessions |
| `llmConnection` | `--connection <slug>` | Workspace default | LLM connection slug |
| `permissionMode` | `--permission-mode` | Workspace default | `safe` \| `ask` \| `allow-all` |
| `retryOnFailure` | `--patch` only | false | Whether to retry failed items |
| `maxRetries` | `--patch` only | 2 | Max retry attempts per item (0-10) |

Example using `--patch` for fields without dedicated flags:

```bash
craft-agent-batch update <id> --patch '{"execution":{"retryOnFailure":true,"maxRetries":3}}'
```

## Output Configuration

Use `--output-path` and `--output-schema` to collect structured results from each batch session. When configured, the `batch_output` tool is automatically available in each session.

### How It Works

1. The `batch_output` tool is made available in each session
2. The prompt is automatically appended with structured output instructions and the schema
3. The agent calls `batch_output` with a `data` parameter containing the result fields
4. Each record is validated against the schema (if provided) before being written
5. Metadata fields `_item_id` and `_timestamp` are injected automatically

### Output File Format (JSONL)

Each line in the output file is a JSON object:

```jsonl
{"_item_id":"u001","_timestamp":"2026-03-06T10:30:00.000Z","summary":"High-value user","risk_level":"low","score":92}
{"_item_id":"u002","_timestamp":"2026-03-06T10:30:05.000Z","summary":"At-risk user","risk_level":"high","score":34}
```

- `_item_id` — The item's unique ID from the data source (auto-injected)
- `_timestamp` — When the output was recorded (auto-injected)
- All other fields are the agent's structured result

### Schema for `--output-schema`

The `--output-schema` flag takes a JSON Schema string with `type: "object"`:

| Property | Type | Description |
|----------|------|-------------|
| `type` | `"object"` | Must be `"object"` |
| `properties` | object | Field definitions with `type`, `description`, and optional `enum` |
| `required` | string[] | List of required field names |

Example:

```bash
craft-agent-batch create --name "User Analysis" --source data/users.csv --id-field user_id \
  --prompt "Analyse user $BATCH_ITEM_USER_ID" \
  --output-path output/user-analysis.jsonl \
  --output-schema '{"type":"object","properties":{"summary":{"type":"string","description":"One-sentence summary"},"risk_level":{"type":"string","enum":["low","medium","high"]},"score":{"type":"number","description":"Risk score 0-100"}},"required":["summary","risk_level"]}'
```

Without `--output-schema`, the agent can output any JSON object (freeform mode).

## Complete Examples

### CSV User Processing with Structured Output

```bash
craft-agent-batch create \
  --name "User Onboarding Summaries" \
  --source data/new-users.csv \
  --id-field user_id \
  --prompt "Generate an onboarding summary for user $BATCH_ITEM_NAME ($BATCH_ITEM_EMAIL). Their role is $BATCH_ITEM_ROLE and they joined on $BATCH_ITEM_START_DATE." \
  --concurrency 5 \
  --permission-mode safe \
  --label "Batch" --label "onboarding" \
  --output-path output/onboarding-summaries.jsonl \
  --output-schema '{"type":"object","properties":{"summary":{"type":"string"},"priority_actions":{"type":"array","items":{"type":"string"}},"onboarding_risk":{"type":"string","enum":["low","medium","high"]}},"required":["summary","onboarding_risk"]}' \
  --patch '{"execution":{"retryOnFailure":true,"maxRetries":2}}'
```

### JSON Report Generation

```bash
craft-agent-batch create \
  --name "Quarterly Report Generation" \
  --source data/projects.json \
  --id-field project_id \
  --prompt "Generate a quarterly status report for project $BATCH_ITEM_PROJECT_ID ($BATCH_ITEM_TITLE) in the $BATCH_ITEM_REGION region. Include budget analysis and key milestones." \
  --concurrency 3 \
  --permission-mode allow-all \
  --label "Batch" --label "reports" \
  --patch '{"action":{"mentions":["project-docs"]}}'
```

### JSONL Content Translation

```bash
craft-agent-batch create \
  --name "Content Translation" \
  --source data/content-to-translate.jsonl \
  --id-field content_id \
  --concurrency 10 \
  --prompt "Translate the following text to $BATCH_ITEM_TARGET_LANG. Preserve formatting and tone.\n\nText: $BATCH_ITEM_TEXT" \
  --label "Batch" --label "translation" \
  --patch '{"execution":{"retryOnFailure":true,"maxRetries":3}}'
```

## Lifecycle

Each batch follows a defined lifecycle:

| Status | Description |
|--------|-------------|
| `pending` | Batch is configured but has not been started |
| `running` | Batch is actively processing items |
| `paused` | Batch has been paused; running items will finish but no new items will start |
| `completed` | All items have been processed successfully |
| `failed` | Batch stopped due to unrecoverable errors |

Individual items within a batch have their own status:

| Status | Description |
|--------|-------------|
| `pending` | Item has not been processed yet |
| `running` | Item is currently being processed in a session |
| `completed` | Item was processed successfully |
| `failed` | Item processing failed (may be retried if configured) |
| `skipped` | Item was skipped |

## Validation

The CLI validates configuration automatically on `create` and `update`. You can also run validation explicitly:

```bash
craft-agent-batch validate
```

Or use the `config_validate` tool with `target: "batches"`.

**Common validation errors:**
- Missing required fields (`name`, `source`, `action`)
- Empty `source.path` or `source.idField`
- Empty `action.prompt`
- `maxConcurrency` outside 1-50 range
- `maxRetries` outside 0-10 range
- Invalid `permissionMode` value
- Unsupported `source.type` (must be `csv`, `json`, or `jsonl`)
- Duplicate `idField` values in data source
- Missing `idField` column in data file

**Output-related warnings:**
- `output.path` does not end with `.jsonl`
- `output.schema.properties` is empty (no fields defined)
