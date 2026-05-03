# Fork Merge Guide

> Records all fork changes relative to `upstream/main` (lukilabs/craft-agents-oss).
> Purpose: 合并 upstream 时的唯一操作手册 — 冲突风险、合并策略、检查清单。
>
> **Last upstream merge:** v0.9.0 (2026-05-01).

## Overview

Our fork adds 10 categories of changes:

1. **DataPilot Branding** — Agent 身份从 "Craft Agent" 改为 "DataPilot"。涉及系统提示词、数据目录（`~/.craft-agent/` → `~/.datapilot/`）、环境变量（`CRAFT_*` → `DATAPILOT_*`）、CLI 二进制名（`craft-cli` → `datapilot-cli`）、UI 全面品牌文本（40+ 文件）、构建产物名（`DataPilot.app`）。**故意不改的项**见 §5a "Intentionally Unchanged"。

2. **SQLite Storage Migration + DataPilot CLI** — Labels、sources、statuses、views、sessions、automation history 从 JSON 文件迁移到 per-workspace `workspace.db`（Drizzle ORM）。配套 `datapilot` CLI（60 个子命令）成为 agent 管理配置的**唯一路径**。

3. **Batch Processing System** — 对大量条目（CSV/JSON/JSONL）执行 prompt action 的批处理系统。架构镜像 Automations；上游重构 automations 时 batch 代码大概率需要同步。

4. **Granular Feature Flags** — 5 个独立构建时开关替代旧的 `LITE_VERSION`：`DATAPILOT_DISABLE_OAUTH`、`DATAPILOT_DISABLE_BROWSER`、`DATAPILOT_DISABLE_VALIDATION`、`DATAPILOT_DISABLE_TEMPLATES`、`DATAPILOT_LITE_UI`。每个 flag 独立控制工具集和系统提示词段落。

5. **Custom Endpoint Runtime Fixes** — 4 个修复：(a) `queryLlm()` 豁免 custom-endpoint 的 provider 兼容性检查；(b) `validateStoredConnection()` 改为实际 API 调用验证；(c) `resolveModelForProvider()` 跳过 cross-provider guard；(d) tier-hint 短名解析（`'haiku'` → `getMiniModel()`）。

6. **Preset Preservation Fix** — 修复 `resolvePresetStateForBaseUrlChange()` 保留 Pi SDK provider routing。

7. **Border-Radius Theme Tokens** — `:root` 覆盖 `--radius-*` CSS 变量为 `0px`；所有 `rounded-[Npx]` 转换为标准 Tailwind 类。~115 TSX/TS 文件 + 3 CSS 文件。

8. **Self-Hosted Viewer Server** (`apps/viewer-server/`) — 独立 HTTP 后端，替代 upstream `agents.craft.do` 的 session 分享服务。`Dockerfile.viewer` 独立部署在 9101 端口。`VIEWER_URL` 可通过 `DATAPILOT_VIEWER_URL` 环境变量配置。

9. **Docker Compose Deployment** — `docker-compose.example.yml` 提供通用 server (9100) + viewer (9101) 编排示例。host-specific 部署清单（含 Work / skillshub / agent-workspace 等本机挂载、自定义 build context）放在仓外的 `~/Documents/docker/datapilot-deploy/`，避免把个人路径 commit 进开源仓。

10. **Pi SDK Resource Loader Integration** — `pi-agent-server` 给 Pi session 装了 `PiDefaultResourceLoader`,用三个 override 把 DataPilot 的能力接进去:`additionalSkillPaths` 走三层 skill 发现(`~/.agents/skills` / `{workspace}/skills` / `{cwd}/.agents/skills`)、`agentsFilesOverride` 走 monorepo-aware 的 AGENTS.md/CLAUDE.md 行走(`findAllProjectContextFiles`)、`systemPromptOverride` 把 DataPilot 的 `getSystemPrompt()` 输出喂给 Pi 的 `customPrompt` slot。**`systemPromptOverride` 是关键约束**:Pi SDK 一旦装了 resourceLoader,它的 `_rebuildSystemPrompt` 会在每个 turn / tool change 时覆盖 `agent.state.systemPrompt`;不走 `customPrompt` slot 注入,DataPilot 的 prompt body 就会被 SDK 默认前言(`"You are an expert coding assistant operating inside pi..."`)取代。

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
| `apps/cli/` | 8 source files, 7 entities (label/source/automation/batch/skill/permission/theme) |
| `apps/electron/resources/docs/datapilot-cli.md` | 475-line CLI specification document (agent reads via doc reference table) |

