# Fork Merge Guide

> Records all fork changes relative to `upstream/main` (lukilabs/craft-agents-oss).
> Purpose: identify conflict zones, understand intent, make informed merge resolution decisions.
>
> **Last updated after:** v0.7.5 merge (Webhook actions for automations, network proxy, working directory history, model resolution refactor)

## Overview

Our fork adds three categories of changes:

1. **Batch Processing System** — Processes large lists of items (CSV/JSON/JSONL) by running a prompt action per item as an independent agent session. Modeled after the **Automations** architecture; if upstream refactors automations, batch code likely needs the same treatment.

2. **Lite Version Build Flag** (`CRAFT_LITE_VERSION`) — Build-time flag that hides non-essential UI (What's New, Help menu, subscription providers, Backlog/Needs Review statuses), excludes unused session tools (9 tools via `LITE_EXCLUDED_TOOLS`), and conditionally removes prompt sections (Browser Tools, Mermaid validation, Source Templates, Debug Mode) to reduce initial context. Replaces the old `lite` branch.

3. **Preset Preservation Fix** — Fix to `resolvePresetStateForBaseUrlChange()` preserving Pi SDK provider routing when a preset points at a custom proxy endpoint.

---

## New Files (Low Conflict Risk)

These won't conflict unless upstream adds similarly-named features.

### Batch Core — `packages/shared/src/batches/`

Types, schemas, CSV/JSON/JSONL parser, state persistence, processor (lifecycle + concurrency + retry), output instruction builder, validation. 5 test files (~1300 lines).

**Cross-module dependency:** `batch-processor.ts` imports `expandEnvVars()` from `automations/utils.ts` and `sanitizeForShell()` from `automations/security.ts`. If upstream renames/moves these, batch-processor breaks.

### Batch Output Tool — `packages/session-tools-core/src/handlers/batch-output.ts`

Handler + tests: coerces stringified JSON, validates against output schema via **ajv**, appends JSONL records.

### Batch RPC Handlers — `packages/server-core/src/handlers/rpc/batches.ts`

9 RPC handlers (LIST, START, PAUSE, RESUME, GET_STATUS, GET_STATE, SET_ENABLED, DUPLICATE, DELETE). Mirrors `automations.ts` structure.

### Batch UI — `apps/electron/src/renderer/components/batches/`

`BatchesListPanel`, `BatchInfoPage`, `BatchActionRow`, `BatchItemTimeline`, `BatchMenu`, `BatchAvatar`, types. All mirror automations UI components.

**UI dependencies:** `Info_Page`, `EntityListEmptyScreen`, `EntityRow`, `EditPopover`, `SessionSearchHeader`, `useMenuComponents()`, `useNavigation()`, Jotai atoms, Sonner toasts.

### Batch State & Hooks

- `atoms/batches.ts` — Jotai atom
- `hooks/useBatches.ts` — mirrors `useAutomations` (minus toggle)

### Batch CLI — `packages/batch-cli/`

Standalone `craft-agent-batch` binary: 7 subcommands (list, get, validate, status, create, update, enable/disable). All logic delegates to `@craft-agent/shared/batches`.

- `src/workspace.ts` resolves workspace root: `--workspace-root` → `CRAFT_WORKSPACE_PATH` env → `CRAFT_AGENT_WORKSPACE_ROOT` env → walk-up → CWD
- Wrapper scripts: `apps/electron/resources/bin/craft-agent-batch{,.cmd}` — invoked via `CRAFT_BATCH_CLI_ENTRY` env var set in `main/index.ts`

### Batch Documentation

- `apps/electron/resources/docs/batches.md` — agent reference doc
- `apps/electron/resources/docs/craft-cli.md` — added `<!-- cli:batch:start/end -->` section

---

## Modified Upstream Files (Conflict Zone)

### HIGH Risk — Always Inspect Manually

These files are frequently touched by upstream and have substantial fork modifications.

#### `packages/server-core/src/sessions/SessionManager.ts`

- Added `batchProcessors: Map<string, BatchProcessor>` with per-workspace init, callbacks (`onExecutePrompt`, `onProgress`, `onBatchComplete`, `onError`), config watcher, broadcasting
- Modified `executePromptAutomation()`: added `hidden` and `batchContext` params (coexist with upstream's `automationName`)
- Session completion handler notifies batch processors
- Added `getBatchProcessor()`, `broadcastBatchesChanged()`, cleanup in `dispose()`

**Pattern:** Mirrors automationSystems management. `automationName` passthrough follows upstream's naming flow.

#### `apps/electron/src/renderer/components/app-shell/AppShell.tsx`

- **Batch:** sidebar nav item + count badge, "Add Batch" button (EditPopover), `BatchesListPanel` rendering, delete dialog, `useBatches()` hook, `batchHandlersRef` prop, context extension
- **Lite:** conditional "What's New" button via `...(!FEATURE_FLAGS.liteVersion ? [...] : [])`

**Pattern:** Batch mirrors automations integration. Lite uses conditional spread.

#### `packages/session-tools-core/src/tool-defs.ts`

- **Batch:** Added `batch_output` tool def (with `safeMode: 'allow'`), `BatchOutputSchema`, `'batches'` target in `ConfigValidateSchema`
- **Batch:** Extended `SessionToolFilterOptions` with `includeBatchOutput?: boolean`
- **Lite:** Added `LITE_EXCLUDED_TOOLS` set (9 tools: 4 OAuth, `browser_tool`, `mermaid_validate`, `skill_validate`, `render_template`), `liteMode?: boolean` to `SessionToolFilterOptions`
- Modified `getSessionToolDefs()` and `getToolDefsAsJsonSchema()` to filter/propagate both `includeBatchOutput` and `liteMode`

**Pattern:** `includeBatchOutput` and `liteMode` both mirror `includeDeveloperFeedback`.

#### `packages/shared/src/agent/session-scoped-tools.ts`

- **Batch:** Added batch context registry: `registerSessionBatchContext()`, `getSessionBatchContext()`, `cleanupSessionBatchContext()`
- **Batch:** Modified `getSessionScopedTools()`: passes `batchContext` to `createClaudeContext()`, derives `includeBatchOutput`
- **Batch:** Modified `cleanupSessionScopedTools()`: also cleans up batch context
- **Lite:** Added `liteMode: FEATURE_FLAGS.liteVersion` to `getSessionToolDefs()` call

**Pattern:** Mirrors existing `sessionScopedToolsCache` Map registry.

### MEDIUM Risk — Check After Upstream Changes

#### `packages/shared/src/agent/claude-agent.ts`

Added batch context reading → `batchOutputSchema` passed to `buildContextParts()` in `buildTextPrompt()` / `buildSDKUserMessage()`.

#### `packages/shared/src/agent/pi-agent.ts`

Same as claude-agent, plus: `setupTools()` passes `includeBatchOutput` to `getSessionToolProxyDefs()`, `createSessionToolContext()` passes `batchContext`.

#### `packages/shared/src/agent/claude-context.ts`

Extended `ClaudeContextOptions` with `batchContext?: BatchContext`; added `validateBatches` to `ValidatorInterface`.

#### `packages/shared/src/agent/core/prompt-builder.ts`

`buildContextParts()`: if `batchOutputSchema` present, appends `<batch_output_instructions>` block.

#### `packages/server-core/src/handlers/session-manager-interface.ts`

Added `getBatchProcessor?()` method; extended `executePromptAutomation()` with `hidden` + `batchContext` params.
**Note:** This was a 3-way conflict in v0.7.1 merge. Future upstream signature changes will conflict.

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

Added `batch-config` → `batch` mapping in `detectCliNamespaceFromConfigDetection()`, `craft-agent-batch` to token scan exemption.

#### `packages/shared/src/prompts/system.ts` *(Lite)*

Multiple `!FEATURE_FLAGS.liteVersion` conditionals spread across the system prompt:
- Doc table: Mermaid and Browser Tools rows conditionally hidden
- Browser Tools section (~50 lines) removed
- Mermaid validation: Tools block, validate tip, doc reference removed (diagram rendering guidance preserved)
- Source Templates section (~29 lines) removed
- Debug mode context (~80 lines) suppressed via `&& !FEATURE_FLAGS.liteVersion` guard

**Risk note:** Upstream frequently modifies the system prompt. If sections are rewritten or reordered, our conditionals may need adjustment.

#### `packages/session-mcp-server/src/index.ts` *(Lite)*

Added `FEATURE_FLAGS` import; passes `liteMode: FEATURE_FLAGS.liteVersion` to both `createSessionTools()` and `getSessionToolRegistry()` calls.

#### `apps/electron/src/renderer/components/app-shell/TopBar.tsx` *(Lite)*

Wrapped Help `<DropdownMenu>` with `{!FEATURE_FLAGS.liteVersion && (...)}`.

#### `apps/electron/src/renderer/components/onboarding/ProviderSelectStep.tsx` *(Lite)*

Split into `ALL_PROVIDER_OPTIONS` + filtered `PROVIDER_OPTIONS`. Lite hides claude/chatgpt/copilot/local.

#### `packages/shared/src/statuses/storage.ts` *(Lite)*

`getDefaultStatusConfig()` conditionally excludes Backlog/Needs Review via `...(!lite ? [...] : [])`.

#### `apps/electron/src/renderer/components/apisetup/submit-helpers.ts` *(Preset Fix)*

Simplified `resolvePresetStateForBaseUrlChange()`: removed `activePresetHasEmptyUrl` branch that broke piAuthProvider routing.

### LOW Risk — Additive Changes

These are simple additive changes (exports, types, config entries) unlikely to conflict.

| File | Change |
|------|--------|
| `packages/shared/src/agent/index.ts` | Export `registerSessionBatchContext` |
| `packages/shared/src/agent/core/types.ts` | Added `batchOutputSchema?` to `ContextBlockOptions` |
| `packages/shared/src/agent/mode-manager.ts` | Added `includeBatchOutput: true` and `liteMode: FEATURE_FLAGS.liteVersion` to safe mode allowlist |
| `packages/shared/src/agent/backend/pi/session-tool-defs.ts` | Added `opts?: { includeBatchOutput? }` to `getSessionToolProxyDefs()`; passes `liteMode: FEATURE_FLAGS.liteVersion` |
| `packages/shared/src/docs/doc-links.ts` | Added `'batches'` to `DocFeature`, `batches` entry in `DOCS` |
| `packages/shared/src/docs/index.ts` | Added `batches` to `DOC_REFS` |
| `packages/shared/src/prompts/system.ts` | *(Batch)* Added Batches row to doc reference table; added CLI batch doc reference. *(Lite changes moved to MEDIUM risk above)* |
| `packages/shared/CLAUDE.md` | Added batch import example, `batches/` in directory structure |
| `packages/shared/package.json` | Added `"./batches"` subpath export |
| `packages/shared/src/protocol/channels.ts` | Added `batches` namespace to `RPC_CHANNELS` |
| `packages/shared/src/protocol/dto.ts` | Added `batch_progress`, `batch_complete` to `SessionEvent` |
| `packages/shared/src/protocol/events.ts` | Added `batches.CHANGED` to `BroadcastEventMap` |
| `apps/electron/src/transport/channel-map.ts` | Added 10 batch channel mappings |
| `apps/electron/src/shared/routes.ts` | Added `batches()` route builder |
| `apps/electron/src/renderer/components/ui/EditPopover.tsx` | Added `'batch-config'` to `EditContextKey` |
| `apps/electron/src/renderer/context/AppShellContext.tsx` | Added 6 batch methods to context interface |
| `apps/electron/src/renderer/contexts/NavigationContext.tsx` | Re-exported `isBatchesNavigation` |
| `packages/session-tools-core/src/handlers/index.ts` | Export `handleBatchOutput`, `BatchOutputArgs` |
| `packages/session-tools-core/src/index.ts` | Export `BatchContext`, `handleBatchOutput`, `BatchOutputArgs`, `BatchOutputSchema` |
| `apps/electron/src/main/index.ts` | Added `CRAFT_BATCH_CLI_ENTRY` env var assignment |
| `apps/electron/resources/permissions/default.json` | Added `craft-agent-batch` read-only bash patterns |
| `packages/shared/src/feature-flags.ts` | Added `isLiteVersion()` + `FEATURE_FLAGS.liteVersion` getter |
| `apps/electron/vite.config.ts` | Added `define` for `process.env.CRAFT_LITE_VERSION` |
| `.env.example` | Added `CRAFT_LITE_VERSION` documentation |
| `README.md` | Added `batches.json` to structure diagram, "Batches" section |

---

## Merge Strategy Checklist

When merging upstream updates:

1. **Run `git diff upstream/main...origin/main --stat`** to see affected files
2. **Check automations first** — if upstream changed automations (validation, watcher, RPC, UI), apply same changes to batch equivalents
3. **HIGH-risk files** (always inspect):
   - `SessionManager.ts` — batch lifecycle in workspace init, session completion, dispose
   - `AppShell.tsx` — batch UI + lite conditionals span sidebar, header, content, dialog
   - `tool-defs.ts` — batch tool registration, `LITE_EXCLUDED_TOOLS` set, and filter options
   - `session-scoped-tools.ts` — batch context registry + lite mode passthrough in tool init flow
4. **If upstream changes `executePromptAutomation()` signature**: ensure `hidden`, `batchContext`, `automationName` passthrough works
5. **If upstream moves automations utilities** (`expandEnvVars`, `sanitizeForShell`): update imports in `batch-processor.ts`
6. **If upstream changes `resolvePresetStateForBaseUrlChange()`**: re-verify our fix
7. **If upstream changes feature flags / Vite config**: preserve our `liteVersion` getter and `define` entry
8. **If upstream changes default statuses**: ensure lite conditional logic covers new statuses
9. **If upstream adds/removes/renames session tools**: check `LITE_EXCLUDED_TOOLS` in `tool-defs.ts` and update if needed
10. **If upstream rewrites system prompt sections**: verify lite conditionals in `system.ts` still wrap the correct blocks (Browser Tools, Mermaid validation, Source Templates, Debug Mode, doc table rows)
11. **After merge, run tests**: `bun test packages/shared/src/batches/` and `bun test packages/session-tools-core/`

---

## Merge History

| Version | Date | Conflicts | Notes |
|---------|------|-----------|-------|
| v0.7.0 | 2026-03-06 | 9 | Major RPC/transport refactoring. Ported batch IPC → `rpc/batches.ts`, preload → `channel-map.ts`, types → protocol layer. |
| post-merge | 2026-03-06 | — | Batch refinements: LLM string coercion, safe mode fix, ajv validation, one-shot menu, context injection. |
| v0.7.1 | 2026-03-06 | 3 | Session naming. Merged our `hidden`/`batchContext` with upstream's `automationName`. |
| v0.7.2 | 2026-03-10 | 5 | Island system, new presets, thinking level, bug fixes. Resolved: batch events + `message_annotations_updated`; batch ctx + diagnostics logging; upstream's `resolvePresetStateForBaseUrlChange` for Pi routing. |
| post-v0.7.2 | 2026-03-10 | — | Batch CLI (`packages/batch-cli/`), wrapper scripts, `cli-domains.ts` batch policy, `pre-tool-use.ts` detection. Preset preservation fix. Lite version build flag (`CRAFT_LITE_VERSION`). |
| lite-tools | 2026-03-11 | — | Lite mode tool exclusions: `LITE_EXCLUDED_TOOLS` (9 tools: 4 OAuth, browser, mermaid_validate, skill_validate, render_template). System prompt conditionals for Browser Tools, Mermaid validation, Source Templates, Debug Mode sections. `liteMode` passthrough in 5 call sites. |
| v0.7.3 | 2026-03-11 | 1 | OAuth stability, background task UI, title generation with language awareness, exclude filter badges, MCP schema conversion, Minimax preset split. Resolved: `session-scoped-tools.ts` — adopted upstream's new cache strategy (cache tools array, not MCP server wrapper) while preserving batch context + lite mode passthrough. |
| v0.7.4 | 2026-03-12 | 2 | Custom endpoints, session branching overhaul, model switching fix, Windows branch fixes. Resolved: `config-watcher.ts` — accepted upstream deletion (shared version has our batch additions); `pi-agent-server/src/index.ts` — adopted upstream's full custom endpoint system (`registerCustomEndpointModels`, `CustomEndpointApi`), replacing our `customBaseUrlOverride` approach. |
| v0.7.5 | 2026-03-13 | 3 | Webhook actions for automations, network proxy, working directory history, model resolution refactor. Resolved: `AppShell.tsx` — added upstream's `onReplayAutomation` alongside batch handlers; `AppShellContext.tsx` — added `onReplayAutomation` to context interface; `SessionManager.ts` — merged `createPromptHistoryEntry` import with our `BatchProcessor` import. Additional fix: `rpc/automations.ts` — inserted `undefined` placeholders for fork's `hidden`/`batchContext` params in new `executePromptAutomation` call site. |
