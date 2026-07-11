# Fork Merge Guide

> Records all fork changes relative to `upstream/main` (lukilabs/craft-agents-oss).
> Purpose: 合并 upstream 时的唯一操作手册 — 冲突风险、合并策略、检查清单。
>
> **Last upstream merge:** v0.11.1 (2026-07-11).

## Overview

Our fork adds 11 categories of changes:

1. **DataPilot Branding** — Agent 身份从 "Craft Agent" 改为 "DataPilot"。涉及系统提示词、数据目录（`~/.craft-agent/` → `~/.datapilot/`）、环境变量（`CRAFT_*` → `DATAPILOT_*`）、CLI 二进制名（`craft-cli` → `datapilot-cli`）、UI 全面品牌文本（40+ 文件）、构建产物名（`DataPilot.app`）。**故意不改的项**见 §5a "Intentionally Unchanged"。

2. **SQLite Storage Migration + DataPilot CLI** — Labels、sources、statuses、views、sessions、automation history 从 JSON 文件迁移到 per-workspace `workspace.db`（Drizzle ORM）。配套 `datapilot` CLI（60 个子命令）成为 agent 管理配置的**唯一路径**。

3. **Batch Processing System** — 对大量条目（CSV/JSON/JSONL）执行 prompt action 的批处理系统。架构镜像 Automations；上游重构 automations 时 batch 代码大概率需要同步。

4. **Granular Feature Flags** — 7 个独立构建时开关替代旧的 `LITE_VERSION`：`DATAPILOT_DISABLE_OAUTH`、`DATAPILOT_DISABLE_BROWSER`、`DATAPILOT_DISABLE_VALIDATION`、`DATAPILOT_DISABLE_TEMPLATES`、`DATAPILOT_DISABLE_SANDBOX`、`DATAPILOT_DISABLE_MESSAGING`、`DATAPILOT_LITE_UI`。每 flag 独立控制工具集 / 系统提示词段落 / 子系统 bootstrap（messaging 还会跳过 WhatsApp worker 和 messaging RPC handler 注册）。

5. **Custom Endpoint Runtime Fixes** — 4 个修复：(a) `queryLlm()` 豁免 custom-endpoint 的 provider 兼容性检查；(b) `validateStoredConnection()` 改为实际 API 调用验证；(c) `resolveModelForProvider()` 跳过 cross-provider guard；(d) tier-hint 短名解析（`'haiku'` → `getMiniModel()`）。

6. **Preset Preservation Fix** — 修复 `resolvePresetStateForBaseUrlChange()` 保留 Pi SDK provider routing。

7. **Border-Radius Theme Tokens** — `:root` 覆盖 `--radius-*` CSS 变量为 `0px`；所有 `rounded-[Npx]` 转换为标准 Tailwind 类。~115 TSX/TS 文件 + 3 CSS 文件。

8. **Self-Hosted Viewer Server** (`apps/viewer-server/`) — 独立 HTTP 后端，替代 upstream `agents.craft.do` 的 session 分享服务。`Dockerfile.viewer` 独立部署在 9101 端口。`VIEWER_URL` 可通过 `DATAPILOT_VIEWER_URL` 环境变量配置。

9. **Docker Compose Deployment** — `docker-compose.example.yml` 提供通用 server (9100) + viewer (9101) 编排示例。host-specific 部署清单（含 Work / skillshub / agent-workspace 等本机挂载、自定义 build context）放在仓外的 `~/Documents/docker/datapilot-deploy/`，避免把个人路径 commit 进开源仓。

10. **Pi SDK Resource Loader Integration** — `pi-agent-server` 给 Pi session 装了 `PiDefaultResourceLoader`,用三个 override 把 DataPilot 的能力接进去:`additionalSkillPaths` 走三层 skill 发现(`~/.agents/skills` / `{workspace}/skills` / `{cwd}/.agents/skills`)、`agentsFilesOverride` 走 monorepo-aware 的 AGENTS.md/CLAUDE.md 行走(`findAllProjectContextFiles`)、`systemPromptOverride` 把 DataPilot 的 `getSystemPrompt()` 输出喂给 Pi 的 `customPrompt` slot。**`systemPromptOverride` 是关键约束**:Pi SDK 一旦装了 resourceLoader,它的 `_rebuildSystemPrompt` 会在每个 turn / tool change 时覆盖 `agent.state.systemPrompt`;不走 `customPrompt` slot 注入,DataPilot 的 prompt body 就会被 SDK 默认前言(`"You are an expert coding assistant operating inside pi..."`)取代。

