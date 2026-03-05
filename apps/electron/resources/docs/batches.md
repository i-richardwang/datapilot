# Batch Processing Configuration Guide

This guide explains how to configure batch processing in Craft Agent to run actions across large lists of items.

## What Are Batches?

Batches allow you to process a list of items from a data file (CSV, JSON, or JSONL) by executing a prompt action for each item. You can:
- Process hundreds of items with configurable concurrency
- Use template variables to inject item fields into prompts
- Retry failed items automatically
- Pause, resume, and monitor batch progress

## batches.json Location

Batches are configured in `batches.json` at the root of your workspace:

```
~/.craft-agent/workspaces/{workspaceId}/batches.json
```

## Basic Structure

```json
{
  "version": 1,
  "batches": [
    {
      "name": "Process user list",
      "source": {
        "type": "csv",
        "path": "data/users.csv",
        "idField": "user_id"
      },
      "action": {
        "type": "prompt",
        "prompt": "Look up user $BATCH_ITEM_USER_ID and summarise their account status"
      }
    }
  ]
}
```

## Batch Configuration Fields

Each batch in the `batches` array has the following fields:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | No | Unique batch ID (auto-generated if omitted) |
| `name` | string | Yes | Display name for the batch |
| `enabled` | boolean | No | Whether this batch is enabled |
| `source` | object | Yes | Data source configuration |
| `execution` | object | No | Execution settings (concurrency, retries, etc.) |
| `action` | object | Yes | Action to perform for each item |

## Data Sources

The `source` object defines where items are loaded from.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | `"csv"` \| `"json"` \| `"jsonl"` | Yes | File format |
| `path` | string | Yes | Path to the data file (relative to workspace root or absolute) |
| `idField` | string | Yes | Field name used as the unique identifier for each item |

The `idField` must exist in every item and its values must be unique. It is used to track per-item progress and retry state.

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

Use `$BATCH_ITEM_{FIELDNAME}` variables in your prompt to inject item fields. Field names are uppercased.

For a CSV with columns `user_id`, `name`, `email`:

```json
{
  "type": "prompt",
  "prompt": "Create a welcome email for $BATCH_ITEM_NAME at $BATCH_ITEM_EMAIL (account $BATCH_ITEM_USER_ID)"
}
```

The action object also supports optional fields:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `type` | `"prompt"` | Required | Action type |
| `prompt` | string | Required | Prompt template with `$BATCH_ITEM_*` placeholders |
| `labels` | string[] | None | Labels to apply to created sessions |
| `mentions` | string[] | None | @mentions to resolve (sources/skills) |

## Execution Configuration

The optional `execution` object controls how items are processed.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxConcurrency` | number (1-50) | 3 | Maximum number of concurrent sessions |
| `retryOnFailure` | boolean | false | Whether to retry failed items |
| `maxRetries` | number (0-10) | 2 | Maximum retry attempts per item |
| `permissionMode` | `"safe"` \| `"ask"` \| `"allow-all"` | Workspace default | Permission mode for created sessions |
| `model` | string | Workspace default | Model ID for created sessions |
| `llmConnection` | string | Workspace default | LLM connection slug (configured in AI Settings) |

```json
{
  "execution": {
    "maxConcurrency": 5,
    "retryOnFailure": true,
    "maxRetries": 3,
    "permissionMode": "allow-all",
    "llmConnection": "my-copilot-connection",
    "model": "claude-sonnet-4-20250514"
  }
}
```

## Complete Examples

### CSV User Processing

Process a list of users from a CSV file, generating an onboarding summary for each.

```json
{
  "version": 1,
  "batches": [
    {
      "name": "User Onboarding Summaries",
      "source": {
        "type": "csv",
        "path": "data/new-users.csv",
        "idField": "user_id"
      },
      "execution": {
        "maxConcurrency": 5,
        "retryOnFailure": true,
        "maxRetries": 2,
        "permissionMode": "safe"
      },
      "action": {
        "type": "prompt",
        "prompt": "Generate an onboarding summary for user $BATCH_ITEM_NAME ($BATCH_ITEM_EMAIL). Their role is $BATCH_ITEM_ROLE and they joined on $BATCH_ITEM_START_DATE.",
        "labels": ["Batch", "onboarding"]
      }
    }
  ]
}
```

### JSON Report Generation

Generate reports from a JSON array of project records.

```json
{
  "version": 1,
  "batches": [
    {
      "name": "Quarterly Report Generation",
      "source": {
        "type": "json",
        "path": "data/projects.json",
        "idField": "project_id"
      },
      "execution": {
        "maxConcurrency": 3,
        "permissionMode": "allow-all"
      },
      "action": {
        "type": "prompt",
        "prompt": "Generate a quarterly status report for project $BATCH_ITEM_PROJECT_ID ($BATCH_ITEM_TITLE) in the $BATCH_ITEM_REGION region. Include budget analysis and key milestones.",
        "labels": ["Batch", "reports"],
        "mentions": ["@project-docs"]
      }
    }
  ]
}
```

### JSONL Content Translation

Translate content items from a JSONL file into target languages.

```json
{
  "version": 1,
  "batches": [
    {
      "name": "Content Translation",
      "source": {
        "type": "jsonl",
        "path": "data/content-to-translate.jsonl",
        "idField": "content_id"
      },
      "execution": {
        "maxConcurrency": 10,
        "retryOnFailure": true,
        "maxRetries": 3
      },
      "action": {
        "type": "prompt",
        "prompt": "Translate the following text to $BATCH_ITEM_TARGET_LANG. Preserve formatting and tone.\n\nText: $BATCH_ITEM_TEXT",
        "labels": ["Batch", "translation"]
      }
    }
  ]
}
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

Batch state is persisted in `batch-state-{batchId}.json` alongside `batches.json`, so progress survives restarts.

## Validation

Batches are validated using Zod schemas when:
1. The workspace is loaded
2. You edit batches.json
3. You run `config_validate` with target `batches` or `all`

**Using config_validate:**

Ask Craft Agent to validate your batches configuration:

```
Validate my batches configuration
```

Or use the `config_validate` tool directly with `target: "batches"`.

**Common validation errors:**
- Invalid JSON syntax
- Missing required fields (`name`, `source`, `action`)
- Empty `source.path` or `source.idField`
- Empty `action.prompt`
- `maxConcurrency` outside 1-50 range
- `maxRetries` outside 0-10 range
- Invalid `permissionMode` value
- Unsupported `source.type` (must be `csv`, `json`, or `jsonl`)
- Duplicate `idField` values in data source
- Missing `idField` column in data file
