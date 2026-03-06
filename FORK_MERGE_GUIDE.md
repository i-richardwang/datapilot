# Fork Merge Guide: Batch Processing System

> This document records all changes made in our fork relative to `upstream/main` (lukilabs/craft-agents-oss).
> Its purpose is to serve as a reference when merging upstream updates, helping to identify conflict zones,
> understand the intent of each change, and make informed resolution decisions.
>
> **Last updated after:** v0.7.0 merge + post-merge batch refinements

## Overview

Our fork adds a **Batch Processing System** — a feature that processes large lists of items (CSV/JSON/JSONL)
by running a prompt action for each item as an independent agent session, with concurrency control, retry logic,
pause/resume, structured output collection, and live progress tracking.

**Design principle:** The entire system is modeled after the existing **Automations** architecture. Wherever
automations has a pattern (config file, validation, watcher, RPC handler, navigation, UI components), batches replicates it.
If upstream refactors automations, our batch code likely needs the same refactoring.

---

## Architecture Notes (v0.7.0+)

Upstream v0.7.0 introduced a major architectural refactoring. Key changes relevant to batch integration:

### IPC → RPC Handler Architecture
- **Old:** Monolithic `apps/electron/src/main/ipc.ts` with `ipcMain.handle()` calls + `IPC_CHANNELS` enum in `shared/types.ts`
- **New:** Per-domain handler files in `packages/server-core/src/handlers/rpc/` using `server.handle(RPC_CHANNELS.xxx, handler)` pattern
- **Our batch handlers** live in `packages/server-core/src/handlers/rpc/batches.ts` (mirrors `automations.ts`)
- Registered via `registerBatchesHandlers()` in `packages/server-core/src/handlers/rpc/index.ts`

### Protocol Layer
- **Old:** Types in `apps/electron/src/shared/types.ts` (`IPC_CHANNELS` enum, `SessionEvent`, `ElectronAPI`)
- **New:** Types in `packages/shared/src/protocol/` (channels.ts, dto.ts, events.ts, types.ts)
- Our batch channels are in `packages/shared/src/protocol/channels.ts` → `RPC_CHANNELS.batches.*`
- Our batch events are in `packages/shared/src/protocol/dto.ts` → `SessionEvent` union
- Our broadcast event is in `packages/shared/src/protocol/events.ts` → `BroadcastEventMap`

### Transport Layer (Electron)
- **Old:** `apps/electron/src/preload/index.ts` with `ipcRenderer.invoke()` calls
- **New:** `apps/electron/src/transport/channel-map.ts` mapping method names → RPC channels
- Our batch methods are in `channel-map.ts` → `listBatches`, `startBatch`, etc.

### SessionManager Relocation
- **Old:** `apps/electron/src/main/sessions.ts`
- **New:** `packages/server-core/src/sessions/SessionManager.ts`
- Our batch code (processor init, lifecycle, broadcasting) lives in the new location
- Broadcasting uses `eventSink(RPC_CHANNELS.batches.CHANGED, { to: 'workspace', workspaceId }, data)` instead of old `windowManager.broadcastToAll()`

### ISessionManager Interface
- **New:** `packages/server-core/src/handlers/session-manager-interface.ts`
- We added `getBatchProcessor?()` method and `batchContext` parameter to `executePromptAutomation()`

### Tool Registry
- Upstream added `safeMode: 'allow' | 'block'` to every tool definition
- Our `batch_output` tool includes `safeMode: 'allow'`
- Upstream added `script_sandbox` tool

---

## Part 1: New Files (Low Conflict Risk)

These files are entirely new. They won't conflict unless upstream adds a similarly named feature.

### 1.1 Core Engine — `packages/shared/src/batches/`