### Viewer Server & Docker

| Location | Purpose |
|----------|---------|
| `apps/viewer-server/` | Bun HTTP server: routes, fs/S3 storage, serves `apps/viewer/dist` |
| `Dockerfile.viewer` | Container for viewer-server (port 9101) |
| `docker-compose.example.yml` | Generic server + viewer compose example. Host-specific compose (with Work / skillshub / agent-workspace mounts) lives outside the repo at `~/Documents/docker/datapilot-deploy/`. |

### HTML Share Password Dialog

| Location | Purpose |
|----------|---------|
| `packages/ui/src/components/overlay/HtmlSharePasswordDialog.tsx` | Set / change / clear the password on a shared HTML artifact. Mirrors the session-level `SharePasswordDialog` (kept in `apps/electron/`) so the two share flows stay symmetric. Lives in `packages/ui/` because `HTMLPreviewOverlay` is cross-platform; backend interaction goes through `PlatformActions` (`onShareHtml` with optional password, `onSetHtmlSharePassword`) instead of `window.electronAPI` directly. |

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
- `executePromptAutomation(input: ExecutePromptAutomationInput)`: options-object form (post-v0.8.13). Fork-extended keys: `isBatch`, `batchContext` (with `toolProfile`), `workingDirectory`, `onSessionCreated`. Both AutomationSystem and BatchProcessor callback sites pass these via the input object.
- `ensureBatchProcessor()` / `ensureAutomationSystem()` public idempotent methods
- `notifyBatchesChanged()` / `notifyAutomationsChanged()` for explicit mutation broadcasting
- `hibernateSession()` family (`shouldHibernateOnComplete`, `isHibernationSafe`, `hasPendingPermissionRequestsForSession`) for headless memory containment.

**Conflict trigger:** upstream changes workspace init, session completion, dispose lifecycle, or evolves `ExecutePromptAutomationInput` shape.

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
- In batch mode, conditionally skips `spawn_session`, `browser_tool`

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

#### `packages/pi-agent-server/src/index.ts` `[Resource Loader Integration]`

- **Resource loader install block** (`ensureSession`,~712-746): 构造 `PiDefaultResourceLoader`,传入三个 override:`additionalSkillPaths`(三层 skill 发现)、`agentsFilesOverride`(monorepo-aware AGENTS.md/CLAUDE.md 走 `findAllProjectContextFiles`)、`systemPromptOverride`(读模块级闭包 `currentDataPilotSystemPrompt`)。两个 helper(`buildDataPilotSkillPaths`、`loadDataPilotAgentsFiles`)在 ~512-560。
- **Per-turn handoff** (`handlePrompt`,~1370-1387): 三步走 —— `currentDataPilotSystemPrompt = msg.systemPrompt` 更新闭包 → `await session.resourceLoader.reload()` 让 loader 重新拉 override 值缓存到 `loader.systemPrompt` → `session.setActiveToolsByName(session.getActiveToolNames())` 强制触发 SDK 的 `_rebuildSystemPrompt`,后者重新读 `loader.getSystemPrompt()` 并把 DataPilot 的 prompt 当作 `customPrompt` 走 `buildSystemPrompt`(SDK 端 `system-prompt.js:19-41`),完全替换 Pi 默认前言,仍 append contextFiles + skills + date + cwd。**注意:`loader.reload()` 单独是不够的** —— 它只更新 loader 自己的缓存,不会触发 agent 的 `_baseSystemPrompt` 重建,后续 `agent.prompt()` 会用 session-creation 时缓存的 `_baseSystemPrompt`(那时闭包还是 undefined → 走 Pi default 分支)重置 `state.systemPrompt`。`setActiveToolsByName` 是 SDK 公开 API 里**唯一**会调 `_rebuildSystemPrompt` 的入口(传当前 tool 列表 = no-op tool change,但带来 prompt rebuild 的副作用)。
- **Module-level closure variable** (~232): `currentDataPilotSystemPrompt: string | undefined`。Closure 模式必需,因为 `systemPromptOverride` 在 session 构造时一次性注册,而 `msg.systemPrompt` 是 per-turn。

