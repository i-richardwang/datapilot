# Fork Merge Guide

> Records all fork changes relative to `upstream/main` (lukilabs/craft-agents-oss).
> Purpose: 合并 upstream 时的唯一操作手册 — 冲突风险、合并策略、检查清单。
>
> **Last updated after:** upstream v0.8.9 merge (2026-04-17) — Opus 4.7 default, inter-session messaging, local model setup fixes
>
> 设计细节见专项文档：
> - [DATAPILOT_BRANCH_GUIDE.md](DATAPILOT_BRANCH_GUIDE.md) — 品牌改造范围与决策
> - [SQLITE_MIGRATION_AND_CRAFT_CLI.md](SQLITE_MIGRATION_AND_CRAFT_CLI.md) — 存储迁移架构与 CLI 实现

## Overview

Our fork adds 9 categories of changes:

1. **DataPilot Branding** — Agent 身份从 "Craft Agent" 改为 "DataPilot"。涉及系统提示词、数据目录（`~/.craft-agent/` → `~/.datapilot/`）、环境变量（`CRAFT_*` → `DATAPILOT_*`）、CLI 二进制名（`craft-cli` → `datapilot-cli`）、UI 全面品牌文本（40+ 文件）、构建产物名（`DataPilot.app`）。详见 [DATAPILOT_BRANCH_GUIDE.md](DATAPILOT_BRANCH_GUIDE.md)。

2. **SQLite Storage Migration + DataPilot CLI** — Labels、sources、statuses、views、sessions、automation history 从 JSON 文件迁移到 per-workspace `workspace.db`（Drizzle ORM）。配套 `datapilot` CLI（60 个子命令）成为 agent 管理配置的**唯一路径**。详见 [SQLITE_MIGRATION_AND_CRAFT_CLI.md](SQLITE_MIGRATION_AND_CRAFT_CLI.md)。

3. **Batch Processing System** — 对大量条目（CSV/JSON/JSONL）执行 prompt action 的批处理系统。架构镜像 Automations；上游重构 automations 时 batch 代码大概率需要同步。

4. **Granular Feature Flags** — 5 个独立构建时开关替代旧的 `LITE_VERSION`：`DATAPILOT_DISABLE_OAUTH`、`DATAPILOT_DISABLE_BROWSER`、`DATAPILOT_DISABLE_VALIDATION`、`DATAPILOT_DISABLE_TEMPLATES`、`DATAPILOT_LITE_UI`。每个 flag 独立控制工具集和系统提示词段落。

5. **Custom Endpoint Runtime Fixes** — 4 个修复：(a) `queryLlm()` 豁免 custom-endpoint 的 provider 兼容性检查；(b) `validateStoredConnection()` 改为实际 API 调用验证；(c) `resolveModelForProvider()` 跳过 cross-provider guard；(d) tier-hint 短名解析（`'haiku'` → `getMiniModel()`）。

6. **Preset Preservation Fix** — 修复 `resolvePresetStateForBaseUrlChange()` 保留 Pi SDK provider routing。

7. **Border-Radius Theme Tokens** — `:root` 覆盖 `--radius-*` CSS 变量为 `0px`；所有 `rounded-[Npx]` 转换为标准 Tailwind 类。~115 TSX/TS 文件 + 3 CSS 文件。

8. **Self-Hosted Viewer Server** (`apps/viewer-server/`) — 独立 HTTP 后端，替代 upstream `agents.craft.do` 的 session 分享服务。`Dockerfile.viewer` 独立部署在 9101 端口。`VIEWER_URL` 可通过 `DATAPILOT_VIEWER_URL` 环境变量配置。

9. **Docker Compose Deployment** — `docker-compose.yml` + `.env.docker` 一键部署 server (9100) + viewer (9101)。

---

## New Files (Low Conflict Risk)

Won't conflict unless upstream adds similarly-named features.

### Batch System

| Location | Purpose |
|----------|---------|
| `packages/shared/src/batches/` | Types, schemas, CSV/JSON/JSONL parser, state persistence, processor, output builder, validation. 5 test files (~1300 lines) |
| `packages/session-tools-core/src/handlers/batch-output.ts` | Handler + tests: coerces stringified JSON, validates via ajv, upserts JSONL records |
| `packages/server-core/src/handlers/rpc/batches.ts` | 13 RPC handlers (mirrors `automations.ts` structure) |
| `apps/electron/src/renderer/components/batches/` | `BatchesListPanel`, `BatchInfoPage`, `BatchActionRow`, `BatchItemTimeline`, `BatchMenu`, `BatchAvatar` |
| `apps/electron/src/renderer/atoms/batches.ts` | Jotai atom |
| `apps/electron/src/renderer/hooks/useBatches.ts` | Mirrors `useAutomations` |
| `apps/electron/resources/docs/batches.md` | Agent reference doc |