11. **Performance / Runtime Hardening** (2026-06) — fork 在 upstream 基础上加了一层运行时性能改造。涉及的 upstream 文件多数是 upstream 频繁改的核心区(transport、SessionManager、Markdown、watcher、Dockerfile.server),merge 时会成冲突点。**踩坑级运行时不变量(持久化分层纪律、hibernation/idle-sweep、persistence-echo、selective watch、batch 排序、Node-runtime 约束)已就近记在 `packages/server-core/CLAUDE.md` 和 `packages/shared/CLAUDE.md`——本指南只登记"哪些文件被改了、冲突触发条件、合并取舍",`why` 一律去那两个 CLAUDE.md 读,不在此重复。** 五个子面:
    - **Tiered session persistence** — `storage.db.ts` 四档写(meta / targeted-message / turn-reconcile / full),`SessionManager` 走 O(changed-rows) 流式持久化 + turn-end reconcile(`header-metadata.ts`)。
    - **Transport hardening** — `transport/server.ts`+`codec.ts` 加慢客户端背压、共享事件序列化(一次 body 序列化广播给全部接收方)、permessage-deflate(仅 Node runtime 生效)。
    - **Renderer memoization** — `Markdown.tsx` 块级 memo(`split-markdown-blocks.ts`)、session list / turn 的 memo 边界、meta map 合并写、共享 clock atom(`atoms/clock.ts`)。
    - **Node runtime in Docker** — `Dockerfile.server` 主进程切 Node 22(原 Bun),Pi 子进程经 `DATAPILOT_PI_NODE_BIN`/`DATAPILOT_PI_INTERCEPTOR` 切 Node;打包走 `scripts/build-server-node.ts`。webui 改 Node-compat(`Response.redirect` 需绝对 URL)。
    - **Idle containment** — periodic idle-hibernate sweep + DB-mode selective `fs.watch`(不再递归 watch `sessions/`)。

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
| `packages/shared/src/projects/storage.db.ts` | SQLite project-config storage (configs in the `projects` table; assets/ + MEMORY.md stay on disk under the project folder; one-time lazy import renames legacy `config.json` → `.migrated`) |
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

### Performance / Runtime (`[Perf]`)

| Location | Purpose |
|----------|---------|
| `scripts/build-server-node.ts` | esbuild bundle of the server main process for the Node runtime (Docker). Pairs with `scripts/build/bun-sqlite-stub.cjs` (stubs `bun:sqlite` out of the Node bundle — Node uses `better-sqlite3`). |
| `packages/server-core/src/sessions/header-metadata.ts` | `loadSessionHeader` (single sessions-row select for the hot persistence-echo path) + `headerMetadataDiffers` (drops no-op echoes before they defer into `pendingExternalMetadata`). See server-core CLAUDE.md persistence-echo invariant. |
| `packages/ui/src/components/markdown/split-markdown-blocks.ts` | Splits streaming markdown into block-level chunks so `Markdown.tsx` can memo per-block instead of re-parsing the whole document each token. |
| `apps/electron/src/renderer/atoms/clock.ts` | Shared coarse-grained clock atom — one interval drives all relative-time (`time-ago`) displays instead of one timer per row. |
| `apps/electron/src/renderer/hooks/useKanbanBoardMetas.ts` | Server-backed meta source for the Kanban board — fetches the board population via `listSessionsPage` (limit 1000, recent-first) into board-local state, because the fork's `sessionMetaMapAtom` only holds the loaded window. The board merges these UNDER the window map; optimistic drag/status patches mirror through `patchBoardMeta`. |

---

## Modified Upstream Files (Conflict Zone)

### HIGH Risk — Always Inspect Manually

#### `packages/shared/src/prompts/system.ts` `[Branding + Batch + CLI + Granular Flags]`

- **Branding:** 身份定义、自称指令、Git co-author、CLI 章节标题及命令（11 处 "Craft Agent" → "DataPilot"）
- **SQLite/CLI:** CLI section 从 "Prefer CLI" 改为 mandatory "You MUST use"；mini agent prompt 改为引用 CLI
- **Batch:** Doc reference table 新增 Batches 行；batch CLI guidance 由 `FEATURE_FLAGS.craftAgentsCli` 控制
- **Granular flags:** `disableBrowser` 条件包裹 Browser Tools 段落 + doc table 行；`disableValidation` 包裹 mermaid 工具；`disableTemplates` 包裹 Source Templates
- **Project context:** 已删除 fork 自带的 `<project_context_files>` 块（与 Pi resourceLoader 的 `agentsFilesOverride` 重复）；AGENTS.md/CLAUDE.md 走 realpath dedup 防止 symlink 重复 — 上游若引入相似 block 不要回采

**Conflict trigger:** 上游频繁修改系统提示词。任何段落重写/重排都可能破坏我们的条件包裹。

#### `packages/server-core/src/sessions/SessionManager.ts` `[Batch + Perf]`

- `batchProcessors: Map<string, BatchProcessor>` with per-workspace init, callbacks, config watcher, broadcasting
- `executePromptAutomation(input: ExecutePromptAutomationInput)`: options-object form (post-v0.8.13). Fork-extended keys: `isBatch`, `batchContext` (with `toolProfile`), `workingDirectory`, `onSessionCreated`. Both AutomationSystem and BatchProcessor callback sites pass these via the input object.
- `ensureBatchProcessor()` / `ensureAutomationSystem()` public idempotent methods
- `notifyBatchesChanged()` / `notifyAutomationsChanged()` for explicit mutation broadcasting
- **`[Perf]` Hibernation + idle containment:** `hibernateSession()` family (`shouldHibernateOnComplete`, `isHibernationSafe`, `isIdleHibernationSafe`, `hasPendingPermissionRequestsForSession`) + the periodic idle-hibernate sweep (every 5min, >30min idle). See server-core CLAUDE.md **session hibernation** + **persistence-echo** invariants — any new runtime-only `ManagedSession` field must be persisted or guarded in `isHibernationSafe`/`isIdleHibernationSafe` or the sweep silently drops it.
- **`[Perf]` Streaming persistence:** O(changed-rows) persist path — tracks `turnChangedMessageIds` through `persistSessionMessages`, calls `saveSessionMessageUpdate` on the hot path and `persistSessionTurnEnd` → `saveSessionTurnReconcile` at turn end. See shared CLAUDE.md Session-Persistence tier discipline — in-place edits to existing messages MUST flow through `persistSessionMessages` or they never reach disk.
- **`[Perf]` Pi runtime overrides:** `resolvePiRuntimeOverrides()` reads `DATAPILOT_PI_NODE_BIN`/`DATAPILOT_PI_INTERCEPTOR` (Docker-only, set in `Dockerfile.server`) to run the Pi subprocess under Node. Set-but-missing path throws (no silent fallback).