**Why this constraint matters(踩坑警告):** 上游 `pi-agent-server` **不装** resource loader,所以 `agent.state.systemPrompt = msg.systemPrompt` 直接赋值就活到 LLM。我们装了 resource loader 之后,**Pi SDK 的 `_rebuildSystemPrompt` 会在每个 turn / tool change 时把 `agent.state.systemPrompt` 覆盖回 buildSystemPrompt 的输出**。如果回退到直接赋值的形态(老代码 / 上游 merge 引入相似 pattern / 看着多余把 closure 删掉),DataPilot 的 prompt body **会静默丢失**,LLM 看到的是 Pi 默认 `"You are an expert coding assistant operating inside pi..."` 而不是 DataPilot 的 `getSystemPrompt()` 输出。bug 表征:Agent 不知道 html-preview 块怎么写、忽略 Configuration Documentation 表里的 doc 引用、自称是 pi 而不是 DataPilot。

**Conflict trigger:** (a) 上游修改 `pi-agent-server` 的 `prompt` IPC handler 系统 prompt 处理路径; (b) 上游引入自家 resource loader 安装逻辑; (c) Pi SDK 升级改 `_rebuildSystemPrompt` 触发条件 / `customPrompt` 语义 / 暴露新公开 API 直接触发 rebuild(届时可以把 `setActiveToolsByName` no-op trick 替换掉); (d) 任何"看上去更简单"的重构想把 closure + reload + setActiveToolsByName 改回直接赋值。

### MEDIUM Risk — Check After Upstream Changes

#### `packages/shared/src/agent/backend/factory.ts` `[Custom Endpoint Fix]`

`resolveModelForProvider()`: (1) skips cross-provider guard when `connection.customEndpoint` is set; (2) resolves tier-hint short names against connection model list. If upstream fixes the guard, change (1) can be dropped.

#### `packages/shared/src/agent/backend/internal/drivers/pi.ts` `[Custom Endpoint Fix]`

`validateStoredConnection()` 走真实 API 调用（fork 添加 `testOpenAICompatible()` ~70 行）。冲突时保留 fork 版本——上游的占位实现对 custom endpoint 永远 pass。

#### `packages/shared/src/agent/claude-agent.ts` `[Batch]`

Batch context reading → `batchOutputSchema` passed to `buildContextParts()`.

#### `packages/shared/src/agent/pi-agent.ts` `[Batch]`

`setupTools()` passes `includeBatchOutput` and `batchMode`; `createSessionToolContext()` passes `batchContext`.

#### `packages/shared/src/agent/claude-context.ts` `[Batch]`

Extended `ClaudeContextOptions` with `batchContext?`; added `validateBatches` to `ValidatorInterface`.

#### `packages/shared/src/agent/core/prompt-builder.ts` `[Batch]`

`buildContextParts()`: if `batchOutputSchema` present, appends `<batch_output_instructions>` block.

#### `packages/server-core/src/handlers/session-manager-interface.ts` `[Batch]`

Added `getBatchProcessor?()`, `ensureBatchProcessor()`, `notifyBatchesChanged()`, `notifyAutomationsChanged()`. Extended exported `ExecutePromptAutomationInput` (the options-object input introduced upstream in v0.8.13) with fork-only keys: `isBatch?`, `batchContext?` (incl. `toolProfile`), `workingDirectory?`, `onSessionCreated?`.

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

#### `apps/electron/src/renderer/index.css` + `packages/ui/src/styles/index.css` + `packages/ui/src/components/markdown/tiptap-editor.css` `[Border-Radius]`

`:root` override `--radius-xs` ~ `--radius-2xl` 全为 `0px`；硬编码 `border-radius` 转 `var(--radius-*)`。冲突时保留 fork 的 token 化版本——上游引入的新 `rounded-[Npx]` 一律转标准 Tailwind 类（处理流程见 Conditional Checks）。

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
| Automations config format | Update `apps/cli/src/datapilot/commands/automation.ts` parsing |

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