**Cross-module dependency:** `batch-processor.ts` imports `expandEnvVars()` from `automations/utils.ts` and `sanitizeForShell()` from `automations/security.ts`.

### SQLite Database Module

| Location | Purpose |
|----------|---------|
| `packages/shared/src/db/` | Driver auto-detection, connection management, events emitter, schema definitions |
| `packages/shared/src/db/schema/` | Table schemas: labels, sources, statuses, views, sessions, automations, batches, workspace-config |
| `packages/shared/src/labels/storage.db.ts` | SQLite label storage (replaces storage.ts) |
| `packages/shared/src/sources/storage.db.ts` | SQLite source storage |
| `packages/shared/src/statuses/storage.db.ts` | SQLite status storage |
| `packages/shared/src/views/storage.db.ts` | SQLite view storage |
| `packages/shared/src/sessions/storage.db.ts` | SQLite session storage |
| `packages/shared/src/automations/history-store.db.ts` | SQLite automation history |

### DataPilot CLI

| Location | Purpose |
|----------|---------|
| `packages/craft-cli/` | 8 source files, 7 entities (label/source/automation/batch/skill/permission/theme) |
| `apps/electron/resources/docs/datapilot-cli.md` | 475-line CLI specification document (agent reads via doc reference table) |

### Viewer Server & Docker

| Location | Purpose |
|----------|---------|
| `apps/viewer-server/` | Bun HTTP server: routes, fs/S3 storage, serves `apps/viewer/dist` |
| `Dockerfile.viewer` | Container for viewer-server (port 9101) |
| `docker-compose.yml` | One-command deployment: server + viewer |
| `.env.docker` | Environment variable template |

---

## Modified Upstream Files (Conflict Zone)

### HIGH Risk — Always Inspect Manually

#### `packages/shared/src/prompts/system.ts` `[Branding + Batch + CLI + Granular Flags]`

- **Branding:** 身份定义、自称指令、Git co-author、CLI 章节标题及命令（11 处 "Craft Agent" → "DataPilot"）
- **SQLite/CLI:** CLI section 从 "Prefer CLI" 改为 mandatory "You MUST use"；mini agent prompt 改为引用 CLI
- **Batch:** Doc reference table 新增 Batches 行；batch CLI guidance 由 `FEATURE_FLAGS.craftAgentsCli` 控制
- **Granular flags:** `disableBrowser` 条件包裹 Browser Tools 段落 + doc table 行；`disableValidation` 包裹 mermaid 工具；`disableTemplates` 包裹 Source Templates

**Conflict trigger:** 上游频繁修改系统提示词。任何段落重写/重排都可能破坏我们的条件包裹。

#### `packages/server-core/src/sessions/SessionManager.ts` `[Batch]`

- `batchProcessors: Map<string, BatchProcessor>` with per-workspace init, callbacks, config watcher, broadcasting
- Modified `executePromptAutomation()`: added `isBatch`, `batchContext`, `workingDirectory` params
- `ensureBatchProcessor()` / `ensureAutomationSystem()` public idempotent methods
- `notifyBatchesChanged()` / `notifyAutomationsChanged()` for explicit mutation broadcasting

**Conflict trigger:** upstream changes workspace init, session completion, or dispose lifecycle.

#### `apps/electron/src/renderer/components/app-shell/AppShell.tsx` `[Batch + Lite UI]`

- **Batch:** sidebar nav + count badge, "Add Batch" button, `BatchesListPanel`, delete dialog, `useBatches()`, "Batch Sessions" sidebar item
- **Lite UI:** conditional "What's New" button via `...(!FEATURE_FLAGS.liteUi ? [...] : [])`

**Conflict trigger:** upstream changes sidebar structure, context providers, or dialog management.

#### `packages/session-tools-core/src/tool-defs.ts` `[Batch + Granular Flags]`