| File | Purpose |
|------|---------|
| `types.ts` | All TypeScript types: `BatchConfig`, `BatchState`, `BatchItemState`, `BatchProgress`, `BatchSystemOptions`, etc. |
| `constants.ts` | Constants: `BATCHES_CONFIG_FILE = 'batches.json'`, `BATCH_STATE_FILE_PREFIX`, `DEFAULT_MAX_CONCURRENCY = 3`, `BATCH_ITEM_ENV_PREFIX` |
| `schemas.ts` | Zod schemas for `batches.json` validation; `zodErrorToIssues()` helper (same pattern as `automations/schemas.ts`) |
| `data-source.ts` | CSV/JSON/JSONL parser with `loadBatchItems()`, idField validation, uniqueness checks |
| `batch-state-manager.ts` | State persistence: `loadBatchState()`, `saveBatchState()`, `createInitialBatchState()`, `updateItemState()`, `computeProgress()`, `isBatchDone()` |
| `batch-processor.ts` | Core orchestrator: lifecycle (start/pause/resume/stop), concurrency dispatch, retry, env var building. **Imports `expandEnvVars()` and `sanitizeForShell()` from `automations/utils.ts` and `automations/security.ts`** |
| `output-instruction.ts` | `buildBatchOutputInstruction()` — generates the structured output instruction block injected into agent context (not user-visible prompt). Used by `PromptBuilder.buildContextParts()`. |
| `validation.ts` | Two-level validation: `validateBatchesContent()` (no disk) + `validateBatches()` (workspace-aware). Mirrors `automations/validation.ts` |
| `index.ts` | Barrel exports (includes `buildBatchOutputInstruction`) |

**Tests (in same directory):**
- `batch-processor.test.ts` (564 lines)
- `batch-state-manager.test.ts` (146 lines)
- `data-source.test.ts` (176 lines)
- `schemas.test.ts` (207 lines)
- `validation.test.ts` (244 lines)

**Cross-module dependency:** `batch-processor.ts` directly imports from `automations/utils.ts` and `automations/security.ts`. If upstream renames/refactors these, our code breaks.

### 1.2 Batch Output Tool — `packages/session-tools-core/src/handlers/`

| File | Purpose |
|------|---------|
| `batch-output.ts` | `handleBatchOutput()` handler: coerces stringified JSON args, validates against output schema using **ajv** (full JSON Schema support), appends JSONL record with `_item_id` + `_timestamp` metadata to shared output file |
| `batch-output.test.ts` | 16 test cases covering non-batch rejection, schema validation (including nullable union types), string coercion, append logic |

### 1.3 RPC Handlers — `packages/server-core/src/handlers/rpc/batches.ts`

| File | Purpose |
|------|---------|
| `batches.ts` | 9 RPC handlers (LIST, START, PAUSE, RESUME, GET_STATUS, GET_STATE, SET_ENABLED, DUPLICATE, DELETE) + `withConfigMutex` / `withBatchMutation` helpers. Note: SET_ENABLED is retained in backend but no longer called from UI (batches are one-shot; enable/disable removed from menu). |

**Pattern followed:** Mirrors `automations.ts` handler structure exactly. Uses `deps.sessionManager.getBatchProcessor?.(workspace.rootPath)`.

### 1.4 UI Components — `apps/electron/src/renderer/components/batches/`

| File | Purpose | Mirrors |
|------|---------|---------|
| `BatchesListPanel.tsx` | List view with search, status filtering, progress display | `AutomationsListPanel` |
| `BatchInfoPage.tsx` | Detail view: hero, source, action, execution, output, progress, items timeline, raw config | `AutomationInfoPage` |
| `BatchActionRow.tsx` | Displays batch prompt action with @mention highlighting | `AutomationActionRow` |
| `BatchItemTimeline.tsx` | Timeline of item processing results with status icons and session links | `AutomationEventTimeline` |
| `BatchMenu.tsx` | Context menu: start (pending only), pause, resume, duplicate, delete. No enable/disable — batches are one-shot tasks. | Automations menu pattern (simplified) |
| `BatchAvatar.tsx` | Status-colored icon (Layers) with size variants | `AutomationAvatar` |
| `types.ts` | `BatchListItem`, `BatchFilterKind`, status display/color maps | Automations component types |
| `index.ts` | Barrel exports | |

### 1.5 Renderer State & Hooks

| File | Purpose |
|------|---------|
| `atoms/batches.ts` | Jotai atom `batchesAtom` storing `BatchListItem[]` |
| `hooks/useBatches.ts` | State management hook: loading, IPC calls, progress updates, CRUD (no toggle — batches are one-shot). Mirrors `useAutomations` (minus toggle) |

