# SQLite Migration & DataPilot CLI Guide

> Records the storage migration from JSON files to SQLite and the DataPilot CLI implementation on branch `feature/sqlite-storage`.
> Purpose: track what changed, why, and what to watch during future merges with upstream/main.
>
> **Last updated after:** datapilot CLI implementation + prompt fixes

## Overview

This branch introduces two tightly coupled changes:

1. **SQLite Storage Migration** — Labels, sources, statuses, views, and session data moved from individual JSON files to a per-workspace `workspace.db` SQLite database (via Drizzle ORM). Automation history also moved to SQLite. This eliminates race conditions, enables transactional writes, and provides a foundation for relational queries.

2. **DataPilot CLI** (`packages/craft-cli/`) — A `datapilot` binary that exposes all configuration operations as CLI commands. Required because the storage migration broke the old system prompt strategy of guiding agents to edit JSON files directly. With data in SQLite, CLI is now the **only** path for agents to manage configuration.

These changes are complementary: the CLI exists because of the migration, and the migration's benefits are only fully realized when agents use the CLI instead of direct file access.

---

## Storage Migration Details

### What Moved to SQLite

| Domain | Old Storage | New Storage | Schema File |
|--------|-----------|-------------|-------------|
| **Labels** | `labels/config.json` | `workspace.db` → `label_config` table | `db/schema/labels.sql.ts` |
| **Sources** | `sources/{slug}/config.json` + `guide.md` | `workspace.db` → `sources` table | `db/schema/sources.sql.ts` |
| **Statuses** | `statuses/config.json` | `workspace.db` → `status_config` table | `db/schema/statuses.sql.ts` |
| **Views** | `views.json` | `workspace.db` → `view_config` table | `db/schema/views.sql.ts` |
| **Sessions** | `sessions/{id}.json` | `workspace.db` → `sessions` table | `db/schema/sessions.sql.ts` |
| **Automation History** | `automations-history.jsonl` | `workspace.db` → `automation_history` table | `db/schema/automations.sql.ts` |

### What Remains File-Based

| Domain | Storage | Why |
|--------|---------|-----|
| **Automations config** | `automations.json` | Complex nested YAML/JSON structure; agent-editable via CLI |
| **Skills** | `skills/{slug}/SKILL.md` | Markdown with YAML frontmatter; human-readable format is valuable |
| **Permissions** | `permissions.json` + `sources/*/permissions.json` | Small JSON files; agent-editable via CLI |
| **Themes** | `~/.datapilot/theme.json` + `themes/*.json` | App-level config; not workspace-scoped |
| **Workspace config** | `config.json` | Top-level workspace metadata |
| **Source icons** | `sources/{slug}/icon.*` | Binary files remain on filesystem |

### Key Architecture Decisions

**Drizzle ORM + dynamic driver registration:**
- `autoRegisterDriver()` auto-detects runtime (Bun native SQLite vs better-sqlite3)
- `getWorkspaceDb(workspaceRootPath)` returns a cached Drizzle instance per workspace
- Migrations run automatically on first connection

**Drop-in replacement pattern:**
- Each migrated module has a `storage.db.ts` with identical exported function signatures to the original `storage.ts`
- Legacy files renamed to `storage.legacy.ts` (kept for reference, not imported)
- `package.json` subpath exports point to `.db.ts` files: `"./labels/storage.db": "./src/labels/storage.db.ts"`

**Event system:**
- `dbEvents` emitter (`db/events.ts`) fires on data changes: `label:config`, `source:saved`, `session:saved`, etc.
- UI and watchers subscribe to these events instead of filesystem polling

### Impact on Agents

**Before migration:** Agents could (and were instructed to) directly read/write JSON config files.

**After migration:** Direct file edits on SQLite-backed domains have **no effect** — the database is the sole source of truth. The old JSON files don't even exist on disk. This is not a "prefer CLI" situation; it's "CLI is the only way."

---