- `batch_output` tool def, `BatchOutputSchema`, `'batches'` target in `ConfigValidateSchema`
- `BATCH_EXCLUDED_TOOLS` set (18 tools stripped from batch sessions)
- Per-category tool sets: `OAUTH_TOOLS`, `BROWSER_TOOLS`, `VALIDATION_TOOLS`, `TEMPLATE_TOOLS`
- `SessionToolFilterOptions` extended with `includeBatchOutput`, `batchMode`, `disableOauth/Browser/Validation/Templates`

**Conflict trigger:** upstream adds/removes/renames session tools.

#### `packages/shared/src/agent/session-scoped-tools.ts` `[Batch + Granular Flags]`

- Batch context registry: `registerSessionBatchContext()`, `getSessionBatchContext()`, `cleanupSessionBatchContext()`
- Passes `batchContext`, `includeBatchOutput`, `batchMode`, `disableOauth/Browser/Validation/Templates` through tool init flow
- In batch mode, conditionally skips `spawn_session`, `batch_test`, `browser_tool`

**Conflict trigger:** upstream refactors tool initialization or caching strategy.

#### `packages/shared/package.json` `[Batch + SQLite]`

- Added `"./batches"` subpath export
- Added 10+ subpath exports for `.db.ts` files, `./db`, `./db/schema`, `./db/events`

**Conflict trigger:** upstream adds new subpath exports (merge adjacent lines).

#### `packages/shared/src/feature-flags.ts` `[Granular Flags + CLI]`

- `craftAgentsCli` default changed from `false` to `true`
- 5 granular flag functions (`isOauthDisabled`, `isBrowserDisabled`, `isValidationDisabled`, `isTemplatesDisabled`, `isLiteUi`)
- `isOauthDisabled` 和 `isLiteUi` 默认值改为 `true`（OAuth 默认关闭，Lite UI 默认开启）

**Conflict trigger:** upstream adds new feature flags.

### MEDIUM Risk — Check After Upstream Changes

#### `packages/shared/src/agent/backend/factory.ts` `[Custom Endpoint Fix]`

`resolveModelForProvider()`: (1) skips cross-provider guard when `connection.customEndpoint` is set; (2) resolves tier-hint short names against connection model list. If upstream fixes the guard, change (1) can be dropped.

#### `packages/shared/src/agent/backend/internal/drivers/pi.ts` `[Custom Endpoint Fix]`

Added `testOpenAICompatible()` (~70 lines); `validateStoredConnection()` makes actual API calls for custom endpoints.

#### `packages/shared/src/agent/claude-agent.ts` `[Batch]`

Batch context reading → `batchOutputSchema` passed to `buildContextParts()`.

#### `packages/shared/src/agent/pi-agent.ts` `[Batch]`

`setupTools()` passes `includeBatchOutput` and `batchMode`; `createSessionToolContext()` passes `batchContext`.

#### `packages/shared/src/agent/claude-context.ts` `[Batch]`

Extended `ClaudeContextOptions` with `batchContext?`; added `validateBatches` to `ValidatorInterface`.

#### `packages/shared/src/agent/core/prompt-builder.ts` `[Batch]`

`buildContextParts()`: if `batchOutputSchema` present, appends `<batch_output_instructions>` block.

#### `packages/server-core/src/handlers/session-manager-interface.ts` `[Batch]`

Added `getBatchProcessor?()`, `ensureBatchProcessor()`, `notifyBatchesChanged()`, `notifyAutomationsChanged()`; extended `executePromptAutomation()` signature.

#### `packages/server-core/src/handlers/rpc/automations.ts` `[Batch]`

Added `automations:list` RPC handler. Mutation handlers call `notifyAutomationsChanged()`.

#### `apps/electron/src/renderer/hooks/useAutomations.ts` `[Batch]`

Changed from direct `readFile` to `listAutomations()` RPC call (fixes web deployments).

#### `packages/shared/src/config/cli-domains.ts` `[SQLite/CLI + Batch]`

Guard policies for all CLI domains including `'batch'`（batch 使用默认 pattern `^datapilot\s+batch\s+...`）。

#### `packages/shared/src/agent/core/pre-tool-use.ts` `[SQLite/CLI]`

Config file guards and bash guards for CLI domains. `CliFeatureFlags` interface for flag routing.

#### `packages/shared/src/agent/permissions-config.ts` `[SQLite/CLI]`

`shouldCompileBashPattern()` checks `craftAgentsCli` flag.

#### `packages/shared/src/config/paths.ts` `[Branding]`