# 环境变量残留（allow-list 思路：列出 fork 保留的 CRAFT_* 命名空间，
# 其它 CRAFT_* 出现都是疑似漏改 — 上游引入新 CRAFT_* env 也会触发）
#
# Fork 保留的 CRAFT_* 命名空间（不要改）：
#
#   1) Misc：
#      - CRAFT_DEEPLINK_SCHEME       配合 craftagents:// scheme（fork 也保留）
#      - CRAFT_FEATURE_*             内部 feature flag
#
#   2) Session/Workspace 标识符：
#      - CRAFT_SESSION_DIR / CRAFT_SESSION_ID / CRAFT_SESSION_NAME / CRAFT_SESSION_METADATA
#      - CRAFT_WORKSPACE_ID / CRAFT_WORKSPACE_PATH
#
#   3) Automation hook env vars（fork 的 automation 系统命名约定，
#      utils.ts:256 还会把任意 payload key 动态生成 `CRAFT_<KEY>`）：
#      - CRAFT_EVENT / CRAFT_EVENT_DATA
#      - CRAFT_TOOL_*  (NAME, INPUT, RESPONSE)
#      - CRAFT_AGENT_* (ID, TYPE)
#      - CRAFT_LOCAL_* (TIME, DATE)
#      - CRAFT_OLD_*   (MODE, STATE)
#      - CRAFT_NEW_*   (MODE, STATE)
#      - CRAFT_WH_*    (用户自定义 webhook secret prefix)
#      - CRAFT_PROMPT / CRAFT_SOURCE / CRAFT_MODEL / CRAFT_ERROR
#      - CRAFT_MESSAGE / CRAFT_TITLE / CRAFT_LABEL / CRAFT_IS_FLAGGED
#
# 其它 CRAFT_* 都已 rename 成 DATAPILOT_*（CONFIG_DIR, RPC_*, WEBUI_*,
# SERVER_*, BUN, NODE, DEBUG, MESSAGING_*, DISABLE_*, VIEWER_*, ...）。
# 重点扫新增/修改的 test 文件、scripts/、resources/。
grep -rEn 'CRAFT_[A-Z_]+' \
  --include="*.ts" --include="*.tsx" --include="*.sh" --include="*.ps1" \
  --include="*.yaml" --include="*.yml" --include="*.json" --include="*.md" \
  --exclude="FORK_MERGE_GUIDE.md" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=release-notes . 2>/dev/null \
  | grep -v -E 'CRAFT_(DEEPLINK_SCHEME(_PREFIX)?|FEATURE_[A-Z_]+|SESSION_(DIR|ID|NAME|METADATA)|WORKSPACE_(ID|PATH)|EVENT(_DATA)?|TOOL_[A-Z_]+|AGENT_[A-Z_]+|LOCAL_[A-Z_]+|OLD_[A-Z_]+|NEW_[A-Z_]+|WH_[A-Z_]*|PROMPT|SOURCE|MODEL|ERROR|MESSAGE|TITLE|LABEL|IS_FLAGGED)\b'

# 小写品牌字符串残留（tempdir 前缀、fixture 路径、ID 等，cosmetic 但建议统一）
# 注意：@craft-agent/* package 名是 fork 保留的（package.json 里），
# craft-agents-oss 是 upstream repo URL，craftagents:// 是保留的 scheme
grep -rEn 'craft[_-]agent[_-]|craft-agent\b' \
  --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" \
  --exclude="FORK_MERGE_GUIDE.md" --exclude="bun.lock" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=release-notes . 2>/dev/null \
  | grep -v "@craft-agent/" | grep -v "craft-agents-oss" | grep -v 'craft-agent[' | grep -v "node_modules"

# CLI 二进制名
grep -rn 'datapilot-cli\|craft-server\|craft-agent-batch' \
  --include="*.ts" --include="*.json" --include="*.md" \
  --exclude="FORK_MERGE_GUIDE.md" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=release-notes . 2>/dev/null

# 文档文件名引用
grep -rn 'datapilot-cli\.md' --include="*.ts" --include="*.md" \
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

**Intentionally Unchanged（"看到这些 Craft Agent 残留是故意的，不要改"）：**

上面的 grep 脚本与高频区域表会扫出一批 `Craft Agent` 残留，下列项**故意保留**——审计时直接跳过：

- **加密存储 magic bytes 与盐**：`MAGIC_BYTES`（`CRAFT01`）、密钥派生盐（`craft-agent-v2`）。改了会破坏现有用户的本地加密数据，没有 migration 路径。
- **代码注释 & JSDoc**：源码里的 `// Craft Agent ...` 对用户不可见，全局替换会增加合并冲突面。
- **`package.json` `description` 字段**：仍为 `"... for Craft Agents"`，npm 元数据，用户不可见。`@craft-agent/*` package 名同理保留——动它会触发跨包 import 全量重写。
- **`scripts/build/` 下的 `Craft-Agents-` 文件名**：`linux.ts`、`darwin.ts`、`common.ts` 中的 artifact 命名与服务端下载 URL 耦合，动了断自动更新。`electron-builder.yml` 的 `artifactName` 已是 `DataPilot-${arch}.${ext}`。
- **Playground 演示数据**：`playground/registry/` 下少量 "Craft Agents" 演示文本，不影响产品。
- **测试 Fixture**：`storage-startup-migration.test.ts` 的 `'Craft Agents Backend (xxx)'` mock 数据匹配旧存储格式——动了反而让迁移测试失去意义。
- **保留的 `CRAFT_*` 命名空间**：完整 allow-list 在 §5a 上方的 grep 脚本注释里（automation hook env、webhook secret 前缀、`craftagents://` deeplink、`CRAFT_FEATURE_*` 内部 flag、`CRAFT_SESSION_*` / `CRAFT_WORKSPACE_*` 标识符）。

