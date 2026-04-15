# SQLite Migration & DataPilot CLI

> 存储迁移架构与 CLI 实现的设计参考文档。
> 合并操作请查阅 [FORK_MERGE_GUIDE.md](FORK_MERGE_GUIDE.md)。
>
> **Last updated after:** DataPilot CLI implementation + prompt fixes

## Overview

两个紧密耦合的变更：

1. **SQLite Storage Migration** — Labels、sources、statuses、views、session data、automation history 从独立 JSON 文件迁移到 per-workspace `workspace.db`（Drizzle ORM）。消除竞态条件，支持事务写入，为关系查询提供基础。

2. **DataPilot CLI** (`packages/craft-cli/`) — `datapilot` 二进制，60 个子命令覆盖所有配置操作。存储迁移后，CLI 是 agent 管理配置的**唯一路径**（SQLite 数据库不支持直接文件编辑）。

---

## Storage Migration Details

### What Moved to SQLite

| Domain | Old Storage | New Storage | Schema File |
|--------|-----------|-------------|-------------|
| **Labels** | `labels/config.json` | `workspace.db` → `label_config` | `db/schema/labels.sql.ts` |
| **Sources** | `sources/{slug}/config.json` + `guide.md` | `workspace.db` → `sources` | `db/schema/sources.sql.ts` |
| **Statuses** | `statuses/config.json` | `workspace.db` → `status_config` | `db/schema/statuses.sql.ts` |
| **Views** | `views.json` | `workspace.db` → `view_config` | `db/schema/views.sql.ts` |
| **Sessions** | `sessions/{id}.json` | `workspace.db` → `sessions` | `db/schema/sessions.sql.ts` |
| **Automation History** | `automations-history.jsonl` | `workspace.db` → `automation_history` | `db/schema/automations.sql.ts` |

### What Remains File-Based

| Domain | Storage | Why |
|--------|---------|-----|
| **Automations config** | `automations.json` | Complex nested structure; agent-editable via CLI |
| **Skills** | `skills/{slug}/SKILL.md` | Markdown with YAML frontmatter; human-readable format |
| **Permissions** | `permissions.json` | Small JSON; agent-editable via CLI |
| **Themes** | `~/.datapilot/theme.json` | App-level config, not workspace-scoped |
| **Workspace config** | `config.json` | Top-level metadata |
| **Source icons** | `sources/{slug}/icon.*` | Binary files |

### Key Architecture Decisions

**Drizzle ORM + dynamic driver registration:**
- `autoRegisterDriver()` auto-detects runtime (Bun native SQLite vs better-sqlite3)
- `getWorkspaceDb(workspaceRootPath)` returns a cached Drizzle instance per workspace
- Migrations run automatically on first connection

**Drop-in replacement pattern:**
- Each migrated module has `storage.db.ts` with identical exported function signatures
- Legacy files renamed to `storage.legacy.ts` (kept for reference, not imported)
- `package.json` subpath exports point to `.db.ts` files

**Event system:**
- `dbEvents` emitter (`db/events.ts`) fires on data changes: `label:config`, `source:saved`, `session:saved`, etc.
- UI and watchers subscribe to events instead of filesystem polling

### Impact on Agents

**Before migration:** Agents could directly read/write JSON config files.

**After migration:** Direct file edits on SQLite-backed domains have **no effect**. The database is the sole source of truth. This is not "prefer CLI" — it's "CLI is the only way."

---

## CLI Implementation

### Package Structure

```
packages/craft-cli/
├── package.json                    # bin: { "datapilot": "src/index.ts" }
├── tsconfig.json
└── src/
    ├── index.ts                    # Entry: shebang, arg parsing, entity routing
    ├── workspace.ts                # Workspace root resolution
    ├── envelope.ts                 # JSON envelope: ok(data), fail(code, msg)
    ├── input.ts                    # --json / --stdin input parsing
    ├── db-init.ts                  # autoRegisterDriver() wrapper
    ├── args.ts                     # parseArgs, strFlag, listFlag helpers
    └── commands/
        ├── label.ts                # 12 subcommands
        ├── source.ts               # 10 subcommands
        ├── automation.ts           # 13 subcommands
        ├── batch.ts                # 8 subcommands
        ├── skill.ts                # 7 subcommands
        ├── permission.ts           # 10 subcommands
        └── theme.ts                # 8 subcommands
```

### Command Coverage (7 entities)

| Entity | Subcommands | Storage Backend |
|--------|------------|-----------------|
| **label** | list, get, create, update, delete, move, reorder, auto-rule-list/add/remove/clear/validate | SQLite |
| **source** | list, get, create, update, delete, validate, test, init-guide, init-permissions, auth-help | SQLite |
| **automation** | list, get, create, update, delete, enable, disable, duplicate, history, last-executed, test, lint, validate | File (config) + SQLite (history) |
| **batch** | list, get, create, update, delete, validate, status, retry | File (config) |
| **skill** | list, get, where, create, update, delete, validate | File (SKILL.md) |
| **permission** | list, get, set, add-mcp-pattern, add-api-endpoint, add-bash-pattern, add-write-path, remove, validate, reset | File (permissions.json) |
| **theme** | get, validate, list-presets, get-preset, set-color-theme, set-workspace-color-theme, set-override, reset-override | File (theme.json) |

### Output Contract

All commands return a JSON envelope on stdout:

```json
// Success (exit 0)
{ "ok": true, "data": { ... }, "warnings": [] }

// Error (exit 1 for NOT_FOUND/VALIDATION_ERROR/INTERNAL_ERROR, exit 2 for USAGE_ERROR)
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "..." }, "warnings": [] }
```

### Feature Flag

`FEATURE_FLAGS.craftAgentsCli` (default: `true`) controls:

| Mechanism | What It Does |
|-----------|-------------|
| System prompt CLI section | Tells agent to use `datapilot` CLI (mandatory, not optional) |
| PreToolUse file redirect | Hard-blocks Write/Edit on config files, returns CLI command suggestion |
| PreToolUse bash guard | Hard-blocks bash operations on guarded paths |
| Bash pattern allowlist | Allows `datapilot` read commands in Explore mode |

### Specification Document

`apps/electron/resources/docs/datapilot-cli.md` — 475-line canonical reference. Agent reads this doc via doc reference table in system prompt.

---

## Dependencies

### Runtime

| Package | Used By | Purpose |
|---------|---------|---------|
| `drizzle-orm` | `packages/shared` | ORM for SQLite queries |
| `bun:sqlite` / `better-sqlite3` | `packages/shared/src/db/driver.ts` | SQLite driver (auto-detected) |

### Cross-Module

- `packages/craft-cli/` → `@craft-agent/shared` (workspace dependency)
- All CLI commands import from `@craft-agent/shared/` subpaths
- `db-init.ts` calls `autoRegisterDriver()` before any command execution

---

## Docker Considerations

- **`better-sqlite3` native build:** Requires `python3`/`make`/`g++`, but Docker runs Bun which uses built-in `bun:sqlite`. Native binary never loaded at runtime.
- **`--ignore-scripts` flag:** `Dockerfile.server` uses `bun install --frozen-lockfile --ignore-scripts` to skip native compilation.
- **`packages/craft-cli`:** Dockerfile includes `COPY packages/craft-cli/package.json` line.