`CONFIG_DIR` from `.craft-agent` → `.datapilot`; `DATAPILOT_CONFIG_DIR` env var.

#### `packages/shared/src/agent/core/config-validator.ts` `[Branding]`

9 regex patterns: `\.craft-agent` → `\.datapilot`.

#### `apps/electron/src/renderer/components/apisetup/submit-helpers.ts` `[Preset Fix]`

Simplified `resolvePresetStateForBaseUrlChange()`: removed `activePresetHasEmptyUrl` branch.

#### `apps/electron/src/renderer/index.css` + `packages/ui/src/styles/index.css` `[Border-Radius]`

`:root` override `--radius-xs` through `--radius-2xl` to `0px`. Converted hardcoded `border-radius` to `var(--radius-*)`.

#### `packages/ui/src/components/markdown/tiptap-editor.css` `[Border-Radius]`

Converted ~20 hardcoded `border-radius` values to `var(--radius-*)`.

#### ~115 TSX/TS files `[Border-Radius]`

Mechanical `rounded-[Npx]` → standard Tailwind class. Conflicts only if upstream also changes the same `rounded-[Npx]` string.

#### `packages/session-mcp-server/src/index.ts` `[Granular Flags]`

Passes `disableOauth/Browser/Validation/Templates` to `createSessionTools()` and `getSessionToolRegistry()`.

#### `packages/shared/src/statuses/storage.db.ts` `[Lite UI]`

`getDefaultStatusConfig()` conditionally excludes Backlog/Needs Review via `liteUi`.

#### `packages/shared/src/branding.ts` `[Viewer Server]`

`VIEWER_URL` reads `DATAPILOT_VIEWER_URL` env var with fallback.

#### `packages/shared/src/labels/index.ts` + `sources/index.ts` `[SQLite]`

Re-exports now point to `storage.db.ts`.

### LOW Risk — Additive / Mechanical Changes

| File | Category | Change |
|------|----------|--------|
| `packages/shared/src/agent/index.ts` | Batch | Export `registerSessionBatchContext` |
| `packages/shared/src/agent/core/types.ts` | Batch | `batchOutputSchema?` in `ContextBlockOptions` |
| `packages/shared/src/agent/mode-manager.ts` | Batch+Flags | `includeBatchOutput`, granular disable flags in safe mode |
| `packages/shared/src/agent/backend/pi/session-tool-defs.ts` | Batch | `includeBatchOutput`, `batchMode` opts |
| `packages/shared/src/docs/doc-links.ts` | Batch | `'batches'` in `DocFeature` |
| `packages/shared/src/docs/index.ts` | Batch | `batches` in `DOC_REFS` |
| `packages/shared/src/protocol/channels.ts` | Batch | `batches` namespace + `automations.LIST` |
| `packages/shared/src/protocol/dto.ts` | Batch | `batch_progress`, `batch_complete` events; `isBatch` field |
| `packages/shared/src/protocol/events.ts` | Batch | `batches.CHANGED` |
| `packages/shared/src/config/validators.ts` | Batch | `validateBatches`, `'batch-config'` detection |
| `packages/shared/src/config/watcher.ts` | Batch | `onBatchesConfigChange` callback |
| `packages/session-tools-core/src/context.ts` | Batch | `validateBatches()`, `BatchContext`, `batchContext?` |
| `packages/session-tools-core/src/handlers/config-validate.ts` | Batch | `'batches'` target |
| `apps/electron/src/transport/channel-map.ts` | Batch | 10 batch + `listAutomations` mappings |
| `apps/electron/src/shared/types.ts` | Batch | `BatchFilter`, `BatchesNavigationState`, batch methods |
| `apps/electron/src/shared/routes.ts` | Batch | `batches()`, `batchSessions()` route builders |
| `apps/electron/src/shared/route-parser.ts` | Batch | `'batches'` navigator, `batchFilter` |
| `apps/electron/src/renderer/App.tsx` | Batch | `batchHandlersRef`, batch event routing |
| `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx` | Batch | Batches navigator rendering |
| `apps/electron/src/renderer/components/ui/EditPopover.tsx` | Batch | `'batch-config'` context key |
| `apps/electron/src/renderer/context/AppShellContext.tsx` | Batch | 6 batch methods |
| `apps/electron/src/renderer/contexts/NavigationContext.tsx` | Batch | `isBatch` exclusion, batch filter |
| `apps/electron/src/renderer/components/app-shell/TopBar.tsx` | Lite UI | Help menu wrapped with `!FEATURE_FLAGS.liteUi` |
| `apps/electron/src/renderer/components/onboarding/ProviderSelectStep.tsx` | Disable OAuth | `OAUTH_HIDDEN_PROVIDERS` filter |
| `apps/electron/vite.config.ts` | Flags | `define` for 5 `DATAPILOT_DISABLE_*` env vars |
| `apps/electron/resources/permissions/default.json` | CLI | `datapilot` + `datapilot batch` bash patterns |
| `packages/shared/src/__tests__/feature-flags.test.ts` | CLI | `craftAgentsCli` defaults to `true` |
| `packages/shared/src/auth/oauth.ts` | Branding | `CLIENT_NAME = 'DataPilot'` |

