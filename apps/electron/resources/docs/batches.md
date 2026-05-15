# Batch Processing Guide

Batches run a prompt action across a list of items from a CSV / JSON / JSONL data file — each item spawns its own session, results can be collected into a structured JSONL output file.

> **CLI-first workflow (recommended):** Use `datapilot batch ...` commands instead of editing `batches.json` directly.
> - `datapilot batch --help`
> - Canonical command reference: [datapilot-cli.md](./datapilot-cli.md)

## Storage

```
~/.datapilot/workspaces/{workspaceId}/batches.json
```

Per-batch runtime state lives alongside as `batch-state-{id}.json`.

## Configuration

A batch config is a single JSON object. Build it as a file and submit via `--stdin`:

```json
// config.json
{
  "source": { "type": "csv", "path": "data/users.csv", "idField": "user_id" },
  "action": {
    "type": "prompt",
    "prompt": "Generate an onboarding summary for $BATCH_ITEM_NAME ($BATCH_ITEM_EMAIL)."
  },
  "execution": { "maxConcurrency": 5, "permissionMode": "safe", "retryOnFailure": true },
  "output": {
    "path": "output/onboarding.jsonl",
    "schema": {
      "type": "object",
      "properties": {
        "summary": { "type": "string" },
        "risk": { "type": "string", "enum": ["low", "medium", "high"] }
      },
      "required": ["summary", "risk"]
    }
  }
}
```

```bash
cat config.json | datapilot batch create --name "Onboarding" --stdin
```

For configs with multi-line prompts or non-ASCII text, build the JSON with a JSON-aware tool — `python3 -c json.dumps` or `jq -n`:

```bash
python3 -c '
import json
print(json.dumps({
  "source": {"type":"csv","path":"data/users.csv","idField":"user_id"},
  "action": {"type":"prompt","prompt":"Multi-line content with \"quotes\" and 中文..."},
  "output": {"path":"output/results.jsonl","schema":{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}},
}, ensure_ascii=False))
' | datapilot batch create --name "Onboarding" --stdin

# Or keep prompt in a separate file and inject with jq
jq -n --arg p "$(cat prompt.md)" \
  --argjson src '{"type":"csv","path":"data/users.csv","idField":"user_id"}' \
  --argjson schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}' \
  '{source:$src, action:{type:"prompt",prompt:$p}, output:{path:"output/results.jsonl",schema:$schema}}' \
  | datapilot batch create --name "Onboarding" --stdin
```

## Data Sources

`source.path` is on the server filesystem (use `datapilot workspace get`'s `connection.sameMachine` to check whether local absolute paths are reachable). `source.idField` must be unique across items — it tracks per-item progress and retry state.

```csv
user_id,name,email
u001,Alice,alice@example.com
u002,Bob,bob@example.com
```

```json
[
  { "report_id": "r1", "title": "Q1 Sales", "region": "EMEA" }
]
```

```jsonl
{"content_id": "c1", "text": "Hello world", "target_lang": "es"}
```

Field names must be ASCII (letters / numbers / underscores) — non-ASCII keys won't expand into prompt placeholders.

## Prompt Templates

`action.prompt` is the literal prompt string. Use `$BATCH_ITEM_{FIELDNAME}` placeholders (uppercase) to inject item fields:

```
Create a welcome email for $BATCH_ITEM_NAME at $BATCH_ITEM_EMAIL (account $BATCH_ITEM_USER_ID)
```

Optional `action` fields: `mentions` (string[], @-resolves sources/skills), `labels` (string[], applied to spawned sessions).

## Output

When `output.path` is set, the `batch_output` tool becomes available inside each session and the schema is appended to the prompt. Each line in the JSONL output gets `_item_id` and `_timestamp` injected automatically.

Without `output.schema`, any JSON object is accepted. Without `output` entirely, results live only in the spawned sessions.

## Lifecycle

`batch create` only saves the config — the batch stays at `pending` until `datapilot batch start <id>` is called (or the user starts it from the UI).

```bash
datapilot batch start  <id>
datapilot batch pause  <id>      # paused is non-terminal
datapilot batch resume <id>
datapilot batch delete <id>      # no cancelled state — delete to abort

datapilot batch get   <id> | jq .data.progress.status
datapilot batch items <id> | jq '.data.items[] | {id, status: .state.status, sessionId: .state.sessionId}'
datapilot batch retry-item <id> <item-id>
```

## Testing

`datapilot batch test <id> [--sample-size N]` runs the same pipeline on a deterministic random sample (default 3 items), writes to `{output.path}.test.jsonl`, and tracks state in `batch-state-{id}__test.json`. The call blocks until sampled items complete and returns per-item results plus the test output path.

The full output file at `{output.path}.test.jsonl` is the source of truth for evaluating prompt and schema quality before committing the full run.