#### 5b. SQLite/CLI Verification

```bash
cd apps/cli && bun run tsc --noEmit
bun apps/cli/src/index.ts --discover
bun apps/cli/src/index.ts label list
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

> 仅记录冲突数与"留下了影响后续 merge 的结构性决策"。一次性的版本号撞、bun.lock 重生、
> proof-of-work 验证步骤都不写——那些是流程，不是知识，重读价值为零。

| Version | Date | Conflicts | Key Notes |
|---------|------|-----------|-----------|
| v0.7.0 | 2026-03-06 | 9 | RPC/transport refactor; ported batch IPC → RPC. |
| v0.7.1 | 2026-03-06 | 3 | Merged `isBatch`/`batchContext` with upstream's `automationName`. |
| v0.7.2 | 2026-03-10 | 5 | Island system + presets. Preset preservation fix added. |
| v0.7.3 | 2026-03-11 | 1 | Adopted upstream's tool cache strategy. |
| v0.7.4 | 2026-03-12 | 2 | Adopted upstream's full custom endpoint system. |
| v0.7.5 | 2026-03-13 | 3 | Webhook automations. |
| v0.7.6 | 2026-03-17 | 1 | Identical `customEndpoint` fix on both sides. |
| v0.7.7 | 2026-03-18 | 2 | Upstream adopted our provider exemption fix; fork fix dropped. |
| v0.7.8 | 2026-03-19 | 1 | Bedrock provider. |
| v0.7.9–v0.7.11 | 2026-03-22 | 0 | Clean. |
| v0.7.12 | 2026-03-24 | 0 | Clean. |
| v0.8.0 | 2026-03-26 | 12 | Hybrid transport + WebUI. First wave of border-radius conflicts. |
| v0.8.1 | 2026-03-27 | 4 | Docker-compose introduced upstream. |
| v0.8.2 | 2026-04-01 | 5 | WebUI OAuth + PWA. Mass `CRAFT_*` → `DATAPILOT_*` env rename + CLI binary rename. |
| v0.8.3 | 2026-04-03 | 10 | Session self-management tools. **Restored `anthropic_compat`** as live provider (upstream removed it). |
| v0.8.4 | 2026-04-09 | 35 | Generic OAuth + Send to Workspace. Adopted upstream's callback registry. |
| v0.8.5+v0.8.6 | 2026-04-11 | 9 | i18n EN/ES/zh-Hans/JA + chunked transfers. |
| v0.8.7 | 2026-04-15 | 3 | hu/de/pl i18n. |
| v0.8.7+v0.8.8+v0.8.9 | 2026-04-17 | 32 | Triple-version merge. Opus 4.7 default. pl/de/hu locales preserved untranslated (per memory note). |
| v0.8.10 | 2026-04-22 | 18 | Messaging Gateway (Telegram/WhatsApp). `Dockerfile.server` gained Node.js for WA worker; `CRAFT_MESSAGING_*` → `DATAPILOT_MESSAGING_*`. |
| v0.8.11 | 2026-04-23 | 7 | `getCoAuthorPreference()` plumbed into `getSystemPrompt`. |
| v0.8.12 | 2026-04-26 | 11 | Pi SDK 0.70.2 — `codingTools` removed (factory functions instead); attachment hybrid persistence; deep-link allowlist switch; Claude Agent SDK pinned `0.2.111`. |
| v0.8.13 | 2026-04-29 | 8 | `executePromptAutomation` → options object (`ExecutePromptAutomationInput`); fork-only keys (`isBatch`/`batchContext`/`workingDirectory`/`onSessionCreated`) live on the input type now. |
| v0.9.0 | 2026-05-01 | 19 | Claude Agent SDK 0.2.123 native-binary distribution + `@vscode/ripgrep`; Lark/Feishu messaging adapter; Telegram supergroup + per-automation `telegramTopic` (added to `ExecutePromptAutomationInput`); `bunfig.toml` linker pinned to `hoisted`. |