### 1.6 Documentation

| File | Purpose |
|------|---------|
| `apps/electron/resources/docs/batches.md` | 381-line agent reference doc (mirrors `automations.md` structure) |

---

## Part 2: Modified Upstream Files (Conflict Zone)

These are existing upstream files we modified. **This is where merge conflicts will occur.**
For each file, we document: what we changed, why, and which upstream pattern we followed.

### 2.1 `packages/shared/src/agent/claude-context.ts`

**What we changed:**
- Added import: `BatchContext` from `@craft-agent/session-tools-core`
- Extended `ClaudeContextOptions` interface: added optional `batchContext?: BatchContext`
- In `createClaudeContext()`: destructure `batchContext` from options, pass it to `SessionToolContext`
- Added `validateBatches` method to the `ValidatorInterface` object

**Why:** Enables batch-spawned sessions to carry batch metadata (batch ID, item ID, output config) so the `batch_output` tool can function.

**Pattern followed:** Same as how `onPlanSubmitted`, `onAuthRequest` etc. are passed through options. `validateBatches` mirrors `validateAutomations` in the validator.

**Conflict likelihood:** HIGH — this is a core integration point. If upstream adds new options or restructures `createClaudeContext`, we need to re-apply our additions.

### 2.2 `packages/shared/src/agent/session-scoped-tools.ts`

**What we changed:**
- Added import: `BatchContext` from `@craft-agent/session-tools-core`
- Added 3 new functions for batch context registry:
  - `registerSessionBatchContext(sessionId, batchContext)` — stores context in a Map
  - `getSessionBatchContext(sessionId)` — retrieves context
  - `cleanupSessionBatchContext(sessionId)` — removes context
- Modified `cleanupSessionScopedTools()`: also calls `cleanupSessionBatchContext(sessionId)`
- Modified `getSessionScopedTools()`:
  - Passes `batchContext: getSessionBatchContext(sessionId)` to `createClaudeContext()`
  - Derives `isBatchSession` boolean
  - Passes `includeBatchOutput: isBatchSession` to `getSessionToolDefs()`

**Why:** Per-session batch context management. The batch processor registers context before the session starts; the tool system reads it to conditionally enable `batch_output`.

**Pattern followed:** Mirrors the existing `sessionScopedToolsCache` Map registry. The `includeBatchOutput` flag follows the `includeDeveloperFeedback` pattern.

**Conflict likelihood:** HIGH — `getSessionScopedTools()` is frequently touched. Any upstream changes to tool initialization flow need careful merging.

### 2.3 `packages/shared/src/agent/index.ts`

**What we changed:**
- Added export: `registerSessionBatchContext`

**Conflict likelihood:** LOW — additive export.

### 2.4 `packages/shared/src/agent/claude-agent.ts`

**What we changed:**
- Added import: `getSessionBatchContext` from `session-scoped-tools.ts`
- In `buildTextPrompt()` and `buildSDKUserMessage()`: reads batch context for the session and passes `batchOutputSchema` to `buildContextParts()`

**Why:** Injects structured output instructions into the agent's context (hidden from user) instead of appending them to the visible user prompt.

**Pattern followed:** Same as how `sourceManager.formatSourceState()` is passed to `buildContextParts()`.

**Conflict likelihood:** MEDIUM — `buildTextPrompt` is where all context assembly happens. If upstream changes context injection flow, our batch schema injection needs re-applying.

### 2.5 `packages/shared/src/agent/pi-agent.ts`

**What we changed:**
- Added import: `getSessionBatchContext` from `session-scoped-tools.ts`
- In prompt building: reads batch context and passes `batchOutputSchema` to `buildContextParts()`

**Why:** Ensures batch output instructions are injected as hidden context for PiAgent-backed sessions (non-Claude LLMs).

**Pattern followed:** Same as how `sourceManager.formatSourceState()` is passed to `buildContextParts()`.

**Conflict likelihood:** MEDIUM — if upstream changes PiAgent's prompt building flow.

### 2.6 `packages/shared/src/agent/core/prompt-builder.ts`