---

## Merge Checklist

### Step 1 — Pre-Merge

```bash
git fetch upstream
git diff upstream/main...HEAD --stat          # current divergence
git log HEAD..upstream/main --oneline          # incoming commits
```

### Step 2 — Execute Merge

```bash
git merge upstream/main --no-edit
```

### Step 3 — Resolve Conflicts

For each conflicting file, look it up in the "Modified Upstream Files" section above. General principles:

- **Batch code mirrors automations.** If upstream changed automations, apply the same pattern to batch.
- **Branding: keep "DataPilot" over "Craft Agent"** in all user-visible text.
- **SQLite storage: our `.db.ts` files replace upstream `.ts` storage.** Take upstream's type changes but keep our storage implementation.
- **Border-radius: convert upstream's new `rounded-[Npx]` to standard Tailwind classes.**
- **Custom endpoint fixes: if upstream fixes the same issue, take upstream's version.**
- **`anthropic_compat` provider type: keep it live** (upstream removed it as legacy, but our fork uses it for Claude SDK custom endpoint routing).
- **Append-only structures** (exports, channel maps, route registrations): include both sides.

### Step 4 — Conditional Checks (if upstream touched these areas)

| If upstream changed... | Then verify... |
|------------------------|----------------|
| `executePromptAutomation()` signature | `isBatch`, `batchContext`, `automationName`, `workingDirectory` passthrough works |
| Automations utilities (`expandEnvVars`, `sanitizeForShell`) | Imports in `batch-processor.ts` still resolve |
| `resolvePresetStateForBaseUrlChange()` | Our fix still holds |
| Feature flags / Vite config | Our granular flag getters + `define` entries preserved |
| Default statuses | `liteUi` conditional covers new statuses |
| Session tools (add/remove/rename) | `OAUTH_TOOLS`, `BROWSER_TOOLS`, `VALIDATION_TOOLS`, `TEMPLATE_TOOLS`, `BATCH_EXCLUDED_TOOLS` updated |
| System prompt sections (rewrite/reorder) | Granular flag conditionals still wrap correct blocks |
| Components with `rounded-[Npx]` | Convert to standard Tailwind classes |
| `:root` in CSS files | `--radius-xs` through `--radius-2xl` overrides preserved |
| `branding.ts` | `DATAPILOT_VIEWER_URL` env var override preserved |
| Viewer backend or `/s/api` contract | Reconcile with `apps/viewer-server/` |
| Label/source/status/view storage | Our `.db.ts` still works; check if new fields need schema columns |
| `package.json` exports | Our `.db.ts` subpath exports + batch exports preserved |
| System prompt CLI section | Must remain mandatory ("MUST use"), not soft ("Prefer") |
| PreToolUse pipeline | Config domain bash guard and CLI redirect preserved |
| New config domains | Add to `cli-domains.ts`, implement CLI commands, add PreToolUse guards |
| Automations config format | Update `packages/craft-cli/src/commands/automation.ts` parsing |

### Step 5 — Post-Merge Verification

#### 5a. Branding Audit