## Craft CLI Implementation

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
        ├── skill.ts                # 7 subcommands
        ├── permission.ts           # 10 subcommands
        └── theme.ts                # 8 subcommands
```

### Command Coverage (60 subcommands total)

| Entity | Subcommands | Storage Backend |
|--------|------------|-----------------|
| **label** | list, get, create, update, delete, move, reorder, auto-rule-list, auto-rule-add, auto-rule-remove, auto-rule-clear, auto-rule-validate | SQLite |
| **source** | list, get, create, update, delete, validate, test, init-guide, init-permissions, auth-help | SQLite |
| **automation** | list, get, create, update, delete, enable, disable, duplicate, history, last-executed, test, lint, validate | File (config) + SQLite (history) |
| **skill** | list, get, where, create, update, delete, validate | File (SKILL.md) |
| **permission** | list, get, set, add-mcp-pattern, add-api-endpoint, add-bash-pattern, add-write-path, remove, validate, reset | File (permissions.json) |
| **theme** | get, validate, list-presets, get-preset, set-color-theme, set-workspace-color-theme, set-override, reset-override | File (theme.json, config.json) |

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
| PreToolUse bash guard | Hard-blocks bash operations on guarded paths (labels/, automations.json, etc.) |
| Bash pattern allowlist | Allows `datapilot` read commands in Explore mode |

Override: `CRAFT_FEATURE_CRAFT_AGENTS_CLI=0` to disable all guards (for debugging only).

### Specification Document

`apps/electron/resources/docs/craft-cli.md` — 475-line canonical reference. Agent reads this doc (via doc reference table in system prompt) before using CLI commands.

---

## Modified Files (vs main branch)

### New Files (Low Conflict Risk)

| Location | Description |
|----------|-------------|
| `packages/craft-cli/` | Entire package: 12 source files |
| `packages/shared/src/db/` | Database module: driver, connection, events, schema definitions |
| `packages/shared/src/db/schema/` | Table schemas: labels, sources, statuses, views, sessions, automations |
| `packages/shared/src/labels/storage.db.ts` | SQLite label storage (replaces storage.ts) |
| `packages/shared/src/sources/storage.db.ts` | SQLite source storage (replaces storage.ts) |
| `packages/shared/src/statuses/storage.db.ts` | SQLite status storage (replaces storage.ts) |
| `packages/shared/src/views/storage.db.ts` | SQLite view storage (replaces storage.ts) |
| `packages/shared/src/sessions/storage.db.ts` | SQLite session storage (replaces storage.ts) |
| `packages/shared/src/automations/history-store.db.ts` | SQLite automation history (replaces history-store.ts) |
| `packages/shared/src/workspaces/storage.db.ts` | SQLite workspace storage additions |
| `apps/electron/resources/docs/craft-cli.md` | CLI specification document |

### Modified Upstream Files (Conflict Zones)

#### HIGH Risk

| File | Change |
|------|--------|
| `packages/shared/package.json` | Added 10+ subpath exports for `.db.ts` files, `./db`, `./db/schema`, `./db/events`, `./agent/permissions-config` |
| `packages/shared/src/feature-flags.ts` | `craftAgentsCli` default changed from `false` to `true`; comment updated |
| `packages/shared/src/prompts/system.ts` | CLI section changed from "Prefer CLI" to mandatory "You MUST use"; mini agent prompt rewritten to reference CLI instead of JSON files |

#### MEDIUM Risk

| File | Change |
|------|--------|
| `packages/shared/src/labels/index.ts` | Re-exports now point to `storage.db.ts` |
| `packages/shared/src/sources/index.ts` | Re-exports now point to `storage.db.ts` |
| `packages/shared/src/config/cli-domains.ts` | Contains guard policies for all 7 CLI domains |
| `packages/shared/src/agent/core/pre-tool-use.ts` | Config file guards and bash guards for CLI domains |
| `packages/shared/src/agent/permissions-config.ts` | `shouldCompileBashPattern()` checks `craftAgentsCli` flag |

#### LOW Risk

| File | Change |
|------|--------|
| `packages/shared/src/__tests__/feature-flags.test.ts` | Test expectation updated: `craftAgentsCli` defaults to `true` |
| `apps/electron/resources/permissions/default.json` | Added `datapilot` read-only bash patterns |

---

## Merge Strategy Checklist

When merging upstream updates into this branch:

1. **If upstream changes label/source/status/view storage:** Our `.db.ts` files completely replace the upstream `.ts` storage files. Take upstream's type changes but keep our storage implementation. Check if new fields were added to types — they need corresponding schema columns.

2. **If upstream changes `package.json` exports:** Preserve all our `.db.ts` subpath exports and the `./db`, `./db/schema`, `./db/events` entries.

3. **If upstream changes system prompt (`system.ts`):** Our CLI section must remain mandatory ("MUST use"), not soft ("Prefer"). Check that the mini agent prompt still references CLI commands, not JSON file paths.

4. **If upstream changes PreToolUse pipeline:** Preserve the config domain bash guard and CLI redirect steps. Verify `CliFeatureFlags` integration remains intact.

5. **If upstream adds new config domains:** Add corresponding entries to `cli-domains.ts`, implement CLI commands in `packages/craft-cli/src/commands/`, and add PreToolUse guards.

6. **If upstream changes Drizzle ORM or adds its own DB layer:** Reconcile with our `packages/shared/src/db/` module. Check for driver compatibility.

7. **If upstream changes label/source CRUD operations:** The function signatures in `crud.ts` and `storage.db.ts` must stay in sync. Our CLI commands call these functions directly.

8. **If upstream changes automations config format:** Our `packages/craft-cli/src/commands/automation.ts` reads/writes `automations.json` directly — update the parsing logic.

9. **After merge, verify:**
   ```bash
   cd packages/craft-cli && bun run tsc --noEmit
   bun packages/craft-cli/src/index.ts --discover
   bun packages/craft-cli/src/index.ts label list
   cd packages/shared && bun test src/__tests__/feature-flags.test.ts
   ```

---

## Dependencies

### Runtime Dependencies

| Package | Used By | Purpose |
|---------|---------|---------|
| `drizzle-orm` | `packages/shared` | ORM for SQLite queries |
| `bun:sqlite` / `better-sqlite3` | `packages/shared/src/db/driver.ts` | SQLite driver (auto-detected) |

### Cross-Module Dependencies

- `packages/craft-cli/` → `@craft-agent/shared` (workspace dependency)
- All CLI commands import from `@craft-agent/shared/` subpaths (labels, sources, automations, skills, agent, config, db, workspaces)
- `db-init.ts` calls `autoRegisterDriver()` from `@craft-agent/shared/db` before any command execution

## Docker Considerations

The SQLite migration impacts Docker builds:

- **`better-sqlite3` native build:** This package requires `python3`, `make`, and `g++` to compile. However, the Docker server image runs on Bun which uses the built-in `bun:sqlite` driver (see `driver.ts` auto-detection). The `better-sqlite3` native binary is never loaded at runtime.
- **`--ignore-scripts` flag:** `Dockerfile.server` uses `bun install --frozen-lockfile --ignore-scripts` to skip `better-sqlite3`'s native compilation, keeping the image slim (no build toolchain needed).
- **`packages/craft-cli`:** This branch adds a `COPY packages/craft-cli/package.json` line to both Dockerfiles that does not exist on `main` or `feature/data-analysis-agent`.

## Merge History

| Version | Date | Conflicts | Notes |
|---------|------|-----------|-------|
| v0.8.2 | 2026-04-01 | 1 | WebUI OAuth, browser tool toggle, search reliability, auth hardening, PWA assets. Only conflict: `bun.lock` (took main's version). No upstream changes to SQLite-migrated storage modules (labels, sources, statuses, sessions). `credential-manager.ts` auto-merged cleanly (OAuth relay additions don't overlap with our changes). |