**What we changed:**
- Added import: `buildBatchOutputInstruction` from `batches/output-instruction.ts`
- In `buildContextParts()`: if `options.batchOutputSchema` is present, generates and appends output instruction block (wrapped in `<batch_output_instructions>` XML tags)

**Why:** Centralizes batch output instruction injection in the same place as all other context parts (session state, sources, workspace capabilities).

**Pattern followed:** Same pattern as workspace capabilities injection — check option, generate block, push to parts array.

**Conflict likelihood:** MEDIUM — if upstream changes `buildContextParts()` signature or adds new context blocks.

### 2.7 `packages/shared/src/agent/core/types.ts`

**What we changed:**
- Added `batchOutputSchema?: Record<string, unknown>` to `ContextBlockOptions` interface

**Conflict likelihood:** LOW — additive field.

### 2.8 `packages/shared/src/agent/mode-manager.ts`

**What we changed:**
- In `getSessionSafeAllowedToolNames()` call: added `includeBatchOutput: true` so `batch_output` is allowed in Explore (safe) mode

**Why:** `batch_output` must work in safe mode because batch sessions default to `permissionMode: 'safe'`.

**Pattern followed:** Mirrors `includeDeveloperFeedback: FEATURE_FLAGS.developerFeedback` on the same call.

**Conflict likelihood:** LOW — single line addition, but in a frequently-edited function.

### 2.9 `packages/shared/src/config/validators.ts`

**What we changed:**
- Added imports: `validateBatchesContent`, `validateBatches`, `BATCHES_CONFIG_FILE`
- In `validateAll()`: added `results.push(validateBatches(workspaceRoot))`
- Extended `ConfigFileDetection` union: added `'batch-config'`
- In `detectConfigFileType()`: added check for `BATCHES_CONFIG_FILE` returning `{ type: 'batch-config' }`
- In `validateConfigFileContent()` switch: added `case 'batch-config'` calling `validateBatchesContent()`

**Pattern followed:** Identical to how `automations` is handled in each of these functions.

**Conflict likelihood:** MEDIUM — if upstream adds new config types, the same detection/validation switch needs updating.

### 2.10 `packages/shared/src/config/watcher.ts`

**What we changed:**
- Added import: `BATCHES_CONFIG_FILE`
- Extended `ConfigWatcherCallbacks` interface: added `onBatchesConfigChange?: (workspaceId: string) => void`
- In `handleConfigFileChange()`: added check for `BATCHES_CONFIG_FILE`, calls `this.handleBatchesConfigChange()`
- Added new private method `handleBatchesConfigChange()`

**Pattern followed:** Exact copy of the `automations.json` watching pattern.

**Conflict likelihood:** MEDIUM — if upstream refactors the watcher, our additions need porting.

### 2.11 `packages/shared/src/docs/doc-links.ts`

**What we changed:**
- Added `'batches'` to `DocFeature` union type
- Added `batches` entry in `DOCS` record with path, title, summary

**Conflict likelihood:** LOW — additive.

### 2.12 `packages/shared/src/docs/index.ts`

**What we changed:**
- Added `batches: \`${APP_ROOT}/docs/batches.md\`` to `DOC_REFS`

**Conflict likelihood:** LOW — additive.

### 2.13 `packages/shared/src/prompts/system.ts`

**What we changed:**
- Added one row to the doc reference table: `| Batches | \`${DOC_REFS.batches}\` | BEFORE creating/modifying batch processing jobs |`

**Conflict likelihood:** LOW — additive table row.

### 2.14 `packages/shared/CLAUDE.md`

**What we changed:**
- Added import example for batches
- Added `batches/` directory description in file structure

**Conflict likelihood:** LOW.

### 2.15 `packages/shared/package.json`

**What we changed:**
- Added subpath export: `"./batches": "./src/batches/index.ts"`

**Conflict likelihood:** LOW — additive entry in exports map.

### 2.16 `packages/session-tools-core/src/context.ts`

**What we changed:**
- Added `validateBatches()` method to `ValidatorInterface`
- Added new `BatchContext` interface (batchId, itemId, outputPath, outputSchema)
- Added optional `batchContext?: BatchContext` to `SessionToolContext`

