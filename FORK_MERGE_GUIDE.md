# Fork Merge Guide

> Records all fork changes relative to `upstream/main` (lukilabs/craft-agents-oss).
> Purpose: identify conflict zones, understand intent, make informed merge resolution decisions.
>
> **Last updated after:** v0.8.6 merge (chunked session transfers, custom endpoint image support, i18n EN/ES/zh-Hans/JA)

## Overview

Our fork adds four categories of changes:

1. **Batch Processing System** — Processes large lists of items (CSV/JSON/JSONL) by running a prompt action per item as an independent agent session. Modeled after the **Automations** architecture; if upstream refactors automations, batch code likely needs the same treatment.

2. **Granular Feature Flags** — Five independent build-time flags replacing the old monolithic `LITE_VERSION`: `DATAPILOT_DISABLE_OAUTH` (4 OAuth tools + onboarding providers), `DATAPILOT_DISABLE_BROWSER` (browser_tool + prompt sections), `DATAPILOT_DISABLE_VALIDATION` (mermaid_validate, skill_validate), `DATAPILOT_DISABLE_TEMPLATES` (render_template, script_sandbox), `DATAPILOT_LITE_UI` (What's New, Help menu, Backlog/Needs Review statuses). Each flag independently controls its tool set and corresponding system prompt sections.

3. **Preset Preservation Fix** — Fix to `resolvePresetStateForBaseUrlChange()` preserving Pi SDK provider routing when a preset points at a custom proxy endpoint.

4. **Custom Endpoint Runtime Fixes** — Four fixes for upstream's custom endpoint system introduced in v0.7.4: (a) `queryLlm()` provider compatibility check now exempts `custom-endpoint` models so they aren't incorrectly rejected and forced to fallback; (b) `validateStoredConnection()` in the Pi driver makes actual API calls (Anthropic or OpenAI-compatible) instead of returning `{ success: true }` unconditionally; (c) `resolveModelForProvider()` skips the cross-provider model guard for custom endpoint connections so UI model selection isn't silently overridden by `defaultModel`; (d) `resolveModelForProvider()` resolves tier-hint short names (`'haiku'` → `getMiniModel()`, `'sonnet'`/`'opus'` → `connection.defaultModel`) against the connection's model list, so EditPopover mini-agent sessions route to the user's custom endpoint instead of falling back to built-in providers.

5. **Border-Radius Theme Tokens** — Overrides Tailwind v4's default `--radius-*` CSS variables to `0px` in `:root` for sharp-corner branding. Converts all hardcoded `rounded-[Npx]` arbitrary values to standard Tailwind classes (`rounded-sm`, `rounded-lg`, etc.) so they flow through the CSS variable system. CSS files with hardcoded `border-radius` pixel values are also converted to `var(--radius-*)`.

6. **Self-Hosted Viewer Server** (`apps/viewer-server/`) — Standalone HTTP backend for hosting shared session transcripts, replacing the upstream-only `agents.craft.do` service. Provides CRUD API (`/s/api`) with pluggable storage (filesystem default, S3-compatible optional). Serves the `apps/viewer` frontend as static files. Separate `Dockerfile.viewer` for independent deployment on port 9101. `VIEWER_URL` in `branding.ts` made configurable via `CRAFT_VIEWER_URL` env var.

7. **Docker Compose Deployment** (`docker-compose.yml`, `.env.docker`) — One-command deployment for server (port 9100, Web UI + RPC) and viewer (port 9101, session sharing). Uses `.env` file for configuration (`CRAFT_SERVER_TOKEN` etc.). `CRAFT_HEALTH_PORT` enables container health checks. If upstream adds its own compose file, merge carefully — our version includes the fork-only viewer service.

---

## New Files (Low Conflict Risk)

These won't conflict unless upstream adds similarly-named features.

### Batch Core — `packages/shared/src/batches/`

Types, schemas, CSV/JSON/JSONL parser, state persistence, processor (lifecycle + concurrency + retry), output instruction builder, validation. 5 test files (~1300 lines). `BatchConfig` supports optional `workingDirectory` (absolute path) to override the workspace default for batch sessions.

**Cross-module dependency:** `batch-processor.ts` imports `expandEnvVars()` from `automations/utils.ts` and `sanitizeForShell()` from `automations/security.ts`. If upstream renames/moves these, batch-processor breaks.

### Batch Output Tool — `packages/session-tools-core/src/handlers/batch-output.ts`

Handler + tests: coerces stringified JSON, validates against output schema via **ajv**, upserts JSONL records (same `_item_id` replaces previous record).

### Batch RPC Handlers — `packages/server-core/src/handlers/rpc/batches.ts`

13 RPC handlers (LIST, START, PAUSE, RESUME, GET_STATUS, GET_STATE, GET_ITEMS, SET_ENABLED, DUPLICATE, DELETE, TEST, GET_TEST_RESULT, RETRY_ITEM). Mirrors `automations.ts` structure. All handlers use `ensureBatchProcessor()` (lazy-init-on-demand) instead of `getBatchProcessor()` to guarantee the processor is available. Mutation handlers (SET_ENABLED, DUPLICATE, DELETE) call `notifyBatchesChanged()` after writing to disk.

### Batch UI — `apps/electron/src/renderer/components/batches/`

`BatchesListPanel`, `BatchInfoPage`, `BatchActionRow`, `BatchItemTimeline`, `BatchMenu`, `BatchAvatar`, types. All mirror automations UI components. `BatchInfoPage` displays `workingDirectory` in the Execution section when configured.

**UI dependencies:** `Info_Page`, `EntityListEmptyScreen`, `EntityRow`, `EditPopover`, `SessionSearchHeader`, `useMenuComponents()`, `useNavigation()`, Jotai atoms, Sonner toasts.

### Batch State & Hooks

- `atoms/batches.ts` — Jotai atom
- `hooks/useBatches.ts` — mirrors `useAutomations` (minus toggle)

### Batch CLI — `packages/batch-cli/`

Standalone `craft-agent-batch` binary: 7 subcommands (list, get, validate, status, create, update, enable/disable). All logic delegates to `@craft-agent/shared/batches`. `create` and `update` support `--working-directory` flag.

- `src/workspace.ts` resolves workspace root: `--workspace-root` → `CRAFT_WORKSPACE_PATH` env → `CRAFT_AGENT_WORKSPACE_ROOT` env → walk-up → CWD
- Wrapper scripts: `apps/electron/resources/bin/craft-agent-batch{,.cmd}` — invoked via `CRAFT_BATCH_CLI_ENTRY` env var set in `main/index.ts`

### Batch Documentation

- `apps/electron/resources/docs/batches.md` — agent reference doc
- `apps/electron/resources/docs/craft-cli.md` — added `<!-- cli:batch:start/end -->` section

### Self-Hosted Viewer Server — `apps/viewer-server/`

Standalone Bun HTTP server providing the session sharing backend that upstream hosts at `agents.craft.do`. Entry point (`src/index.ts`), API routes (`src/routes.ts`), storage interface with filesystem (`src/storage/fs.ts`) and S3-compatible (`src/storage/s3.ts`) implementations. `Dockerfile.viewer` at repo root for independent container deployment.

**Cross-module dependency:** `apps/viewer/dist` must be built first (`bun run viewer:build`) — the server serves these static files. `@aws-sdk/client-s3` is an optional dependency, only needed for S3 storage mode.

---

## Modified Upstream Files (Conflict Zone)

### HIGH Risk — Always Inspect Manually

These files are frequently touched by upstream and have substantial fork modifications.

#### `packages/server-core/src/sessions/SessionManager.ts`

- Added `batchProcessors: Map<string, BatchProcessor>` with per-workspace init, callbacks (`onExecutePrompt`, `onProgress`, `onBatchComplete`, `onError`), config watcher, broadcasting
- Modified `executePromptAutomation()`: added `isBatch`, `batchContext`, and `workingDirectory` params (coexist with upstream's `automationName`)
- Session completion handler notifies batch processors
- Added `getBatchProcessor()`, `broadcastBatchesChanged()`, cleanup in `dispose()`
- **Eager initialization:** Extracted `ensureBatchProcessor()` and `ensureAutomationSystem()` as public idempotent methods. Called from `initialize()` (server startup — all workspaces), `createSession()` (before agent starts), and batch RPC handlers. Fixes race conditions where sessions/RPCs arrive before `setupConfigWatcher` is triggered by the UI
- **Mutation broadcasting:** Added public `notifyBatchesChanged()` and `notifyAutomationsChanged()` methods that wrap the private broadcast methods. Called by RPC mutation handlers to push changes to the UI without relying on ConfigWatcher's `fs.watch()`
- v0.7.12 upstream also changed Claude session bootstrapping: restores managed Anthropic env vars via `resetManagedAnthropicAuthEnvVars()`, adds branch-fork fallback message plumbing, and reads `enable1MContext` from global config storage instead of workspace defaults

**Pattern:** Mirrors automationSystems management. `automationName` passthrough follows upstream's naming flow.

#### `apps/electron/src/renderer/components/app-shell/AppShell.tsx`

- **Batch:** sidebar nav item + count badge, "Add Batch" button (EditPopover), `BatchesListPanel` rendering, delete dialog, `useBatches()` hook, `batchHandlersRef` prop, context extension, "Batch Sessions" trailing sidebar item under All Sessions (filters `isBatch` sessions)
- **Lite UI:** conditional "What's New" button via `...(!FEATURE_FLAGS.liteUi ? [...] : [])`

**Pattern:** Batch mirrors automations integration. Lite UI uses conditional spread.

#### `packages/session-tools-core/src/tool-defs.ts`

- **Batch:** Added `batch_output` tool def (with `safeMode: 'allow'`), `BatchOutputSchema`, `'batches'` target in `ConfigValidateSchema`
- **Batch:** Extended `SessionToolFilterOptions` with `includeBatchOutput?: boolean` and `batchMode?: boolean`
- **Batch:** Added `BATCH_EXCLUDED_TOOLS` set (14 tools: `SubmitPlan`, `config_validate`, `skill_validate`, `mermaid_validate`, `source_test`, 4 OAuth triggers, `source_credential_prompt`, `update_user_preferences`, `render_template`, `transform_data`, `send_developer_feedback`) — strips UI/interaction tools from batch sessions
- **Granular flags:** Added per-category tool sets (`OAUTH_TOOLS`, `BROWSER_TOOLS`, `VALIDATION_TOOLS`, `TEMPLATE_TOOLS`) with corresponding `disableOauth`, `disableBrowser`, `disableValidation`, `disableTemplates` options in `SessionToolFilterOptions`
- Modified `getSessionToolDefs()` and `getToolDefsAsJsonSchema()` to filter/propagate all granular flags and `batchMode`

**Pattern:** `includeBatchOutput`, `disableOauth/Browser/Validation/Templates`, and `batchMode` all mirror `includeDeveloperFeedback`.

#### `packages/shared/src/agent/session-scoped-tools.ts`

- **Batch:** Added batch context registry: `registerSessionBatchContext()`, `getSessionBatchContext()`, `cleanupSessionBatchContext()`
- **Batch:** Modified `getSessionScopedTools()`: passes `batchContext` to `createClaudeContext()`, derives `includeBatchOutput`, passes `batchMode: isBatchSession`
- **Granular flags:** Passes `disableOauth/Browser/Validation/Templates` from `FEATURE_FLAGS` to `getSessionToolDefs()`
- **Batch:** In batch mode, conditionally skips backend-specific tools (`spawn_session`, `batch_test`, `browser_tool`) — only `call_llm` is kept
- **Batch:** Modified `cleanupSessionScopedTools()`: also cleans up batch context

**Pattern:** Mirrors existing `sessionScopedToolsCache` Map registry.

### MEDIUM Risk — Check After Upstream Changes

#### `packages/pi-agent-server/src/index.ts` *(Custom Endpoint Fix — resolved in v0.7.7)*

~~Modified `queryLlm()` provider compatibility check in two places~~ — **upstream v0.7.7 adopted the same fix**. Both provider compatibility checks now exempt `custom-endpoint` models. Our fork-specific code was replaced with upstream's cleaner implementation during the v0.7.7 merge. **This fork change is no longer needed.** v0.7.9 added Bedrock provider module pre-registration (`setBedrockProviderModule`) and IAM credential type variant to `PiCredential`. v0.7.11 added Bedrock Pi model tier dropdown handling. v0.8.1 hardened uncaughtException/unhandledRejection handlers with try/catch around `send()` (broken stdout protection) and added `process.exit(1)` after each.

#### `packages/shared/src/agent/backend/internal/drivers/pi.ts` *(Custom Endpoint Fix)*

Added `testOpenAICompatible()` function (~70 lines) for OpenAI-compatible endpoint validation (tries `/chat/completions` then `/v1/chat/completions`). Enhanced `validateStoredConnection()` to make actual API calls for custom endpoints (routes to `testAnthropicCompatible` or `testOpenAICompatible` based on `customEndpoint.api`), with credential-only check fallback for standard Pi connections.

#### `packages/shared/src/agent/backend/factory.ts` *(Custom Endpoint Fix)*

`resolveModelForProvider()`: (1) skips the cross-provider guard (`getModelProvider(model) !== provider`) when `connection.customEndpoint` is set. Without this, custom endpoint models (e.g. `claude-sonnet-4-6` with provider `'anthropic'`) are cleared because the connection resolves to provider `'pi'`, forcing fallback to `defaultModel` on every model switch. (2) Resolves tier-hint short names against the connection's model list: `'haiku'` → `getMiniModel(connection)`, any other unrecognized name (e.g. `'sonnet'`, `'opus'`) → `connection.defaultModel`. This fixes EditPopover mini-agent sessions (batch edit, permissions edit, etc.) sending requests to built-in providers instead of the user's custom endpoint.

**Note:** Upstream v0.7.6 still has the original guard. If upstream fixes this, change (1) can be dropped. Change (2) is fork-specific since EditPopover hardcodes Anthropic short names.

#### `packages/shared/src/agent/claude-agent.ts`

Added batch context reading → `batchOutputSchema` passed to `buildContextParts()` in `buildTextPrompt()` / `buildSDKUserMessage()`.

**v0.7.12 note:** Upstream also added Bedrock env cleanup (`clearClaudeBedrockRoutingEnvVars()`), branch-fork fallback summarization (`getBranchFallbackMessages()` + `generateBranchFallbackContext()`), and moved 1M-context gating to global config semantics. Re-check these areas on future merges.

#### `packages/shared/src/agent/pi-agent.ts`

Same as claude-agent, plus: `setupTools()` passes `includeBatchOutput` and `batchMode` to `getSessionToolProxyDefs()`, `createSessionToolContext()` passes `batchContext`. v0.8.1 upstream added subprocess error deduplication (`lastSubprocessError`, `subprocessErrorRepeatCount`, `resetSubprocessErrorDedup()`) to prevent broken subprocess error floods — auto-merged cleanly around our batch code.

#### `packages/shared/src/agent/claude-context.ts`

Extended `ClaudeContextOptions` with `batchContext?: BatchContext`; added `validateBatches` to `ValidatorInterface`.

#### `packages/shared/src/agent/core/prompt-builder.ts`

`buildContextParts()`: if `batchOutputSchema` present, appends `<batch_output_instructions>` block.

#### `packages/server-core/src/handlers/session-manager-interface.ts`

Added `getBatchProcessor?()` method; extended `executePromptAutomation()` with `isBatch` + `batchContext` + `workingDirectory` params. Added `ensureBatchProcessor()` (returns `BatchProcessor`, creates if needed), `notifyBatchesChanged()`, and `notifyAutomationsChanged()` for explicit mutation broadcasting.
**Note:** This was a 3-way conflict in v0.7.1 merge. Future upstream signature changes will conflict.

#### `packages/server-core/src/handlers/rpc/automations.ts`

Added `automations:list` RPC handler (reads `automations.json`, returns raw config for UI parsing). Mutation handlers (SET_ENABLED, DUPLICATE, DELETE) now call `notifyAutomationsChanged()` after writing to disk, so changes push to the UI immediately without relying on ConfigWatcher.

#### `apps/electron/src/renderer/hooks/useAutomations.ts`

Changed data loading from direct `readFile(rootPath + '/automations.json')` to `listAutomations(workspaceId)` RPC call. This fixes automations not showing in web deployments where the client may not have access to `rootPath`. Subscription to live updates unchanged (still listens for `automations:changed` event).

#### `packages/shared/src/protocol/channels.ts`

Added `automations.LIST` channel (`'automations:list'`).

#### `apps/electron/src/transport/channel-map.ts`

Added `listAutomations` mapping for `automations.LIST` channel.

#### `packages/shared/src/config/validators.ts`

Added `validateBatches` to `validateAll()`, `'batch-config'` to `detectConfigFileType()` / `validateConfigFileContent()`.

#### `packages/shared/src/config/watcher.ts`

Added `onBatchesConfigChange` callback, `handleBatchesConfigChange()` method. Mirrors automations watching.

#### `packages/session-tools-core/src/context.ts`

Added `validateBatches()` to `ValidatorInterface`, `BatchContext` interface, `batchContext?` to `SessionToolContext`.

#### `packages/session-tools-core/src/handlers/config-validate.ts`

Added `'batches'` target in validation switch. Mirrors automations case.

#### `apps/electron/src/renderer/App.tsx`

Added `batchHandlersRef`, routes `batch_progress`/`batch_complete` events.

#### `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`

Added batches navigator rendering branch.

#### `apps/electron/src/shared/types.ts`

Added `BatchFilter`, `BatchesNavigationState`, `isBatchesNavigation()`, batch handling in navigation key functions.

#### `apps/electron/src/shared/route-parser.ts`

Added `'batches'` to `NavigatorType`, `batchFilter` to `ParsedCompoundRoute`, batch parsing/building/conversion in all route functions.

#### `packages/shared/src/config/cli-domains.ts`

Added `'batch'` to `CliDomainNamespace`, `batch` policy entry with `patternPrefix: 'craft-agent-batch'`.

#### `packages/shared/src/agent/core/pre-tool-use.ts`

Added `batch-config` → `batch` mapping in `detectCliNamespaceFromConfigDetection()`, `craft-agent-batch` to token scan exemption. Added `CliFeatureFlags` interface and `isNamespaceGuardActive()` helper for namespace-aware flag routing (`batch` → `batchCli`, all others → `craftAgentsCli`). Both `getConfigCliRedirect()` and `getConfigDomainBashRedirect()` accept optional `flags` param; pipeline passes `{ craftAgentsCli, batchCli }` so guards activate per-namespace.

#### `packages/shared/src/agent/permissions-config.ts`

Added `batchCli` check in `shouldCompileBashPattern()`: suppresses `^craft-agent-batch\s` patterns when `FEATURE_FLAGS.batchCli` is off (symmetric with existing `craftAgentsCli` check for `^craft-agent\s` patterns).

#### `packages/shared/src/prompts/system.ts` *(Lite + Batch CLI)*

Batch CLI guidance (`## Batch CLI` section with `craft-agent-batch --help`) is gated independently by `FEATURE_FLAGS.batchCli`, separate from the main `craftAgentsCli` block. This allows batch CLI to be active without enabling the full craft-agent CLI.

Granular feature flag conditionals spread across the system prompt:
- `disableBrowser`: Doc table Browser Tools row, Browser Tools section (~50 lines), endpoint verification browser mentions
- `disableValidation`: Doc table Mermaid row, mermaid_validate tools block and validate tip
- `disableTemplates`: Source Templates section (~29 lines)

**Risk note:** Upstream frequently modifies the system prompt. If sections are rewritten or reordered, our conditionals may need adjustment.

#### `packages/session-mcp-server/src/index.ts` *(Granular Flags)*

Passes `disableOauth/Browser/Validation/Templates` from `FEATURE_FLAGS` to both `createSessionTools()` and `getSessionToolRegistry()` calls.

#### `apps/electron/src/renderer/components/app-shell/TopBar.tsx` *(Lite UI)*

Wrapped Help `<DropdownMenu>` with `{!FEATURE_FLAGS.liteUi && (...)}`.

#### `apps/electron/src/renderer/components/onboarding/ProviderSelectStep.tsx` *(Disable OAuth)*

Split into `ALL_PROVIDER_OPTIONS` + filtered `PROVIDER_OPTIONS`. `disableOauth` hides copilot/local providers.

#### `packages/shared/src/statuses/storage.ts` *(Lite UI)*

`getDefaultStatusConfig()` conditionally excludes Backlog/Needs Review via `...(!FEATURE_FLAGS.liteUi ? [...] : [])`.

#### `apps/electron/src/renderer/components/apisetup/submit-helpers.ts` *(Preset Fix)*

Simplified `resolvePresetStateForBaseUrlChange()`: removed `activePresetHasEmptyUrl` branch that broke piAuthProvider routing.

#### `apps/electron/src/renderer/index.css` *(Border-Radius Tokens)*

Added `--radius-xs` through `--radius-2xl` (all `0px`) in `:root`. Converted 3 hardcoded `border-radius` values to `var(--radius-*)`.

#### `packages/ui/src/styles/index.css` *(Border-Radius Tokens)*

Same `:root` additions as above. Converted 3 hardcoded `border-radius` values to `var(--radius-*)`.

#### `packages/ui/src/components/markdown/tiptap-editor.css` *(Border-Radius Tokens)*

Converted ~20 hardcoded `border-radius` values (px/rem) to `var(--radius-*)`.

#### ~115 TSX/TS files *(Border-Radius Tokens)*

Mechanical find-and-replace: `rounded-[Npx]` → standard Tailwind class (`rounded-[2px]`→`rounded-xs`, `rounded-[4px]`→`rounded-sm`, `rounded-[6px]`→`rounded-md`, `rounded-[8px]`→`rounded-lg`, `rounded-[10px]`→`rounded-xl`, `rounded-[12px]`→`rounded-xl`, `rounded-[16px]`→`rounded-2xl`). Standard Tailwind classes (`rounded-md`, `rounded-lg`, etc.) are **not** modified — Tailwind v4 already compiles them to `var(--radius-*)`.

**Pattern:** Only files with hardcoded pixel values are touched. Conflicts arise only if upstream also changes the same `rounded-[Npx]` string.

### LOW Risk — Additive Changes

These are simple additive changes (exports, types, config entries) unlikely to conflict.

| File | Change |
|------|--------|
| `packages/shared/src/agent/index.ts` | Export `registerSessionBatchContext` |
| `packages/shared/src/agent/core/types.ts` | Added `batchOutputSchema?` to `ContextBlockOptions` |
| `packages/shared/src/agent/mode-manager.ts` | Added `includeBatchOutput: true` and granular disable flags (`disableOauth/Browser/Validation/Templates`) to safe mode allowlist |
| `packages/shared/src/agent/backend/pi/session-tool-defs.ts` | Added `opts?: { includeBatchOutput?, batchMode? }` to `getSessionToolProxyDefs()`; passes `batchMode` and granular disable flags |
| `packages/shared/src/docs/doc-links.ts` | Added `'batches'` to `DocFeature`, `batches` entry in `DOCS` |
| `packages/shared/src/docs/index.ts` | Added `batches` to `DOC_REFS` |
| `packages/shared/src/prompts/system.ts` | *(Batch)* Added Batches row to doc reference table; batch CLI guidance gated by independent `FEATURE_FLAGS.batchCli` (not `craftAgentsCli`). *(Lite changes moved to MEDIUM risk above)* |
| `packages/shared/CLAUDE.md` | Added batch import example, `batches/` in directory structure |
| `packages/shared/package.json` | Added `"./batches"` subpath export |
| `packages/shared/src/protocol/channels.ts` | Added `batches` namespace to `RPC_CHANNELS` |
| `packages/shared/src/protocol/dto.ts` | Added `batch_progress`, `batch_complete` to `SessionEvent`; added `isBatch` to `Session` and `CreateSessionOptions` |
| `packages/shared/src/protocol/events.ts` | Added `batches.CHANGED` to `BroadcastEventMap` |
| `apps/electron/src/transport/channel-map.ts` | Added 10 batch channel mappings |
| `apps/electron/src/shared/routes.ts` | Added `batches()` and `batchSessions()` route builders |
| `apps/electron/src/renderer/components/ui/EditPopover.tsx` | Added `'batch-config'` to `EditContextKey` |
| `apps/electron/src/renderer/context/AppShellContext.tsx` | Added 6 batch methods to context interface |
| `apps/electron/src/renderer/contexts/NavigationContext.tsx` | Re-exported `isBatchesNavigation`; added `isBatch` exclusion to session filters, `batch` case to `filterSessionsByFilter` |
| `packages/session-tools-core/src/handlers/index.ts` | Export `handleBatchOutput`, `BatchOutputArgs` |
| `packages/session-tools-core/src/index.ts` | Export `BatchContext`, `handleBatchOutput`, `BatchOutputArgs`, `BatchOutputSchema` |
| `apps/electron/src/main/index.ts` | Added `CRAFT_BATCH_CLI_ENTRY` env var assignment |
| `packages/server/src/index.ts` | Added `CRAFT_BATCH_CLI_ENTRY` env var and PATH setup for batch CLI wrapper scripts in headless/WebUI server mode |
| `apps/electron/resources/permissions/default.json` | Added `craft-agent-batch` read-only bash patterns |
| `packages/shared/src/feature-flags.ts` | Added 5 granular flag functions (`isOauthDisabled`, `isBrowserDisabled`, `isValidationDisabled`, `isTemplatesDisabled`, `isLiteUi`) + corresponding `FEATURE_FLAGS` getters; added `isBatchCliEnabled()` + `FEATURE_FLAGS.batchCli` getter |
| `apps/electron/vite.config.ts` | Added `define` for 5 `DATAPILOT_DISABLE_*` / `DATAPILOT_LITE_UI` env vars |
| `.env.example` | Added granular feature flag documentation |
| `README.md` | Added `batches.json` to structure diagram, "Batches" section |
| `packages/shared/src/branding.ts` | `VIEWER_URL` reads `CRAFT_VIEWER_URL` env var with fallback to upstream default |
| `package.json` (root) | Added `viewer:server` and `viewer:server:dev` scripts |
| `Dockerfile.viewer` | New Dockerfile for viewer-server container (port 9101) |
| `docker-compose.yml` | Docker Compose for server + viewer one-command deployment |
| `.env.docker` | Environment variable template for Docker deployment |

---

## Merge Strategy Checklist

When merging upstream updates:

1. **Run `git diff upstream/main...origin/main --stat`** to see affected files
2. **Check automations first** — if upstream changed automations (validation, watcher, RPC, UI), apply same changes to batch equivalents
3. **HIGH-risk files** (always inspect):
   - `SessionManager.ts` — batch lifecycle in workspace init, session completion, dispose
   - `AppShell.tsx` — batch UI + liteUi conditionals span sidebar, header, content, dialog
   - `tool-defs.ts` — batch tool registration, per-category tool sets (`OAUTH_TOOLS`, `BROWSER_TOOLS`, `VALIDATION_TOOLS`, `TEMPLATE_TOOLS`), and filter options
   - `session-scoped-tools.ts` — batch context registry + granular disable flags passthrough in tool init flow
4. **If upstream changes `executePromptAutomation()` signature**: ensure `isBatch`, `batchContext`, `automationName`, `workingDirectory` passthrough works
5. **If upstream moves automations utilities** (`expandEnvVars`, `sanitizeForShell`): update imports in `batch-processor.ts`
6. **If upstream changes `resolvePresetStateForBaseUrlChange()`**: re-verify our fix
7. **If upstream changes feature flags / Vite config**: preserve our granular flag getters (`disableOauth`, `disableBrowser`, `disableValidation`, `disableTemplates`, `liteUi`) and `batchCli` getter, plus `define` entries
8. **If upstream changes default statuses**: ensure `liteUi` conditional logic covers new statuses
9. **If upstream adds/removes/renames session tools**: check `OAUTH_TOOLS`, `BROWSER_TOOLS`, `VALIDATION_TOOLS`, `TEMPLATE_TOOLS`, and `BATCH_EXCLUDED_TOOLS` in `tool-defs.ts` and update if needed
10. **If upstream rewrites system prompt sections**: verify granular flag conditionals in `system.ts` still wrap the correct blocks (`disableBrowser` → Browser Tools section + doc table row; `disableValidation` → Mermaid tools/tips; `disableTemplates` → Source Templates section)
11. **If upstream adds new components with `rounded-[Npx]` patterns**: convert to standard Tailwind classes (`rounded-sm`, `rounded-md`, `rounded-lg`, etc.) so they flow through `--radius-*` CSS variables
12. **If upstream modifies `:root` blocks in `index.css` or `packages/ui/src/styles/index.css`**: preserve our `--radius-xs` through `--radius-2xl` overrides
13. **If upstream changes `branding.ts`**: preserve our `CRAFT_VIEWER_URL` env var override for `VIEWER_URL`
14. **If upstream adds their own viewer backend or changes the `/s/api` contract**: reconcile with `apps/viewer-server/` routes
15. **After merge, run tests**: `bun test packages/shared/src/batches/` and `bun test packages/session-tools-core/`

---

## Merge History

| Version | Date | Conflicts | Notes |
|---------|------|-----------|-------|
| v0.7.0 | 2026-03-06 | 9 | Major RPC/transport refactoring. Ported batch IPC → `rpc/batches.ts`, preload → `channel-map.ts`, types → protocol layer. |
| post-merge | 2026-03-06 | — | Batch refinements: LLM string coercion, safe mode fix, ajv validation, one-shot menu, context injection. |
| v0.7.1 | 2026-03-06 | 3 | Session naming. Merged our `isBatch`/`batchContext` with upstream's `automationName`. |
| v0.7.2 | 2026-03-10 | 5 | Island system, new presets, thinking level, bug fixes. Resolved: batch events + `message_annotations_updated`; batch ctx + diagnostics logging; upstream's `resolvePresetStateForBaseUrlChange` for Pi routing. |
| post-v0.7.2 | 2026-03-10 | — | Batch CLI (`packages/batch-cli/`), wrapper scripts, `cli-domains.ts` batch policy, `pre-tool-use.ts` detection. Preset preservation fix. Granular feature flags (replaced monolithic `LITE_VERSION` with `DISABLE_OAUTH`, `DISABLE_BROWSER`, `DISABLE_VALIDATION`, `DISABLE_TEMPLATES`, `LITE_UI`). |
| lite-tools | 2026-03-11 | — | Per-category tool sets (`OAUTH_TOOLS`, `BROWSER_TOOLS`, `VALIDATION_TOOLS`, `TEMPLATE_TOOLS`) with corresponding disable flags. System prompt conditionals for Browser Tools, Mermaid validation, Source Templates sections. Granular flags passthrough in 5 call sites. |
| v0.7.3 | 2026-03-11 | 1 | OAuth stability, background task UI, title generation with language awareness, exclude filter badges, MCP schema conversion, Minimax preset split. Resolved: `session-scoped-tools.ts` — adopted upstream's new cache strategy (cache tools array, not MCP server wrapper) while preserving batch context + granular flags passthrough. |
| v0.7.4 | 2026-03-12 | 2 | Custom endpoints, session branching overhaul, model switching fix, Windows branch fixes. Resolved: `config-watcher.ts` — accepted upstream deletion (shared version has our batch additions); `pi-agent-server/src/index.ts` — adopted upstream's full custom endpoint system (`registerCustomEndpointModels`, `CustomEndpointApi`), replacing our `customBaseUrlOverride` approach. |
| v0.7.5 | 2026-03-13 | 3 | Webhook actions for automations, network proxy, working directory history, model resolution refactor. Resolved: `AppShell.tsx` — added upstream's `onReplayAutomation` alongside batch handlers; `AppShellContext.tsx` — added `onReplayAutomation` to context interface; `SessionManager.ts` — merged `createPromptHistoryEntry` import with our `BatchProcessor` import. Additional fix: `rpc/automations.ts` — inserted `undefined` placeholders for fork's `isBatch`/`batchContext` params in new `executePromptAutomation` call site. |
| batch-tools | 2026-03-16 | — | Batch mode tool filtering: `BATCH_EXCLUDED_TOOLS` (14 registry tools), `batchMode` option in `SessionToolFilterOptions`, backend tools (`spawn_session`, `batch_test`, `browser_tool`) conditionally skipped in Claude adapter. Batch sessions reduced from 19+ tools to 3 (`batch_output`, `call_llm`, `script_sandbox`). |
| v0.7.6 | 2026-03-17 | 1 | Custom endpoint persistence, MCP custom headers, OAuth refresh loop fix, model ID format fix, OSS build scripts. Resolved: `storage.ts` — identical `customEndpoint` persistence fix on both sides (took upstream comment). Fork-only fixes retained: `pi-agent-server/index.ts` queryLlm provider check exemption, `pi.ts` validateStoredConnection enhancement, `submit-helpers.ts` preset preservation. |
| batch-workdir | 2026-03-17 | — | Per-batch working directory: `BatchConfig.workingDirectory` (optional absolute path) passed through `BatchProcessor` → `executePromptAutomation()` → `createSession()`. CLI `--working-directory` flag on create/update. UI display in `BatchInfoPage` Execution section. |
| batch-isBatch | 2026-03-18 | — | Batch sessions visibility: replaced `hidden: true` with `isBatch: true` persistent field. Batch sessions now excluded from All Sessions but visible under dedicated "Batch Sessions" sidebar entry (alongside Flagged/Archived). Added `{ kind: 'batch' }` to `SessionFilter`, `batchSessions` route, route-parser support, empty state. Updated server-side filtering (unread summary, markAllRead, search) and client notifications to exclude `isBatch` sessions. `hidden` field retained for mini-edit sessions only. |
| v0.7.7 | 2026-03-18 | 2 | Adaptive thinking levels, directory browsing, custom endpoint prefetch, onboarding skip, conditions system for automations. Resolved: `pi-agent-server/index.ts` — upstream adopted same custom-endpoint provider exemption (took upstream's cleaner implementation, fork fix no longer needed); `tool-defs.ts` — kept fork's `batch_output`/`batch_test` tools, adopted upstream's `readOnly` annotation on `call_llm`. Fork-only fixes retained: `pi.ts` validateStoredConnection, `factory.ts` cross-provider guard skip, `submit-helpers.ts` preset preservation. |
| model-tier-fix | 2026-03-18 | — | `factory.ts` `resolveModelForProvider()`: resolve tier-hint short names (`'haiku'` → `getMiniModel()`, others → `connection.defaultModel`) against connection model list. Fixes EditPopover mini-agent sessions (batch/permissions/skills edit dialogs) routing to built-in providers instead of custom endpoints. |
| v0.7.8 | 2026-03-19 | 1 | Amazon Bedrock provider, 1M context window, automation history compaction (`history-store.ts` with two-tier retention: 20/automation + 1000 global), CLI `--base-url`, error handling fixes (skip errors after handoff), session transcript persistence, generic error messages. Resolved: `SessionManager.ts` — adopted upstream's `appendAutomationHistoryEntry` import (replacing `AUTOMATIONS_HISTORY_FILE` + `appendFile`), preserved fork's `BatchProcessor` import. |
| v0.7.9–v0.7.11 | 2026-03-22 | 0 | **Clean merge — no conflicts.** v0.7.9: Reliable WebSocket event delivery (sequence-number tracking, reconnect replay, stale recovery in `App.tsx`/`transport/server.ts`/`transport/client.ts`), Copilot model overhaul (direct HTTP API + 3-tier fallback in `pi.ts` driver), 1M context `[1m]` model suffix fix, Windows vcredist + binary doc tools fixes. v0.7.10: Claude OAuth 429 fix (User-Agent). v0.7.11: Per-workspace 1M context toggle, custom endpoint `contextWindow` config, Bedrock setup form fix, Sonnet 1M suffix removed, model name truncation fix. All fork code (batch, lite, custom endpoint fixes, border-radius tokens) verified intact. |
| v0.7.12 | 2026-03-24 | 0 | **Clean merge — no textual conflicts.** Upstream added Bedrock auth/env routing fixes, extended prompt cache (1h TTL), Docker headless server support, branch-fork fallback summarization, MCP schema cleanup, and moved 1M context control to global AI settings. Verified fork code still present: batch lifecycle in `SessionManager.ts`, batch prompt context in `claude-agent.ts`, granular-flag filtering, and custom endpoint fixes in `factory.ts`/`pi.ts`. |
| v0.8.0 | 2026-03-26 | 12 | Hybrid local/remote transport, multiple remote workspaces, browser-accessible WebUI, session export/import, mobile WebUI, supply chain hardening. Resolved: `AppShell.tsx` (5 hunks) — kept batch UI + upstream's `SendToWorkspaceDialog`, remote workspace filtering, `sendToWorkspaceAtom`; `SessionManager.ts` — merged `registerSessionBatchContext` import with upstream's `generateConversationSummary`, accepted new export/import/dispatch methods; `feature-flags.ts` — kept granular feature flags and upstream's `embeddedServer`; `rpc/index.ts` — kept `registerBatchesHandlers` + upstream's `serverCtx` parameter; `SessionList.tsx` — kept `Layers` icon + upstream's `useSetAtom`. 7 CSS class conflicts from border-radius tokens: kept upstream's new semantic classes (`header-icon-btn`, `input-toolbar-btn`, `entity-row-btn`, `panel-header-btn`) with fork's Tailwind token forms (`rounded-sm`/`rounded-md`/`rounded-lg`/`rounded-2xl`). |
| v0.8.1 | 2026-03-27 | 4 | Remote workspace recovery flow, Docker-compose deployment, Web UI file thumbnails, consistent label ordering, Pi subprocess error dedup, session load error handling, chunked base64 for large attachments. Resolved: `App.tsx` — kept batch event handlers + upstream's `SessionLoadErrorScreen` wrapper; `AppShell.tsx` (2 hunks) — kept `FEATURE_FLAGS` import + upstream's `label-menu-utils` refactor and `sortLabelsForDisplay`, kept batch handlers in context memo + upstream's `activeSessionWorkingDirectory`/`displayLabelConfigs`; `MainContentPanel.tsx` — kept batch handlers + upstream's `activeSessionWorkingDirectory`; `SessionFilesSection.tsx` — kept fork's `rounded-xs` token + upstream's conditional `imgSrc` rendering. Converted upstream's new `rounded-[8px]` in `App.tsx` to `rounded-lg`. All fork code verified intact. |
| viewer-server | 2026-03-27 | — | Self-hosted viewer backend: `apps/viewer-server/` (Bun HTTP server with fs/S3 storage), `Dockerfile.viewer` (port 9101), `branding.ts` `VIEWER_URL` made configurable via `CRAFT_VIEWER_URL` env var, root `package.json` scripts added. |
| v0.8.2 | 2026-04-01 | 5 | WebUI OAuth unification, browser tool toggle, search reliability (CSS Custom Highlight API rewrite), auth hardening (jose+argon2id), PWA assets, filesystem caching. Resolved: `Dockerfile.server` — kept fork's `gosu` + upstream's `ripgrep`; `ChatDisplay.tsx` — took upstream's Range-based highlighting (replaces fork's mark-based approach with `rounded-xs`, which is obsolete); `index.css` — took upstream's new dark-mode accent/info color values (fork colors were from previous merge); `bun.lock` — took upstream; `session-scoped-tools.ts` — kept fork's `createBatchTestTool` inside `!isBatchSession` + wrapped upstream's `createBrowserTools` in new `getBrowserToolEnabled()` guard (also inside `!isBatchSession`). |
| v0.8.3 | 2026-04-03 | 10 | Session self-management tools (`set_session_labels`, `set_session_status`, `get_session_info`, `list_sessions`), compact mode UI, legacy provider cleanup (`anthropic_compat`/`bedrock`/`vertex` removed from `LlmProviderType`), Docker build perf, stale lock fix, fs.watch race fix, co-author preference fix. Resolved: `ActiveOptionBadges.tsx` — took upstream's `SessionInfoPopover` refactor; `AppShell.tsx` — kept batch handlers + upstream's `isAutoCompact`; `TopBarButton.tsx` — kept `rounded-md` token + upstream's `header-icon-btn` class; `headless-start.ts` — took upstream's Docker PID 1 handling; `SessionManager.ts` — kept fork's `onBatchTest` + upstream's session self-management callbacks; `handlers/index.ts` — kept both batch + session tool exports; `tool-defs.ts` — kept batch tools + upstream's 4 session tools; `claude-context.ts` — kept `batchContext` + upstream's session callbacks; `session-scoped-tools.ts` — kept batch context + upstream's session tool wiring; `TurnCard.tsx` — kept `rounded-lg` token + upstream's `compactMode` guard. **Restored `anthropic_compat`** as a live provider type (upstream migrated it to `pi_compat` as legacy, but our fork uses it for Claude SDK custom endpoint routing). Updated `LlmProviderType`, `factory.ts` (`providerTypeToAgentProvider`, `resolveSetupTestConnectionHint`, `testBackendConnection`), `llm-connections.ts` helpers, `model-fetcher.ts`, `storage.ts` migration, and RPC handler. |
| v0.8.4 | 2026-04-09 | 35 | Generic OAuth for API sources, Send to Workspace, DevTools in packaged app, session tools via Pi fix, model tier hints fix, error card buttons fix, automations loading on WebUI. Resolved: 14 `package.json` version bumps (0.8.3→0.8.4); `shared/package.json` — added `./resources` export alongside fork's batch/config exports; `Dockerfile.server` — kept fork's Docker env vars (superset of upstream's `CRAFT_BUNDLED_ASSETS_ROOT`); `AppShell.tsx` — kept batch handlers in context memo; `ChatDisplay.tsx` — adopted upstream's error card button wiring (settings/retry actions); `MainContentPanel.tsx` — kept batch imports + added `SendResourceToWorkspaceDialog`; `TopBarButton.tsx` — kept `rounded-md` token; `provider-icons.ts` — kept `anthropic_compat` in provider icon switch; `types.ts` — kept batch methods + added resource export/import methods; `channel-map.ts` — kept `listAutomations` + added both batches and resources channel mappings; `useAutomations.ts` — kept fork's `loadAutomationsViaRpc` (RPC-based loading); `rpc/automations.ts` — kept fork's LIST channel with upstream's improved logging/error handling; `SessionManager.ts` — kept fork's `onBatchTest`; `handlers/index.ts` — kept batch-output export; `tool-defs.ts` — kept batch tools; `factory.ts` — kept `anthropic_compat` as live provider; `claude-agent.ts` — kept batchContext param; `claude-context.ts` — adopted upstream's external `attachSessionSelfManagementBindings()` pattern; `session-scoped-tools.ts` — adopted upstream's extracted callback registry + added `batchTestFn`, `debug` import; `llm-connections.ts` — kept `anthropic_compat` (5 hunks); `storage.ts` — kept fork's vertex migration + no anthropic_compat migration; `system.ts` — kept granular-flag/batch conditionals (7 hunks); `channels.ts` — kept LIST + added resources; `TurnCard.tsx` — kept `rounded-lg` token; `routing.ts` — fixed `automations.GET` → `automations.LIST`. Upstream refactored session self-management callbacks into `session-scoped-tool-callback-registry.ts` and `session-self-management-bindings.ts` — adopted both, added fork's `batchTestFn` to the registry. |
| v0.8.5 + v0.8.6 | 2026-04-11 | 9 | v0.8.5: multi-language i18n (EN/ES/zh-Hans/JA, ~1050 strings, Pi SDK 0.56.2→0.66.1, canonical locale registry, locale parity tests). v0.8.6: chunked session transfers (base64 WebSocket RPC with SHA-256 checksums), image input for custom endpoints, transfer reconnect hardening. Resolved: `packages/shared/package.json` — kept fork's extra subpath exports and added upstream's `./i18n`; `apps/electron/src/shared/types.ts` — kept fork's batch RPC methods and added upstream's `changeLanguage`; `SkillsListPanel.tsx`/`SourcesListPanel.tsx`/`AutomationsListPanel.tsx` — kept `rounded-lg` tokens + adopted upstream's `t('…addSkill/addSource/addAutomation')` strings; `AutomationInfoPage.tsx` — kept `rounded-lg` + upstream's `t('automations.sectionRawConfig')`; `APISetupStep.tsx` — removed orphan top-level `SEGMENT_LABELS` (upstream inlines via `t()` inside component), adopted upstream's `BetaBadge({ label })` signature with fork's `rounded-sm` token; `ProviderSelectStep.tsx` — kept fork's `OAUTH_HIDDEN_PROVIDERS` filter, adopted upstream's `PROVIDER_ICONS` split with fork's `rounded-xs` token, moved `ALL_PROVIDER_OPTIONS`/`PROVIDER_OPTIONS` inside component (i18n-only) and re-applied lite filter there; `AiSettingsPage.tsx` (2 hunks) — kept `rounded-sm`/`rounded-md` tokens + upstream's `t('common.default')`/`t('common.closeEsc')`. Post-merge fixes: `EditPopover.tsx` — changed `batch-config` entry's `model: 'sonnet'` to `'default'` (upstream narrowed the model tier type to `'default' \| 'fast'`); `types.ts` — renamed `getAutomations` → `listAutomations` in ElectronAPI (channel-map parity test surfaced the fork's v0.8.4 LIST rename not yet reflected in the type). Ran `bun install` to pick up upstream's new `i18next` dependency and Pi SDK 0.66.1. All fork tests pass (batches 109/109, session-tools-core 59/59, i18n 38/38). `packages/session-tools-core` and `apps/webui` have pre-existing tsconfig issues unrelated to this merge. |