**Conflict trigger:** upstream changes workspace init, session completion, dispose lifecycle, evolves `ExecutePromptAutomationInput` shape, or touches the persist/save call sites or session-creation env wiring (re-thread the fork's streaming-persist + pi-runtime-override hooks).

#### `apps/electron/src/renderer/components/app-shell/AppShell.tsx` `[Batch + Lite UI]`

- **Batch:** sidebar nav + count badge, "Add Batch" button, `BatchesListPanel`, delete dialog, `useBatches()`, "Batch Sessions" sidebar item
- **Lite UI:** conditional "What's New" button via `...(!FEATURE_FLAGS.liteUi ? [...] : [])`

**Conflict trigger:** upstream changes sidebar structure, context providers, or dialog management.

#### `packages/session-tools-core/src/tool-defs.ts` `[Batch + Granular Flags]`

- `batch_output` tool def, `BatchOutputSchema`, `'batches'` target in `ConfigValidateSchema`
- `BATCH_EXCLUDED_TOOLS` set (18 tools stripped from batch sessions)
- Per-category tool sets: `OAUTH_TOOLS`, `BROWSER_TOOLS`, `VALIDATION_TOOLS`, `TEMPLATE_TOOLS`, `SANDBOX_TOOLS`, `MESSAGING_TOOLS`
- `SessionToolFilterOptions` extended with `includeBatchOutput`, `batchMode`, `disableOauth/Browser/Validation/Templates/Sandbox/Messaging`

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
- 7 granular flag functions (`isOauthDisabled`, `isBrowserDisabled`, `isValidationDisabled`, `isTemplatesDisabled`, `isSandboxDisabled`, `isMessagingDisabled`, `isLiteUi`)
- `isOauthDisabled` 和 `isLiteUi` 默认值改为 `true`（OAuth 默认关闭，Lite UI 默认开启）；其余默认 `false`

**Conflict trigger:** upstream adds new feature flags.

#### `packages/pi-agent-server/src/index.ts` `[Resource Loader Integration]`

- **Resource loader install block** (`ensureSession`,~712-746): 构造 `PiDefaultResourceLoader`,传入三个 override:`additionalSkillPaths`(三层 skill 发现)、`agentsFilesOverride`(monorepo-aware AGENTS.md/CLAUDE.md 走 `findAllProjectContextFiles`)、`systemPromptOverride`(读模块级闭包 `currentDataPilotSystemPrompt`)。两个 helper(`buildDataPilotSkillPaths`、`loadDataPilotAgentsFiles`)在 ~512-560。
- **Per-turn handoff** (`handlePrompt`,~1370-1387): 三步走 —— `currentDataPilotSystemPrompt = msg.systemPrompt` 更新闭包 → `await session.resourceLoader.reload()` 让 loader 重新拉 override 值缓存到 `loader.systemPrompt` → `session.setActiveToolsByName(session.getActiveToolNames())` 强制触发 SDK 的 `_rebuildSystemPrompt`,后者重新读 `loader.getSystemPrompt()` 并把 DataPilot 的 prompt 当作 `customPrompt` 走 `buildSystemPrompt`(SDK 端 `system-prompt.js:19-41`),完全替换 Pi 默认前言,仍 append contextFiles + skills + date + cwd。**注意:`loader.reload()` 单独是不够的** —— 它只更新 loader 自己的缓存,不会触发 agent 的 `_baseSystemPrompt` 重建,后续 `agent.prompt()` 会用 session-creation 时缓存的 `_baseSystemPrompt`(那时闭包还是 undefined → 走 Pi default 分支)重置 `state.systemPrompt`。`setActiveToolsByName` 是 SDK 公开 API 里**唯一**会调 `_rebuildSystemPrompt` 的入口(传当前 tool 列表 = no-op tool change,但带来 prompt rebuild 的副作用)。
- **Module-level closure variable** (~232): `currentDataPilotSystemPrompt: string | undefined`。Closure 模式必需,因为 `systemPromptOverride` 在 session 构造时一次性注册,而 `msg.systemPrompt` 是 per-turn。

**Why this constraint matters(踩坑警告):** 上游 `pi-agent-server` **不装** resource loader,所以 `agent.state.systemPrompt = msg.systemPrompt` 直接赋值就活到 LLM。我们装了 resource loader 之后,**Pi SDK 的 `_rebuildSystemPrompt` 会在每个 turn / tool change 时把 `agent.state.systemPrompt` 覆盖回 buildSystemPrompt 的输出**。如果回退到直接赋值的形态(老代码 / 上游 merge 引入相似 pattern / 看着多余把 closure 删掉),DataPilot 的 prompt body **会静默丢失**,LLM 看到的是 Pi 默认 `"You are an expert coding assistant operating inside pi..."` 而不是 DataPilot 的 `getSystemPrompt()` 输出。bug 表征:Agent 不知道 html-preview 块怎么写、忽略 Configuration Documentation 表里的 doc 引用、自称是 pi 而不是 DataPilot。

**Conflict trigger:** (a) 上游修改 `pi-agent-server` 的 `prompt` IPC handler 系统 prompt 处理路径; (b) 上游引入自家 resource loader 安装逻辑; (c) Pi SDK 升级改 `_rebuildSystemPrompt` 触发条件 / `customPrompt` 语义 / 暴露新公开 API 直接触发 rebuild(届时可以把 `setActiveToolsByName` no-op trick 替换掉); (d) 任何"看上去更简单"的重构想把 closure + reload + setActiveToolsByName 改回直接赋值。

### MEDIUM Risk — Check After Upstream Changes

#### `apps/electron/src/renderer/components/app-shell/CompactSessionMenu.tsx` `[Granular Flags + Lite UI]`

Upstream v0.9.3 引入的 compact-mode session menu。fork 端的 `SessionMenu` 已有 3 个 gate：`!FEATURE_FLAGS.disableMessaging`（Messaging row）、`!isWebMode`（Show in Finder row）、password-share submenu。三个 gate 均已适配（v0.9.5 merge 确认 `SharePasswordDialog` + change-password row 已齐备）。

**Conflict trigger:** 上游重构 CompactSessionMenu 行结构或新增 Row → 检查 gates 是否还在。



Fork 删除了三个 session 自管理 MCP tool 及其 handler:`list_sessions`、`get_session_info`、`update_user_preferences`。能力收敛到 `datapilot session list/info` + `datapilot preference set`(CLI 是产品内 agent 的唯一入口);新增 RPC handlers 在 `server-core/src/handlers/rpc/sessions.ts`,补齐 SessionManager 接口。`prompts/system.ts` 同步删去对这三个 tool 的引用。

**Conflict trigger:** 上游对这三个 handler 做扩展(新字段、新 dispatch 路径)→ 不要回采,把变化吸收进对应 CLI 命令或 RPC handler。v0.10.1 实证:upstream 不仅改 `update-preferences.ts` handler,还**新增了它的测试** `update-preferences.test.ts` —— modify/delete 冲突保留删除后,记得把新加的 `.test.ts` 也一并 `git rm`(否则 import 已删 handler,tsc 挂)。

#### `packages/shared/src/agent/backend/factory.ts` `[Custom Endpoint Fix]`

`resolveModelForProvider()`: (1) skips cross-provider guard when `connection.customEndpoint` is set; (2) resolves tier-hint short names against connection model list. If upstream fixes the guard, change (1) can be dropped.

#### `packages/shared/src/agent/backend/internal/drivers/pi.ts` `[Custom Endpoint Fix]`

`validateStoredConnection()` 走真实 API 调用（fork 添加 `testOpenAICompatible()` ~70 行）。冲突时保留 fork 版本——上游的占位实现对 custom endpoint 永远 pass。

#### `packages/shared/src/agent/claude-agent.ts` `[Batch]`

Batch context reading → `batchOutputSchema` passed to `buildContextParts()`.

#### `packages/shared/src/agent/pi-agent.ts` `[Batch + Perf]`

`setupTools()` passes `includeBatchOutput` and `batchMode`; `createSessionToolContext()` passes `batchContext`. **`[Perf]`** Pi subprocess spawns merge `resolveNodeCompileCacheEnv()` into the env (sets `NODE_COMPILE_CACHE` so V8 compile artifacts persist across the per-item batch spawns; Node ≥22.1 only, parent-env value wins). See shared CLAUDE.md Notes.

**Conflict trigger:** upstream changes the Pi subprocess spawn/env wiring → re-thread the compile-cache env merge.

#### `packages/shared/src/agent/claude-context.ts` `[Batch]`

Extended `ClaudeContextOptions` with `batchContext?`; added `validateBatches` to `ValidatorInterface`.

#### `packages/shared/src/agent/core/prompt-builder.ts` `[Batch]`

Context is split into `buildVolatileContextParts(options, sourceBlock)` + `buildStableContextParts(options?)` (composed by `buildContextParts`) for prompt caching (#862). Fork's `<batch_output_instructions>` block (gated on `options.batchOutputSchema`) rides the **stable** builder — batch schema is session-fixed, so it belongs in the cached prefix. Fork made the stable builder's `options` param optional so upstream's `buildStableContextParts()` callsites (tests) still compile.

**Conflict trigger:** upstream rebalances which blocks are volatile vs stable, or makes `buildStableContextParts` argless again → re-thread `batchOutputSchema` through whichever builder carries stable content.

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

#### `packages/shared/src/projects/index.ts` + `agent/{claude,pi}-agent.ts` project imports `[SQLite]`

`projects/index.ts` re-exports config CRUD from `storage.db.ts` (upstream's file-based `storage.ts` kept untouched as reference — port semantic changes into `storage.db.ts`). Filesystem-only ops (path helpers, `loadProjectMemory`, asset list/delete) pass through from `storage.ts`; `uploadProjectAsset` is reimplemented in `storage.db.ts` because its existence gate is now a DB lookup, not a `config.json` check. Both agents' `resolveProjectContext` imports were repointed from `'../projects/storage.ts'` to `'../projects/index.ts'` — if upstream adds new direct `storage.ts` imports, repoint them at `index.ts` so the DB switch stays a single seam.

#### `apps/electron/src/renderer/components/app-shell/kanban/{KanbanBoardContainer,TaskEditor}.tsx` `[Windowed List]`

Upstream derives board tiles straight from `sessionMetaMapAtom`; the fork's map only holds the loaded window. The container now merges `useKanbanBoardMetas` rows UNDER the window map (window entries win — they receive live patches), routes optimistic writes through `patchMeta` (double-writes window atom + board-local rows), and hands TaskEditor a `readMetaMap` one-shot reader for its subscription-free prefill. On conflict: keep the merged-map plumbing, adopt upstream's tile/derivation changes inside the `tasks` memo.

#### `packages/server-core/src/transport/server.ts` + `transport/codec.ts` `[Perf]`

`server.ts`: slow-client backpressure (`backpressureThresholdBytes`/`backpressureGraceMs`, terminate after grace window on a congested `bufferedAmount`); shared event serialization (`serializeEnvelopeBody` once, broadcast the same buffer to all recipients); `perMessageDeflate: PER_MESSAGE_DEFLATE` on every `WebSocketServer`. `codec.ts`: added `serializeEnvelopeBody`. **`perMessageDeflate` only takes effect under Node** — Bun's ws shim silently ignores it (this is *why* the Docker server runs Node; see server-core CLAUDE.md).

**Conflict trigger:** upstream refactors the transport server, the broadcast/serialization path, or the `WebSocketServer` construction — re-apply backpressure + shared-serialization + deflate. Upstream actively evolves transport (v0.10.0 extended `RpcServer`); inspect manually.

#### `packages/ui/src/components/markdown/Markdown.tsx` `[Perf]`

Block-level memoization via `split-markdown-blocks.ts` — streaming markdown is split into block chunks each memoized independently, so a new token only re-parses its trailing block instead of the whole document. Cross-platform UI file; upstream owns it.

**Conflict trigger:** upstream rewrites the markdown renderer or its prop shape → re-thread block splitting + memo boundaries.

#### `Dockerfile.server` + `packages/server-core/src/webui/{http-server,auth,node-adapter}.ts` `[Perf / Runtime]`

`Dockerfile.server`: base image Node 20 → **Node 22** (`better-sqlite3` prebuild + Electron ABI match); main process `CMD` runs under **Node, not Bun** (real `ws` package → permessage-deflate); `better-sqlite3` prebuild-install step; Pi bundle built `--format esm` (Node CJS loader chokes on Bun's `import.meta`); `DATAPILOT_PI_NODE_BIN`/`DATAPILOT_PI_INTERCEPTOR` env for the Node Pi subprocess. webui made Node-compatible: `http-server.ts` login redirect built manually (302 + `Location`, not `Response.redirect` — undici rejects a relative URL there); `auth.ts` password hashing swapped `Bun.password` argon2id → `node:crypto` scrypt (the hash lives only in process memory, so no migration impact). Production traffic goes through `createWebuiHandler` + `node-adapter.ts`, not the Bun-only `startWebuiHttpServer`.

**Conflict trigger:** upstream changes `Dockerfile.server` runtime/CMD, the webui server entry, or assumes a Bun-only API in a request handler. **Don't "simplify" the Docker CMD back to `bun run`** — it silently drops ws compression and the Node Pi-subprocess speedup. Runtime-neutrality rule + the why are in server-core CLAUDE.md.

#### `packages/server-core/src/bootstrap/headless-start.ts` `[Perf]`

Wires the periodic idle-hibernate sweep into headless server startup.

**Conflict trigger:** upstream restructures headless bootstrap → re-attach the sweep registration.

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
| `packages/shared/src/config/watcher.ts` | Batch + Perf | `onBatchesConfigChange` callback; **`[Perf]`** DB-mode selective `fs.watch` — non-recursive root + only `sources/`/`skills/`/`statuses/` subtrees, never recursive over `sessions/` (see shared CLAUDE.md DB-mode watch-scope invariant). New file-watched subtree → add to `watchWorkspaceDir`'s list, don't widen back to root. |
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
| `apps/electron/vite.config.ts` | Flags | `define` for 6 `DATAPILOT_DISABLE_*` + `DATAPILOT_LITE_UI` env vars |
| `apps/webui/vite.config.ts` | Flags | Same `define` set as electron — webui is browser-only so the literal substitution is mandatory (no runtime `process.env`). 漏哪个 flag → renderer 静默读 undefined → UI 不响应该 flag |
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
| `projects/storage.ts` (config shape, CRUD semantics, asset gating) | Port into `projects/storage.db.ts` + `db/schema/projects.sql.ts` (new columns need a migration); path/memory/asset helpers pass through unchanged |
| Kanban board data derivation (`KanbanBoardContainer`, `TaskEditor`) | Merged-map plumbing intact (`useKanbanBoardMetas` + `patchMeta` + `readMetaMap`); new optimistic writes must go through `patchMeta`, not `updateSessionMeta` alone |
| `package.json` exports | Our `.db.ts` subpath exports + batch exports preserved |
| System prompt CLI section | Must remain mandatory ("MUST use"), not soft ("Prefer") |
| PreToolUse pipeline | Config domain bash guard and CLI redirect preserved |
| New config domains | Add to `cli-domains.ts`, implement CLI commands, add PreToolUse guards |
| Automations config format | Update `apps/cli/src/datapilot/commands/automation.ts` parsing |
| `packages/session-tools-core/tsconfig.json` | Don't blindly take upstream — fork's tsconfig is self-contained (`target/lib: ESNext`, all options inline). Upstream extends `../../tsconfig.base.json` which doesn't exist in their repo, masking their own tsc errors (e.g. v0.9.1: regex `/es6/` flag, `Set` iteration without `downlevelIteration`). Adopting upstream's version would inherit those errors. |
| `RpcServer` interface (`packages/server-core/src/transport/types.ts`) | Every fake/mock `RpcServer` in test files (grep `RpcServer = {` or `createMockServer`) needs the new method. Fork's `updateClientWorkspace` stays required — upstream periodically redeclares it as optional, discard. v0.10.0 added `hasClientCapability` + `findClientsWithCapability` to 8 mocks. |
| `transport/server.ts` or `codec.ts` `[Perf]` | Backpressure guard + shared `serializeEnvelopeBody` broadcast + `perMessageDeflate` preserved on every `WebSocketServer` |
| `Dockerfile.server` or webui server entry `[Perf]` | CMD still runs under Node (not `bun run`); `better-sqlite3` prebuild step + Node-22 base intact; Pi bundle still `--format esm`; no Bun-only API leaked into a request handler |
| `Markdown.tsx` `[Perf]` | Block-split + per-block memo re-threaded onto upstream's renderer |
| Session persist/save call sites or `ManagedSession` shape `[Perf]` | Streaming-persist tier discipline holds (in-place edits flow through `persistSessionMessages`); new runtime-only fields persisted or guarded in `isHibernationSafe`/`isIdleHibernationSafe` |
| `config/watcher.ts` watch wiring `[Perf]` | DB-mode watch stays non-recursive (no recursive `sessions/` watch) |
| New config/i18n **test files** upstream adds (spawn-subprocess pattern) | They hard-code `CRAFT_CONFIG_DIR` to isolate the tmpdir; fork's `paths.ts` reads `DATAPILOT_CONFIG_DIR`. A wrong env var = test silently uses the real `~/.datapilot` and fails. After merge, grep new `*.test.ts` for `CRAFT_CONFIG_DIR` → rename to `DATAPILOT_CONFIG_DIR`. v0.10.1 hit this in `preferences-ui-language.test.ts` + `i18n-bootstrap.test.ts`. |
| `apps/electron/scripts/build-{dmg,linux}.sh` + `build-win.ps1` | Fork refactored the inline Bun-download + SDK-staging + ripgrep + interceptor-copy block into a single `scripts/electron-stage-runtime-deps.ts` call. Upstream still edits that inline block, so it conflicts whenever upstream touches these scripts. **Take fork's side (`git checkout --ours`)** — upstream's edits land in the block the fork deleted, so they're moot. v0.10.4: upstream only dropped a `plans/sdk-uplift-plan.md` comment ref. |
| Fork-only dependency **pins** in root `package.json` `overrides`/`resolutions` | These go **stale silently** when upstream reverts a version. tsc/tests won't catch it — only an `esbuild` bundle (`electron:build:main`) does. After every merge, run `bun install && bun run electron:build:main` and diff fork-vs-upstream `@sentry`/SDK versions. v0.10.1: fork's `@sentry/core@10.50.0` pin (added v0.9.1 for upstream's then-7.13.0) was stranded above upstream's reverted `@sentry/electron@7.7.0`/core 10.36.0 → `_INTERNAL_getSpanForToolCallId` missing → bundle broke. Pin removed to track upstream. |

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

# Node server bundle (Docker runtime) — catches Bun-only API leaks the
# Electron/Bun build won't, e.g. an upstream handler calling Bun.* on the
# request path. Must bundle clean for the Node CMD to boot.
bun run scripts/build-server-node.ts
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
| v0.9.1 | 2026-05-06 | 17 | Pinned `@sentry/core@10.50.0` via root `package.json` `overrides`+`resolutions` — upstream's `@sentry/electron@7.13.0` (core 10.50.0) and `@sentry/react@10.51.0` (core 10.51.0) otherwise pull mismatched core types and break renderer typecheck. **[OBSOLETE — pin removed at v0.10.1.]** `TOKEN_LIMIT` → `tokenLimitFor(contextWindow)` in `pi-agent-server` (large-response.ts re-exports `TOKEN_LIMIT` for legacy callers). |
| v0.9.2 | 2026-05-10 | 6 | Upstream introduced `applySystemPromptOverride()` (new file `pi-agent-server/src/system-prompt-override.ts`) for the Pi per-turn-prompt-reset problem — same root cause as our resourceLoader integration. Adopted upstream's helper at the ephemeral `queryLlm` call site (no resourceLoader there), but **kept fork's closure + reload + setActiveToolsByName** at `handlePrompt` because upstream's helper rewrites `_rebuildSystemPrompt = () => prompt`, bypassing our resourceLoader's append of contextFiles/skills/date/cwd. Guide entry for `pi-agent-server/src/index.ts` already calls this out — left as-is. Browser Tools section in `system.ts` was factored into `browserToolsSection` const upstream; gated on both `getBrowserToolEnabled()` (upstream runtime toggle) and our `!FEATURE_FLAGS.disableBrowser && !isBatch` (build-time + batch). Upstream's new oauth-refresh regression test (`sendmessage-oauth-refresh.test.ts`) marked `it.skip` — fork's sendMessage harness needs more setup than upstream's; fix is verifiable by reading SessionManager.ts (refresh at L6191 < getOrCreateAgent at L6203). |
| v0.9.3 | 2026-05-14 | 17 | Mobile/compact UI rework (new CompactSessionMenu, CompactWorkspaceSwitcher, CompactSessionListFilter, FabNewChat, etc.); Manifest provider preset; upstream extracted share actions into `useSessionMenuActions` hook and refactored `ShareMenuItems` API — fork's password-dialog share flow adapted to new callback API. Upstream's `AppMenu` extraction adopted, fork's inline TopBar menu handlers dropped. Added `'batches'` to new `nav-helpers.ts` switch. |
| v0.9.4 | 2026-05-16 | 8 | RTK Bash token compression (opt-in), Pi SDK 0.73.1 (Codex transport stability), `SkillMenu` API switched to required `onShowInFinder` + new `canShowInFinder` prop — fork's web-mode hide-gate moved *inside* `SkillMenu.tsx` (callers now just pass `canShowInFinder={canRevealLocally}` and the platform gate stays in one place). `apps/cli/package.json` version kept on fork's independent cadence (0.1.5), not bumped to upstream's 0.9.4. |
| v0.9.5 | 2026-05-23 | 12 | Compact model picker + working-directory selector; Pi turn-anchor sidecar for branch-of-branch; source activation drain; MCP validation refactor; `AcceptPlanDropdown` switched to Radix `DropdownMenu`. Upstream's new `groupConnectionsByProvider` helper adopted in `model-picker-helpers.ts` but fork's inline `FreeFormInput` grouping kept (uses `isAnthropicProvider` for `anthropic_compat`). |
| v0.9.6 | 2026-05-26 | 7 | Ported orphan-credential cleanup from upstream's `storage.ts` into fork's `storage.db.ts`; adapted its test for SQLite driver. |
| v0.10.0 | 2026-05-27 | 13 | Remote `browser_tool` bridging — upstream extended `RpcServer` with `hasClientCapability` / `findClientsWithCapability`; every fork test mocking `RpcServer` (8 files) needs both new methods AND fork's `updateClientWorkspace`. Conflict in `transport/types.ts`: upstream redeclared `updateClientWorkspace` as optional — keep fork's required form. `pi-agent.ts`: fork's batch tool-defs gating and upstream's `getBrowserToolEnabled()` filter combine sequentially on `sessionToolDefs`. |
| v0.10.1 | 2026-06-05 | 16 | **Upstream absorbed the fork's cross-process UI-language persistence** — reimplemented as a canonical internal `uiLanguage` field + `getPersistedUiLanguage`/`setPersistedUiLanguage` helpers (legacy free-text `language` field removed, scrubbed on read). Took upstream's helpers/hydration (`main/index.ts`, `main.tsx`) wholesale; rebased fork's two standing decisions onto them — (a) `formatPreferencesForPrompt` still omits the language hint when no authoritative source (headless server never inits i18n), now reading `getPersistedUiLanguage()`; (b) `SessionManager` title-gen still passes no language (content auto-detect). `validators.ts`: kept fork's `.nullable()` clear-semantics, dropped `language`, added upstream's `uiLanguage` enum. `factory.ts` `resolveModelForProvider`: merged fork's tier-hint resolution + custom-endpoint guard-skip with upstream's `normalizeDeprecatedModelId` + `connectionDefault`. `update_user_preferences` removal recurred (see risk entry). |
| v0.10.2+v0.10.3 | 2026-06-10 | 11 | Merged together in one commit. Upstream split per-turn context into volatile/stable builders for prompt caching (#862); fork's batch-output block re-threaded through `buildStableContextParts` (now takes optional `options`). `link` label valueType + Fable model + duplicate-Anthropic-account badge adopted as-is (locales arrived pre-translated). |
| v0.10.4 | 2026-06-25 | 10 | **Pi SDK 0.73.1 → 0.79.9, scope migrated `@mariozechner/*` → `@earendil-works/*`** — rename auto-applied to every Pi import (upstream touched all Pi-importing files); Pi packages are now under `@earendil-works`. **Upstream absorbed the fork's title-gen auto-detect**: `resolveTitleLanguageName()` (disk-backed `uiLanguage`, race-free, undefined→auto-detect) replaces the fork's commented-out i18n block + "pass no language" hack — the v0.10.1 "SessionManager passes no language" divergence is gone, take upstream at both title sites. |
| v0.10.5 | 2026-07-03 | 5 | Tiny release — `claude-sonnet-5` added to `models.ts` registry + Bedrock maps (no fork divergence in `models.ts`, applied clean) and `llm-connections.ts` (auto-merged: fork's `anthropic_compat` region is disjoint from upstream's model-map region). All 5 conflicts were the recurring package.json version/branding + bun.lock pattern. Upstream repurposed `model.sonnetDesc`'s meaning ("everyday tasks" → "speed + intelligence"); the fork's 6 non-en locales still carry the old translation — same drift recurs whenever upstream edits an en.json string the fork translates. |
| v0.11.0+v0.11.1 | 2026-07-11 | 42 | **Projects & Kanban Tasks (Beta) + background-agent keep-alive + GPT-5.6.** Biggest upstream release since fork. Structural decisions: (a) **8 new persisted session fields** (`projectId`, `parentSessionId`, `kanbanColumn`, `taskSlug`, `taskRunId`, `taskNodeId`, `taskNodeCount`, `taskDraft`) ported into `sessions.sql.ts` columns + migration `0007_projects_tasks` + all three row converters in `storage.db.ts`; `setSessionProjectId`/`unbindProjectFromSessions` reimplemented as SQL updates (upstream's are per-session load/save loops). (b) **Project filter threaded through the fork's server-driven list pipeline** — upstream filters projects client-side; fork added `projectInclude/projectExclude` to `SessionListPageFilter` + `sessionWhereClause` (SQL) + `managedMatchesPageFilter` (in-memory mirror) + `buildSessionListFilter`. (c) `list_sessions`/`get_session_info` tool removal **recurred** (upstream's new `list_background_tasks` sits adjacent in every conflicted list — keep it, drop the other two); `listSessionsFn` wiring in SessionManager dropped, `listBackgroundTasksFn` kept. (d) **Hibernation guard extended**: upstream's `backgroundTaskRegistry` (runtime-only Map on ManagedSession) added to `isHibernationSafe` — a `running` entry blocks hibernation, else keep-alive background agents die silently in the idle sweep. (e) `CRAFT_KEEP_BG_AGENTS_ALIVE` → `DATAPILOT_KEEP_BG_AGENTS_ALIVE`; upstream's new runtime `CRAFT_DISABLE_MESSAGING` check in `packages/server` renamed to the fork's existing `DATAPILOT_DISABLE_MESSAGING` name (build-time + runtime now share one env var). (f) `getSystemPrompt` gained TWO new trailing params — fork `batchMode` stays 8th, upstream `projectContext` becomes 9th; both call sites (claude-agent, pi-agent) pass both. (g) `executePromptAutomation` dispatch is now a 3-way branch: `isBatch` (fork fire-and-forget) → `waitForCompletion === false` (upstream test-run) → await. (h) Upstream moved `session_created` emission into `createSession(internal.emitCreatedEvent)`; fork's manual emissions at spawn/automation sites removed, but `onSessionCreated?.()` batch callback kept. (i) `loadSessionsFromDisk` deletion recurred — upstream's `enabledSourceSlugs` seeding fix is a no-op in the fork (createManagedSession spreads all header fields). (j) Projects/Tasks storage (`shared/src/projects/storage.ts`, `shared/src/tasks/storage.ts`) is upstream's **JSON-file based** — left as-is (new subsystem, no SQLite migration attempted; candidate for later). Known gap: KanbanBoardContainer reads `sessionMetaMapAtom`, which in the fork only holds the loaded window — board may be incomplete in huge workspaces until the list is scrolled (upstream Beta). Pre-existing (not merge-caused): `refresh-connection-runtime.test.ts` shape-check test fails at HEAD too; `lint:i18n:coverage` references a script that never existed. |
| (follow-up) | 2026-07-11 | — | **Post-merge adaptation of the two v0.11.0 deferred items.** (1) Projects config storage migrated to SQLite: new `projects` table (`db/schema/projects.sql.ts`, migration `0008_projects`) + `projects/storage.db.ts` mirroring upstream's `storage.ts` API 1:1; `projects/index.ts` re-exports switched; both agents' direct `'../projects/storage.ts'` imports repointed at `index.ts`. Assets/ + MEMORY.md stay filesystem (agent-facing artifacts); `uploadProjectAsset` reimplemented (existence gate is a DB lookup now); legacy `config.json` files import once on first read (only while the table is empty) and rename to `.migrated`. No dbEvents added — project mutations propagate via the existing `broadcastChanged` full-list push in `rpc/projects.ts`, which needed zero changes. (2) Kanban board window gap fixed: `useKanbanBoardMetas` fetches the board population server-side (`listSessionsPage`, `{archived:false, batch:false}`, recent-first, server clamp 1000 — over-cap logged, not silent); container merges rows UNDER the window map, optimistic writes go through `patchMeta` (window atom + board rows), TaskEditor prefill reads through a `readMetaMap` one-shot getter. Project filtering stays client-side on purpose (quick-add subtasks may carry no projectId but their parent tile needs them for run state). **Still deferred: Tasks runs storage** (`tasks/storage.ts` — task.yaml + run-log.jsonl + node JSON files). TaskRunner is upstream Beta with a fast-evolving `RunLogEntry` union; owning it now buys little (small data volume) and costs a permanent merge-port burden. Revisit when upstream stabilizes (~v0.12): the natural shape is `task_runs`/`task_run_events`/`task_run_nodes` tables (batches precedent), keeping `task.yaml` on disk as the editable spec. |