**Pattern followed:** `validateBatches` mirrors `validateAutomations`. `batchContext` follows the optional capability pattern.

**Conflict likelihood:** MEDIUM — if upstream adds new validators or context fields.

### 2.17 `packages/session-tools-core/src/handlers/config-validate.ts`

**What we changed:**
- Added `BATCHES_CONFIG_FILE` constant
- Added `'batches'` to `ConfigValidateArgs.target` enum
- Added `case 'batches'` in validator switch and fallback validation switch
- Updated error message to list `'batches'` as valid target

**Pattern followed:** Identical to the `automations` case in both switches.

**Conflict likelihood:** MEDIUM — if upstream adds new validation targets.

### 2.18 `packages/session-tools-core/src/handlers/index.ts`

**What we changed:**
- Added exports: `handleBatchOutput`, `BatchOutputArgs`

**Conflict likelihood:** LOW — additive.

### 2.19 `packages/session-tools-core/src/index.ts`

**What we changed:**
- Added exports: `BatchContext` type, `handleBatchOutput` handler, `BatchOutputArgs` type, `BatchOutputSchema`

**Conflict likelihood:** LOW — additive.

### 2.20 `packages/session-tools-core/src/tool-defs.ts`

**What we changed:**
- Added import: `handleBatchOutput`
- Added `BatchOutputSchema` (Zod schema for `data` field)
- Added `batch_output` tool description in `TOOL_DESCRIPTIONS`
- Added `'batches'` to `ConfigValidateSchema` target enum
- Added `batches` description line to `config_validate` tool description
- Added `batch_output` entry to `SESSION_TOOL_DEFS` array (with `safeMode: 'allow'`)
- Extended `SessionToolFilterOptions` with `includeBatchOutput?: boolean`
- Modified `getSessionToolDefs()`: excludes `batch_output` unless `includeBatchOutput` is true
- Modified `getToolDefsAsJsonSchema()`: propagates `includeBatchOutput`

**Pattern followed:** `includeBatchOutput` follows the exact same pattern as `includeDeveloperFeedback`.

**Conflict likelihood:** HIGH — `tool-defs.ts` is a central registry. Any upstream tool additions/changes touch the same arrays and functions.

### 2.21 `packages/server-core/src/sessions/SessionManager.ts`

**What we changed:**
- Added imports: `registerSessionBatchContext`, `BatchProcessor`
- Added `batchProcessors: Map<string, BatchProcessor>` to SessionManager
- In workspace init block: created `BatchProcessor` per workspace with callbacks for `onExecutePrompt`, `onProgress`, `onBatchComplete`, `onError`; called `ensureConfigIds()`
- Added `onBatchesConfigChange` callback in ConfigWatcher init: reloads batch processor config, broadcasts change event
- Modified `executePromptAutomation()`: added `hidden` and `batchContext` parameters
- In session creation: passes `hidden` flag, registers batch context via `registerSessionBatchContext()`
- In session completion handler: notifies all batch processors via `onSessionComplete()`
- Added `broadcastBatchesChanged()` method using `eventSink` pattern
- Added `getBatchProcessor()` method (used by RPC handlers)
- In `dispose()`: cleans up all batch processors

**Why:** SessionManager owns batch processor lifecycle, similar to how it owns automation systems.

**Pattern followed:** Mirrors the automationSystems management pattern exactly (per-workspace Map, init in workspace block, dispose, broadcast).

**Conflict likelihood:** HIGH — SessionManager is a large, frequently-changed file. The workspace init block, `executePromptAutomation()`, session completion handler, and `dispose()` are all hot zones.

### 2.22 `packages/server-core/src/handlers/session-manager-interface.ts`

**What we changed:**
- Added `getBatchProcessor?()` method returning `BatchProcessor | undefined`
- Extended `executePromptAutomation()` signature with `hidden` and `batchContext` parameters

**Pattern followed:** Optional method pattern for batch processor access.

**Conflict likelihood:** MEDIUM — if upstream changes the interface signature.

### 2.23 `packages/shared/src/protocol/channels.ts`

