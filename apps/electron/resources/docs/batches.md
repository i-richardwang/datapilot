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
craft-agent-batch create --name "My batch" --source data.csv --id-field id --prompt-file prompt.txt
craft-agent-batch create --name "Extraction" --source data.csv --id-field id --prompt-file prompt.txt --output-path output/results.jsonl --output-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}'
craft-agent-batch update <id> --name "Renamed" --concurrency 5
craft-agent-batch update <id> --enabled false
craft-agent-batch update <id> --patch '{"execution":{"retryOnFailure":true}}'
craft-agent-batch retry <id> <item-id>
craft-agent-batch enable <id>
craft-agent-batch disable <id>
craft-agent-batch delete <id>
```

## What Are Batches?

Batches allow you to process a list of items from a data file (CSV, JSON, or JSONL) by executing a prompt action for each item. You can:
- Process hundreds of items with configurable concurrency
- Use template variables to inject item fields into prompts
- Retry failed items automatically or manually via CLI
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

Write your prompt template to a file and pass it via `--prompt-file`. Use `$BATCH_ITEM_{FIELDNAME}` placeholders to inject item fields. Field names are uppercased.

**Field naming requirement:** All field names in the data source must use ASCII characters only (letters, numbers, underscores). For example: `user_id`, `name`, `email`. If your source data has non-ASCII field names (e.g. Chinese), rename them to English before use.

```
# prompt.txt
Create a welcome email for $BATCH_ITEM_NAME at $BATCH_ITEM_EMAIL (account $BATCH_ITEM_USER_ID)
```

```bash
craft-agent-batch create --name "Onboarding" --source users.csv --id-field user_id --prompt-file prompt.txt
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
| `retryOnFailure` | `--patch` only | false | Automatically retry failed items |
| `maxRetries` | `--patch` only | 2 | Max automatic retry attempts per item (0-10) |

Example using `--patch` for fields without dedicated flags:

```bash
craft-agent-batch update <id> --patch '{"execution":{"retryOnFailure":true,"maxRetries":3}}'
```

To manually retry a specific failed item without restarting the entire batch:

```bash
craft-agent-batch status <id> --items    # find failed items
craft-agent-batch retry <id> <item-id>   # reset to pending
```

If the batch has already completed or failed, `retry` sets it to `paused` — the user resumes the batch to re-execute the item.

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
  --prompt-file prompt.txt \
  --output-path output/user-analysis.jsonl \
  --output-schema '{"type":"object","properties":{"summary":{"type":"string","description":"One-sentence summary"},"risk_level":{"type":"string","enum":["low","medium","high"]},"score":{"type":"number","description":"Risk score 0-100"}},"required":["summary","risk_level"]}'
```

Without `--output-schema`, the agent can output any JSON object (freeform mode).

## Complete Examples

### CSV User Processing with Structured Output

```
# prompt.txt
Generate an onboarding summary for user $BATCH_ITEM_NAME ($BATCH_ITEM_EMAIL).
Their role is $BATCH_ITEM_ROLE and they joined on $BATCH_ITEM_START_DATE.
```

```bash
craft-agent-batch create \
  --name "User Onboarding Summaries" \
  --source data/new-users.csv \
  --id-field user_id \
  --prompt-file prompt.txt \
  --concurrency 5 \
  --permission-mode safe \
  --label "Batch" --label "onboarding" \
  --output-path output/onboarding-summaries.jsonl \
  --output-schema '{"type":"object","properties":{"summary":{"type":"string"},"priority_actions":{"type":"array","items":{"type":"string"}},"onboarding_risk":{"type":"string","enum":["low","medium","high"]}},"required":["summary","onboarding_risk"]}' \
  --patch '{"execution":{"retryOnFailure":true,"maxRetries":2}}'