```bash
# 用户可见 "Craft Agent" 文本
grep -rn "Craft Agent" apps/electron/resources/docs/ apps/electron/resources/release-notes/ \
  packages/shared/src/prompts/system.ts apps/electron/src/renderer/ \
  scripts/install-app.sh scripts/install-app.ps1 scripts/build-server.ts \
  | grep -v node_modules | grep -v craft-agents-oss

# 数据目录路径
grep -rn '\.craft-agent' --include='*.ts' --include='*.tsx' --include='*.md' . \
  | grep -v node_modules | grep -v FORK_MERGE_GUIDE

# 环境变量残留（排除 CRAFT_FEATURE_* 内部 flag）
grep -rn 'CRAFT_SERVER_\|CRAFT_RPC_\|CRAFT_WEBUI_\|CRAFT_LITE_\|CRAFT_HEALTH_\|CRAFT_DEBUG\|CRAFT_VIEWER_\|CRAFT_CLI_\|CRAFT_BUN\|CRAFT_BATCH_\|CRAFT_COMMANDS_\|CRAFT_TLS_' \
  --include="*.ts" --include="*.sh" --include="*.yaml" --include="*.json" \
  --exclude="FORK_MERGE_GUIDE.md" --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null

# CLI 二进制名
grep -rn 'craft-cli\|craft-server\|craft-agent-batch' \
  --include="*.ts" --include="*.json" --include="*.md" \
  --exclude="FORK_MERGE_GUIDE.md" --exclude="SQLITE_MIGRATION_AND_CRAFT_CLI.md" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=release-notes . 2>/dev/null

# 文档文件名引用
grep -rn 'craft-cli\.md' --include="*.ts" --include="*.md" \
  --exclude-dir=node_modules --exclude-dir=.git . 2>/dev/null
```

**Branding 高频变动区域（每次合并必查）：**

| Area | Reason |
|------|--------|
| `resources/release-notes/` | 上游每次发版必新增，几乎必然提到 "Craft Agent(s)" |
| `resources/docs/*.md` | 新功能文档可能包含产品名 |
| `prompts/system.ts` | 上游频繁修改，可能新增 "Craft Agent" 段落 |
| `src/renderer/components/onboarding/` | 引导流程步骤文本 |
| `errors.ts`, `connection-setup-logic.ts` | 新 provider/连接类型的错误信息 |
| `scripts/build-server.ts` | 自部署功能的 echo/log 输出 |
| `install-app.sh` / `install-app.ps1` | 安装流程用户提示 |

#### 5b. SQLite/CLI Verification

```bash
cd packages/craft-cli && bun run tsc --noEmit
bun packages/craft-cli/src/index.ts --discover
bun packages/craft-cli/src/index.ts label list
cd packages/shared && bun test src/__tests__/feature-flags.test.ts
```

#### 5c. Batch & Feature Tests

```bash
bun test packages/shared/src/batches/
bun test packages/session-tools-core/
```

#### 5d. Build Verification

```bash
# Electron app
cd apps/electron && bun run build

# Or at minimum, type check
bun run tsc --noEmit
```

---

## Merge History