**What we changed:**
- Added `batches` namespace to `RPC_CHANNELS` with 10 channels (LIST, START, PAUSE, RESUME, GET_STATUS, GET_STATE, SET_ENABLED, DUPLICATE, DELETE, CHANGED)

**Conflict likelihood:** LOW — additive namespace.

### 2.24 `packages/shared/src/protocol/dto.ts`

**What we changed:**
- Added `batch_progress` and `batch_complete` event types to `SessionEvent` union

**Conflict likelihood:** MEDIUM — if upstream adds new event types to the same union.

### 2.25 `packages/shared/src/protocol/events.ts`

**What we changed:**
- Added `[RPC_CHANNELS.batches.CHANGED]: [workspaceId: string]` to `BroadcastEventMap`

**Conflict likelihood:** LOW — additive.

### 2.26 `apps/electron/src/transport/channel-map.ts`

**What we changed:**
- Added 10 batch channel mappings: `listBatches`, `startBatch`, `pauseBatch`, `resumeBatch`, `getBatchStatus`, `getBatchState`, `setBatchEnabled`, `duplicateBatch`, `deleteBatch`, `onBatchesChanged`

**Conflict likelihood:** LOW — additive entries at end of map.

### 2.27 `apps/electron/src/shared/types.ts`

**What we changed:**
- Added `BatchFilter`, `BatchesNavigationState` interfaces
- Added `BatchesNavigationState` to `NavigationState` union
- Added `isBatchesNavigation()` type guard
- Added batch handling to `getNavigationStateKey()` and `parseNavigationStateKey()`
- Batch method signatures on `ElectronAPI` (auto-generated from channel-map)

**Note:** In v0.7.0, most types moved to `packages/shared/src/protocol/`. The remaining types in `shared/types.ts` are Electron-specific (navigation, filters, ElectronAPI).

**Conflict likelihood:** MEDIUM — navigation state changes are a common edit target.

### 2.28 `apps/electron/src/shared/routes.ts`

**What we changed:**
- Added `batches()` route builder to `routes.view`

**Conflict likelihood:** LOW — additive.

### 2.29 `apps/electron/src/shared/route-parser.ts`

**What we changed:**
- Added `'batches'` to `NavigatorType` union
- Added `batchFilter` to `ParsedCompoundRoute` interface
- Added `'batches'` to `COMPOUND_ROUTE_PREFIXES`
- Added batch parsing/building/conversion in all route functions

**Pattern followed:** Mirrors automations route handling in every function.

**Conflict likelihood:** MEDIUM — each modified function may have upstream changes if new navigators are added.

### 2.30 `apps/electron/src/renderer/App.tsx`

**What we changed:**
- Added `batchHandlersRef` (React ref for batch event callbacks)
- In `onSessionEvent`: routes `batch_progress` and `batch_complete` events to ref handlers
- Passes `batchHandlersRef` to `AppShell`

**Conflict likelihood:** MEDIUM — `onSessionEvent` handler is a common edit target.

### 2.31 `apps/electron/src/renderer/components/app-shell/AppShell.tsx`

**What we changed:**
- Added imports for batch types, components, hook
- Added `batchHandlersRef` prop to `AppShellProps`
- Added `useBatches()` hook call with full destructuring
- Added `useEffect` to wire batch handlers to ref
- Added batch navigation handler, filter derivation
- Added "Batches" sidebar nav item with count badge
- Added "Add Batch" button (via EditPopover) in header
- Added `BatchesListPanel` rendering
- Added batch delete confirmation dialog
- Extended AppShellContext value with batch handlers

**Pattern followed:** Mirrors automations integration in AppShell point-by-point.

**Conflict likelihood:** HIGH — `AppShell.tsx` is very large and frequently modified.

### 2.32 `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`

**What we changed:**
- Added imports for batch guard, component, atom
- Extracted batch handlers from context
- Added batches navigator rendering branch (BatchInfoPage or empty state)

**Conflict likelihood:** MEDIUM.

### 2.33 `apps/electron/src/renderer/components/ui/EditPopover.tsx`

**What we changed:**
- Added `'batch-config'` to `EditContextKey` union
- Added `batch-config` entry in the edit config map

**Conflict likelihood:** MEDIUM — if upstream adds new edit contexts.