```

### JSON Report Generation

```
# prompt.txt
Generate a quarterly status report for project $BATCH_ITEM_PROJECT_ID ($BATCH_ITEM_TITLE)
in the $BATCH_ITEM_REGION region. Include budget analysis and key milestones.
```

```bash
craft-agent-batch create \
  --name "Quarterly Report Generation" \
  --source data/projects.json \
  --id-field project_id \
  --prompt-file prompt.txt \
  --concurrency 3 \
  --permission-mode allow-all \
  --label "Batch" --label "reports" \
  --patch '{"action":{"mentions":["project-docs"]}}'
```

### JSONL Content Translation

```
# prompt.txt
Translate the following text to $BATCH_ITEM_TARGET_LANG. Preserve formatting and tone.

Text: $BATCH_ITEM_TEXT
```

```bash
craft-agent-batch create \
  --name "Content Translation" \
  --source data/content-to-translate.jsonl \
  --id-field content_id \
  --concurrency 10 \
  --prompt-file prompt.txt \
  --label "Batch" --label "translation" \
  --patch '{"execution":{"retryOnFailure":true,"maxRetries":3}}'
```

## Testing Batches

Before running a full batch, always test with a random sample to validate your prompt, output schema, and result quality.

### How to Test

Use the `batch_test` tool to run a random sample:

- `batchId` (required): The batch ID to test
- `sampleSize` (optional): Number of random items (default: 3)

The test runs real sessions with the same configuration as production, but:
- Only processes a random sample of items
- Writes output to a separate file: `{output-path}.test.jsonl` (e.g., `results.test.jsonl`)
- State tracked separately in `batch-state-{id}__test.json`
- Does not affect production batch state or output

### Test Result

`batch_test` blocks until all sampled items complete and returns a JSON result:

- `status` — `"completed"` or `"failed"`
- `sampleSize` — Number of items tested
- `durationMs` — Total test duration
- `items` — Array of per-item results, each with `itemId`, `status`, `error` (if failed), and `sessionId`
- `outputPath` — Path to the test output file (use this to read structured results)

### Iterative Workflow

1. Create the batch configuration using CLI
2. Call `batch_test` to run a sample
3. **Review** the results (see Review Checklist below)
4. If issues found, update the prompt or schema using CLI (`craft-agent-batch update`)
5. Repeat steps 2-4 until satisfied
6. Tell the user the batch is ready — the user starts the full batch from the UI

### Review Checklist

After each test run, read the test output file (path from `outputPath` in the test result) and review across three dimensions:

#### 1. Execution — Did each item run correctly?

- Did all items complete, or did some fail? Read errors to understand why.
- Did the agent follow the prompt instructions? Look for signs of misinterpretation or ignored requirements.
- If there are failures or misinterpretations, the **prompt wording** likely needs to be clearer or more specific.

#### 2. Task Design — Is the task well-defined?

- **Schema completeness**: Are there fields that should be added or removed? Are required fields truly required?
- **Enum/category quality**: For classification tasks, do the categories cover all cases without overlap (MECE)? Would the agent struggle to pick between categories for an ambiguous item?
- **Granularity**: Is the output too coarse (losing useful detail) or too fine (creating noise)?
- **Assumptions**: Does the prompt assume something that may not hold for all items in the full dataset?

If the structure or definitions need adjusting, update the schema or prompt via CLI.

#### 3. Output Quality — Is the content good enough?

- **Accuracy**: Are the results factually correct and well-grounded in the input data?
- **Consistency**: Do similar items produce similar quality results, or is there high variance?
- **Specificity**: Are results substantive and specific to each item, or generic and templated?
- **Edge cases**: Do items with unusual data (empty fields, long text, special characters) produce reasonable results?

If content quality is poor despite clear instructions and good schema, consider adding examples, constraints, or evaluation criteria to the prompt.

### Test Output

Test output uses the same JSONL format as production output. Read the `.test.jsonl` file (path from `outputPath`) to inspect structured results for each sampled item.

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
| `failed` | Item processing failed (retried automatically if `retryOnFailure` is enabled, or manually via `craft-agent-batch retry`) |
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