| Version | Date | Conflicts | Key Notes |
|---------|------|-----------|-----------|
| v0.7.0 | 2026-03-06 | 9 | Major RPC/transport refactoring. Ported batch IPC → RPC layer. |
| v0.7.1 | 2026-03-06 | 3 | Merged `isBatch`/`batchContext` with upstream's `automationName`. |
| v0.7.2 | 2026-03-10 | 5 | Island system, presets. Preset preservation fix added. |
| v0.7.3 | 2026-03-11 | 1 | Adopted upstream's tool cache strategy, kept batch+flags. |
| v0.7.4 | 2026-03-12 | 2 | Adopted upstream's full custom endpoint system. |
| v0.7.5 | 2026-03-13 | 3 | Webhook automations. Added `undefined` placeholders for fork params. |
| v0.7.6 | 2026-03-17 | 1 | Identical `customEndpoint` persistence fix on both sides. |
| v0.7.7 | 2026-03-18 | 2 | Upstream adopted our provider exemption fix (fork fix dropped). |
| v0.7.8 | 2026-03-19 | 1 | Bedrock provider, 1M context. Adopted upstream's history compaction. |
| v0.7.9–v0.7.11 | 2026-03-22 | 0 | Clean merge. WebSocket reliability, Copilot overhaul. |
| v0.7.12 | 2026-03-24 | 0 | Clean merge. + 品牌适配：3 处 DataPilot 替换。 |
| v0.8.0 | 2026-03-26 | 12 | Hybrid transport, WebUI. 7 CSS border-radius conflicts. + 品牌适配：2 处 remote workspace 文本。 |
| v0.8.1 | 2026-03-27 | 4 | Docker-compose. + 品牌适配：7 处新增文本（webui title、install script 等）。+ SQLite 合并：clean。 |
| v0.8.2 | 2026-04-01 | 5 | WebUI OAuth, PWA. + 品牌适配：PWA manifest + 全面环境变量重命名（37 文件 176 处）+ CLI 二进制名重命名。+ SQLite 合并：1 conflict (bun.lock)。 |
| v0.8.3 | 2026-04-03 | 10 | Session self-management tools. **Restored `anthropic_compat`** as live provider. + 品牌适配：4 conflicts, 无新增品牌需求。+ SQLite 合并：clean。 |
| v0.8.4 | 2026-04-09 | 35 | Generic OAuth, Send to Workspace. 14 version bump conflicts. Adopted upstream's callback registry. |
| v0.8.5+v0.8.6 | 2026-04-11 | 9 | i18n (EN/ES/zh-Hans/JA), chunked transfers. Post-merge: `EditPopover` model tier type fix, `listAutomations` type rename. |
| v0.8.7 | 2026-04-15 | 3 | Hungarian/German/Polish i18n, Bedrock fixes, API token refresh. 3 conflicts: 2 version bumps (package.json) + AppShell.tsx `useMemo` deps merge. Post-merge: duplicate import fix, i18n key sorting + fork keys added to de/hu/pl. |
| v0.8.7+v0.8.8+v0.8.9 | 2026-04-17 | 32 | Triple-version merge (v0.8.7 re-applied since prior content-only restore didn't record merge). **Key upstream changes:** Opus 4.7 default model + migration, `send_agent_message` tool (inter-session messaging), Local model detection via `isLoopbackBaseUrl`, retry button fix, duplicate ConfigWatcher fix, zh-Hans translation pass. **Conflict breakdown:** 14 package.json version bumps (all → 0.8.9), 7 i18n locale files (en/es/ja/zh-Hans had 25 DataPilot rebrands applied per-locale; pl/de/hu preserved fork's untranslated state per memory note), bun.lock regenerated via `bun install`, `README.md` kept fork's simplified version, `llm-connections.ts` merged fork's `anthropic_compat` branch with upstream's `Local Model` loopback branch, `FreeFormInput.tsx` added new `Local` provider group alongside `DataPilot Backend`, `SessionManager.ts` kept fork imports (`createHash`, `cleanupSessionScopedTools`, `registerSessionBatchContext`), `entity-row.tsx` adopted upstream's `open={menuOpen}` prop while keeping fork's `rounded-lg` class, `BrowserEmptyStateCard.tsx` switched hardcoded text to `t('browser.safetyHint')` with DataPilot-branded translations, claude-opus-4-6 → claude-opus-4-7 bumped in tests + models. **Pre-existing tsc errors** in `packages/shared/src/db/__tests__/*` and `packages/server-core/src/handlers/rpc/automations.ts` (verified pre-merge via worktree) are NOT caused by this merge. |

### Fork Feature Milestones (non-upstream merges)

| Feature | Date | Description |
|---------|------|-------------|
| Batch CLI | 2026-03-10 | Batch CLI commands, wrapper scripts, cli-domains batch policy |
| Lite tools | 2026-03-11 | Per-category tool sets, system prompt conditionals |
| Batch mode tools | 2026-03-16 | `BATCH_EXCLUDED_TOOLS`, batch sessions reduced to 3 tools |
| Batch workdir | 2026-03-17 | Per-batch `workingDirectory` support |
| Batch isBatch | 2026-03-18 | Dedicated sidebar entry, session filter |
| Model tier fix | 2026-03-18 | `resolveModelForProvider()` tier-hint resolution |
| Viewer server | 2026-03-27 | `apps/viewer-server/`, `Dockerfile.viewer` |
| Brand adaptation | 2026-04-01 | Full DataPilot branding (env vars, CLI names, docs) |
| SQLite migration | 2026-04-01 | JSON → SQLite storage, DataPilot CLI (60 commands) |
| Batch CLI consolidation | 2026-04-14 | `datapilot-batch` 合并进 `datapilot` CLI 的 `batch` entity；移除独立 `batchCli` flag |
| Granular flags defaults | 2026-04-15 | `isOauthDisabled()` 和 `isLiteUi()` 默认值改为 `true`；browser UI 随 flag 隐藏 |
| `browser.safetyHint` i18n | 2026-04-17 | Switched from hardcoded "DataPilot only controls browser windows…" to `t('browser.safetyHint')`; locale values in en/es/ja/zh-Hans/pl/de/hu all use DataPilot branding. |