### 2.34 `apps/electron/src/renderer/context/AppShellContext.tsx`

**What we changed:**
- Added 6 batch-related methods to `AppShellContextType` interface (no toggle — batches are one-shot)

**Conflict likelihood:** LOW-MEDIUM — additive interface extension.

### 2.35 `apps/electron/src/renderer/contexts/NavigationContext.tsx`

**What we changed:**
- Re-exported `isBatchesNavigation` type guard

**Conflict likelihood:** LOW.

### 2.36 `README.md`

**What we changed:**
- Added `batches.json` to config file structure diagram
- Added "Batches" section with description, example prompts, JSON example, feature summary

**Conflict likelihood:** LOW-MEDIUM.

---

## Part 3: Integration Dependency Map

These are the upstream interfaces/functions our batch code depends on. If upstream changes them, our code needs updating.

### 3.1 Direct Code Imports from Automations

| Our file | Imports from | Function |
|----------|-------------|----------|
| `batch-processor.ts` | `automations/utils.ts` | `expandEnvVars()` |
| `batch-processor.ts` | `automations/security.ts` | `sanitizeForShell()` |

**Risk:** If upstream renames, moves, or changes the signature of these functions, batch-processor breaks.

### 3.2 Upstream Interfaces We Extend

| Interface | File | What we added |
|-----------|------|---------------|
| `ClaudeContextOptions` | `agent/claude-context.ts` | `batchContext?: BatchContext` |
| `SessionToolContext` | `session-tools-core/context.ts` | `batchContext?: BatchContext` |
| `ValidatorInterface` | `session-tools-core/context.ts` | `validateBatches()` method |
| `ConfigWatcherCallbacks` | `config/watcher.ts` | `onBatchesConfigChange?` callback |
| `ConfigFileDetection` | `config/validators.ts` | `'batch-config'` variant |
| `SessionToolFilterOptions` | `session-tools-core/tool-defs.ts` | `includeBatchOutput?: boolean` |
| `ContextBlockOptions` | `agent/core/types.ts` | `batchOutputSchema?: Record<string, unknown>` |
| `ISessionManager` | `server-core/handlers/session-manager-interface.ts` | `getBatchProcessor?()`, `batchContext` param |
| `SessionEvent` | `shared/protocol/dto.ts` | `batch_progress`, `batch_complete` |
| `RPC_CHANNELS` | `shared/protocol/channels.ts` | `batches.*` namespace |
| `BroadcastEventMap` | `shared/protocol/events.ts` | `batches.CHANGED` entry |
| `CHANNEL_MAP` | `electron transport/channel-map.ts` | 10 batch method mappings |
| `NavigationState` | `electron shared/types.ts` | `BatchesNavigationState` variant |
| `EditContextKey` | `renderer EditPopover.tsx` | `'batch-config'` |
| `AppShellContextType` | `renderer AppShellContext.tsx` | 7 batch handler methods |
| `AppShellProps` | `renderer AppShell.tsx` | `batchHandlersRef` prop |

### 3.3 Upstream Functions We Modified

| Function | File | What we changed |
|----------|------|-----------------|
| `createClaudeContext()` | `agent/claude-context.ts` | Accept and pass through `batchContext` |
| `getSessionScopedTools()` | `agent/session-scoped-tools.ts` | Read batch context, pass `includeBatchOutput` |
| `cleanupSessionScopedTools()` | `agent/session-scoped-tools.ts` | Also clean up batch context |
| `validateAll()` | `config/validators.ts` | Push `validateBatches()` result |
| `detectConfigFileType()` | `config/validators.ts` | Detect `batches.json` |
| `validateConfigFileContent()` | `config/validators.ts` | Handle `batch-config` case |
| `getSessionToolDefs()` | `session-tools-core/tool-defs.ts` | Filter `batch_output` by flag |
| `getToolDefsAsJsonSchema()` | `session-tools-core/tool-defs.ts` | Propagate `includeBatchOutput` |
| `buildContextParts()` | `agent/core/prompt-builder.ts` | Inject `<batch_output_instructions>` when `batchOutputSchema` present |
| `buildTextPrompt()` | `agent/claude-agent.ts` | Read batch context, pass `batchOutputSchema` to `buildContextParts()` |
| `buildTextPrompt()` | `agent/pi-agent.ts` | Same as ClaudeAgent |
| `getSessionSafeAllowedToolNames()` call | `agent/mode-manager.ts` | Added `includeBatchOutput: true` |
| `executePromptAutomation()` | `server-core sessions/SessionManager.ts` | Added `hidden` + `batchContext` params |
| Session completion handler | `server-core sessions/SessionManager.ts` | Notify batch processors |
| `dispose()` | `server-core sessions/SessionManager.ts` | Clean up batch processors |
| `broadcastBatchesChanged()` | `server-core sessions/SessionManager.ts` | Uses `eventSink` pattern |

### 3.4 Upstream UI Components We Depend On

| Component/Pattern | Used by |
|-------------------|---------|
| `Info_Page` compound component system | `BatchInfoPage` |
| `EntityListEmptyScreen`, `EntityRow` | `BatchesListPanel` |
| `EditPopover` | AppShell (Add Batch button) |
| `SessionSearchHeader` | `BatchesListPanel` |
| `useMenuComponents()` hook | `BatchMenu` |
| `useNavigation()` hook | `BatchItemTimeline`, `BatchInfoPage` |
| Jotai atoms pattern | `batchesAtom` |
| Sonner toast notifications | `useBatches` |

---

## Part 4: Merge Strategy Checklist

When merging upstream updates:

1. **Run `git diff upstream/main...origin/main --stat`** to see which of our files are affected by upstream changes
2. **Check automations first** — if upstream changed automations (validation, watcher, RPC handlers, UI), apply the same changes to our batch equivalents
3. **High-risk files** (always inspect manually):
   - `packages/server-core/src/sessions/SessionManager.ts` — our batch processor lifecycle is woven into workspace init, session completion, and dispose
   - `apps/electron/src/renderer/components/app-shell/AppShell.tsx` — our UI additions span sidebar, header, content, and dialog sections
   - `packages/session-tools-core/src/tool-defs.ts` — our tool registration and filter options are in the tool array and filter functions
   - `packages/shared/src/agent/session-scoped-tools.ts` — our batch context registry modifies the tool initialization flow
   - `packages/shared/src/agent/claude-context.ts` — our batch context passing modifies the context creation
   - `packages/shared/src/agent/claude-agent.ts` / `pi-agent.ts` — our `batchOutputSchema` injection in `buildTextPrompt()`
   - `packages/shared/src/agent/core/prompt-builder.ts` — our batch output instruction injection in `buildContextParts()`
   - `packages/shared/src/agent/mode-manager.ts` — our `includeBatchOutput: true` in safe mode allowlist
   - `packages/server-core/src/handlers/session-manager-interface.ts` — our interface extensions for batch processor access
4. **If upstream moves automations utilities** (`expandEnvVars`, `sanitizeForShell`): update import paths in `batch-processor.ts`
5. **If upstream adds new navigator types**: check `route-parser.ts` functions for our batch cases
6. **If upstream restructures RPC handlers**: check our `packages/server-core/src/handlers/rpc/batches.ts` follows the new pattern
7. **If upstream changes protocol layer**: ensure `RPC_CHANNELS.batches.*`, `SessionEvent` batch variants, and `BroadcastEventMap` batch entry are present
8. **If upstream changes transport layer**: ensure `channel-map.ts` has our 10 batch method mappings
9. **After merge, run tests**: `bun test packages/shared/src/batches/` and `bun test packages/session-tools-core/`

---

## Part 5: Merge History

| Upstream Version | Date | Conflicts | Notes |
|-----------------|------|-----------|-------|
| v0.7.0 | 2026-03-06 | 9 (2 modify/delete + 7 content) | Major RPC/transport refactoring. Ported batch IPC handlers → `rpc/batches.ts`, preload methods → `channel-map.ts`, types → protocol layer. |
| post-merge | 2026-03-06 | — | Batch refinements: LLM string coercion in batch_output, safe mode allowlist fix, ajv schema validation, one-shot menu simplification (removed enable/disable + restart), output instructions moved from user prompt to context injection. |
