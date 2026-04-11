# CLAUDE.md — `@craft-agent/shared`

## Purpose
Core business logic package for Craft Agent:
- Agent backends and session-scoped tools
- Sources, credentials, sessions, and config
- Permission modes and validation

**Important:** Keep this file and the root `CLAUDE.md` up-to-date whenever functionality changes.

## Overview

`@craft-agent/shared` is the core business logic package for Craft Agent. It contains:
- Agent implementation (CraftAgent, session-scoped tools, permission modes)
- Authentication (OAuth, credentials, auth state)
- Configuration (storage, preferences, themes, watcher)
- MCP client and validation
- Headless execution mode
- Dynamic status system
- Session persistence

## Package Exports

This package uses subpath exports for clean imports:

```typescript
import { CraftAgent, getPermissionMode, setPermissionMode } from '@craft-agent/shared/agent';
import { BatchProcessor, type BatchConfig } from '@craft-agent/shared/batches';
import { loadStoredConfig, type Workspace } from '@craft-agent/shared/config';
import { getCredentialManager } from '@craft-agent/shared/credentials';
import { CraftMcpClient } from '@craft-agent/shared/mcp';
import { loadWorkspaceSources, type LoadedSource } from '@craft-agent/shared/sources';
import { loadStatusConfig, createStatus } from '@craft-agent/shared/statuses';
import { resolveTheme } from '@craft-agent/shared/config/theme';
import { debug } from '@craft-agent/shared/utils';
```

## Directory Structure

```
src/
├── agent/              # CraftAgent, session-scoped-tools, mode-manager, mode-types, permissions-config
├── auth/               # OAuth, craft-token, claude-token, state
├── batches/            # Batch processing system (processor, state, data sources, validation)
├── config/             # Storage, preferences, models, theme, watcher
├── credentials/        # Secure credential storage (AES-256-GCM)
├── headless/           # Non-interactive execution mode
├── mcp/                # MCP client, connection validation, McpClientPool
├── prompts/            # System prompt generation
├── sessions/           # Session index, storage, persistence-queue
├── sources/            # Source types, storage, service
├── statuses/           # Dynamic status types, CRUD, storage
├── subscription/       # Craft subscription checking
├── utils/              # Debug logging, file handling, summarization
├── validation/         # URL validation
├── version/            # Version management, install scripts
├── workspaces/         # Workspace storage
├── branding.ts         # Branding constants
└── network-interceptor.ts    # Fetch interceptor for API errors and MCP schema injection
```

## Key Concepts

### CraftAgent (`src/agent/craft-agent.ts`)
The main agent class that wraps the Claude Agent SDK. Handles:
- MCP server connections
- Tool permissions via PreToolUse hook
- Large result summarization via PostToolUse hook
- Permission mode integration (safe/ask/allow-all)
- Session continuity

### Permission Modes (`src/agent/mode-manager.ts`, `mode-types.ts`)
Three-level permission system per session:

| Mode | Display Name | Behavior |
|------|--------------|----------|
| `'safe'` | Explore | Read-only, blocks write operations |
| `'ask'` | Ask to Edit | Prompts for bash commands (default) |
| `'allow-all'` | Auto | Auto-approves all commands |

- **Per-session state:** No global contamination between sessions
- **Keyboard shortcut:** SHIFT+TAB cycles through modes
- **UI config:** `PERMISSION_MODE_CONFIG` provides display names, colors, SVG icons

### Permissions Configuration (`src/agent/permissions-config.ts`)
Customizable safety rules at two levels (additive merging):
- Workspace: `~/.craft-agent/workspaces/{id}/permissions.json`
- Source: `~/.craft-agent/workspaces/{id}/sources/{slug}/permissions.json`

**Rule types:**
- `blockedTools` - Tools to block (extends defaults)
- `allowedBashPatterns` - Regex for read-only bash commands
- `allowedMcpPatterns` - Regex for allowed MCP tools
- `allowedApiEndpoints` - Fine-grained API rules `{ method, pathPattern }`
- `allowedWritePaths` - Glob patterns for writable directories

### Session-Scoped Tools (`src/agent/session-scoped-tools.ts`)
Tools available within agent sessions with callback registry:

**Source management:** `source_test`, `source_oauth_trigger`, `source_google_oauth_trigger`, `source_credential_prompt`

**Utilities:** `SubmitPlan`, `config_validate`, `transform_data`, `script_sandbox`

**Callbacks:** `onPlanSubmitted`, `onOAuthBrowserOpen`, `onOAuthSuccess`, `onOAuthError`, `onCredentialRequest`, `onSourcesChanged`, `onSourceActivated`

### Dynamic Status System (`src/statuses/`)
Workspace-level customizable workflow states:

**Storage:** `~/.craft-agent/workspaces/{id}/statuses/config.json`

**Status properties:** `id`, `label`, `color`, `icon`, `shortcut`, `category` (open/closed), `isFixed`, `isDefault`, `order`

**Default statuses:** Todo, In Progress, Needs Review, Done, Cancelled

**CRUD:** `createStatus()`, `updateStatus()`, `deleteStatus()`, `reorderStatuses()`

### Theme System (`src/config/theme.ts`)
Cascading theme configuration: app → workspace (last wins)

**Storage:**
- App: `~/.craft-agent/theme.json`
- Workspace: `~/.craft-agent/workspaces/{id}/theme.json`

**6-color system:** `background`, `foreground`, `accent`, `info`, `success`, `destructive`

**Functions:** `resolveTheme()`, `themeToCSS()`, dark mode support via `dark: { ... }` overrides

### Session Persistence (`src/sessions/`)
- **persistence-queue.ts:** Debounced async session writes (500ms)
- **storage.ts:** Session CRUD, portable path format
- **index.ts:** Session listing and metadata

### Credentials (`src/credentials/`)
All sensitive credentials (API keys, OAuth tokens) are stored in an AES-256-GCM encrypted file at `~/.craft-agent/credentials.enc`. The `CredentialManager` provides the API for reading and writing credentials.

### MCP Source Architecture

All source connections (MCP and API) are managed through a single centralized pool:

**McpClientPool (centralized, main process)**
- `McpClientPool` (`src/mcp/mcp-pool.ts`) manages all source connections in the Electron main process
- MCP sources sync via `pool.sync(mcpServers)` — connects new sources, disconnects removed ones
- API sources sync via `pool.syncApiServers(apiServers)` — connects in-process `ApiSourcePoolClient` instances
- Both sync calls happen in `BaseAgent.setSourceServers()`, so all backends share the same pool logic
- Claude: proxy tools are created via `createSourceProxyServers(pool)` and added to SDK `Options.mcpServers`
- Pi: proxy tool definitions are sent to the subprocess via `registerPoolToolsWithSubprocess()`

### Bridge MCP Server Credential Flow

For Codex and Copilot sessions, API sources use the Bridge MCP Server which runs as a subprocess. Since it can't access the encrypted credentials directly, a **passive credential refresh** model is used:

```
┌─────────────────────────────────────────────────────────────────┐
│ Main Process (Electron)                                          │
│                                                                  │
│  1. User enables API source in session                          │
│  2. decrypt credential from credentials.enc                      │
│  3. write to .credential-cache.json (permissions: 0600)         │
│     └── ~/.craft-agent/workspaces/{ws}/sources/{slug}/          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ reads on each request
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Bridge MCP Server (subprocess)                                   │
│                                                                  │
│  1. On tool call, read fresh credential from cache file         │
│  2. Check expiresAt - if expired, return auth error             │
│  3. Inject auth header and make API request                     │
└─────────────────────────────────────────────────────────────────┘
```

**Key characteristics:**
- **Passive refresh:** Bridge reads cache on each request (no active polling)
- **Token expiry:** If OAuth token expires mid-session, requests fail with auth error
- **User action required:** To refresh expired tokens, user must re-authenticate in UI
- **Security:** Cache files have 0600 permissions (owner read/write only)

**Files involved:**
- Write: `apps/electron/src/main/sessions.ts` → `setupCodexSessionConfig()`
- Read: `packages/bridge-mcp-server/src/index.ts` → `readCredential()`

### Configuration (`src/config/storage.ts`)
Multi-workspace configuration stored in `~/.craft-agent/config.json`. Supports:
- Multiple workspaces with separate MCP servers and sessions
- Default permission mode for new sessions
- Extended cache TTL preference
- Token display mode

### Config Watcher (`src/config/watcher.ts`)
File watcher for live config updates:
- Watches `config.json`, `theme.json`, `permissions.json` at all levels
- Callbacks: `onConfigChange`, `onThemeChange`, `onWorkspacePermissionsChange`, `onSourcePermissionsChange`

### Sources (`src/sources/`)
Sources are external data connections (MCP servers, APIs, local filesystems). Stored at `~/.craft-agent/workspaces/{id}/sources/{slug}/` with config.json and guide.md. Types: `mcp`, `api`, `local`, `gmail`.

## Dependencies

- `@craft-agent/core` - Shared types
- `@anthropic-ai/claude-agent-sdk` - Claude Agent SDK

## Type Checking

## Commands
From repo root:
```bash
cd packages/shared && bun run tsc --noEmit
```

## Hard rules
- Permission modes are fixed: `safe`, `ask`, `allow-all`.
- Source types are fixed: `mcp`, `api`, `local`.
- Keep credential handling in `src/credentials/` pathways (no ad-hoc secret storage).
- Keep user-facing tool contracts backward-compatible where possible.

## Notes
- `ClaudeAgent` is the primary class in `src/agent/claude-agent.ts`.
- Claude SDK subprocess env is sanitized to strip Claude-specific Bedrock routing vars (`CLAUDE_CODE_USE_BEDROCK`, `AWS_BEARER_TOKEN_BEDROCK`, `ANTHROPIC_BEDROCK_BASE_URL`). Pi Bedrock uses its own AWS env path instead.
- Backward alias export (`CraftAgent`) exists for compatibility.
- Session lifecycle distinguishes **hard aborts** from **UI handoff interrupts**:
  - use hard aborts for true cancellation/teardown (`UserStop`, redirect fallback)
  - use handoff interrupts for pause points where control moves to the UI (`AuthRequest`, `PlanSubmitted`)
- Remote workspace handoff summaries are injected as one-shot hidden context on the destination session's first turn.
- WebUI source OAuth uses a stable relay redirect URI (`https://agents.craft.do/auth/callback`); the deployment-specific callback target is carried in a relay-owned outer `state` envelope and unwrapped by the router worker.
- Automations matching is unified through canonical matcher adapters in `src/automations/utils.ts` (`matcherMatches*`). Avoid direct primitive-only matcher checks in feature code so condition gating stays consistent across app and agent events.

## i18n (Internationalization)

Translations live in `src/i18n/locales/{lang}.json`. All user-facing strings must use `t()` (React) or `i18n.t()` (non-React).

### Locale registry (single source of truth)

All locale metadata lives in **`src/i18n/registry.ts`**. To add a new locale:

1. Create `src/i18n/locales/{code}.json` with all keys (copy from `en.json`)
2. Import the messages and `date-fns` locale in `registry.ts`
3. Add one entry to `LOCALE_REGISTRY`

**That's it.** `SUPPORTED_LANGUAGE_CODES`, `LANGUAGES`, i18n resources, and `getDateLocale()` are all derived automatically. No other file needs to change.

### Key naming convention

Keys use **flat dot-notation** with a category prefix:

| Prefix | Scope | Example |
|--------|-------|---------|
| `common.*` | Shared labels (Cancel, Save, Close, Edit, Loading...) | `common.cancel` |
| `menu.*` | App menu items (File, Edit, View, Window) | `menu.toggleSidebar` |
| `sidebar.*` | Left sidebar navigation items | `sidebar.allSessions` |
| `sidebarMenu.*` | Sidebar context menu actions | `sidebarMenu.addSource` |
| `sessionMenu.*` | Session context menu actions | `sessionMenu.archive` |
| `settings.*` | Settings pages — nested by page ID | `settings.ai.connections` |
| `chat.*` | Chat input, session viewer, inline UI | `chat.attachFiles` |
| `toast.*` | Toast/notification messages | `toast.failedToShare` |
| `errors.*` | Error screens | `errors.sessionNotFound` |
| `onboarding.*` | Onboarding flow — nested by step | `onboarding.welcome.title` |
| `dialog.*` | Modal dialogs | `dialog.reset.title` |
| `apiSetup.*` | API connection setup | `apiSetup.modelTier.best` |
| `workspace.*` | Workspace creation/management | `workspace.createNew` |
| `sourceInfo.*` | Source detail page | `sourceInfo.connection` |
| `skillInfo.*` | Skill detail page | `skillInfo.metadata` |
| `automations.*` | Automation list/detail/menus | `automations.runTest` |
| `sourcesList.*` | Sources list panel | `sourcesList.noSourcesConfigured` |
| `skillsList.*` | Skills list panel | `skillsList.addSkill` |
| `editPopover.*` | EditPopover labels/placeholders | `editPopover.label.addSource` |
| `status.*` | Session status names (by status ID) | `status.needs-review` |
| `mode.*` | Permission mode names (by mode ID) | `mode.safe` |
| `hints.*` | Empty state workflow suggestions | `hints.summarizeGmail` |
| `table.*` | Data table column headers | `table.access` |
| `time.*` | Relative time strings | `time.minutesAgo_other` |
| `session.*` | Session list UI | `session.noSessionsYet` |
| `shortcuts.*` | Keyboard shortcuts descriptions | `shortcuts.sendMessage` |
| `sendToWorkspace.*` | Send to workspace dialog | `sendToWorkspace.title` |
| `webui.*` | WebUI-specific strings | `webui.connectionFailed` |
| `auth.*` | Auth banner/prompts | `auth.connectionRequired` |
| `browser.*` | Browser empty state | `browser.readyTitle` |

### Rules

1. **Never call `i18n.t()` at module level** — store `labelKey` strings and resolve in components/functions.
2. **Use i18next pluralization** (`_one`/`_other`), never manual `count === 1 ?` logic.
3. **Keep brand names in English**: Craft, Craft Agents, Agents, Workspace, Claude, Anthropic, OpenAI, MCP, API, SDK.
4. **Include `...` in the translation value** if the UI needs an ellipsis — don't append it in JSX.
5. **Use `<Trans>` component** for translations containing HTML tags (e.g. `<strong>`).
6. **Use `i18n.resolvedLanguage`** (not `i18n.language`) when comparing against supported language codes.
7. **Keys must exist in all locale files** (`en.json`, `es.json`, `zh-Hans.json`, and any future locales). Keep alphabetically sorted.
8. **Watch translation length for constrained UI elements.** Translations can be 20-100%+ longer than English. For buttons, badges, tab labels, and dropdown items, keep translations concise — use shorter synonyms if needed. High-risk areas:
   - Permission mode badges (3-5 characters max)
   - Settings tab labels (≤10 characters ideal)
   - Button labels (avoid exceeding 2x the English length)
   - Menu items (flexible, but avoid 3x+ growth)

### Adding a new translated string

1. Add the key + English value to `en.json` (alphabetical order)
2. Add the key + translated value to all other locale files (`es.json`, `zh-Hans.json`)
3. Use `t("your.key")` in the component (add `useTranslation()` hook if not present)
4. For non-React code, use `i18n.t("your.key")` — but only inside functions, never at module level

### Adding a new locale

1. Create `src/i18n/locales/{code}.json` with all keys from `en.json`
2. Add the entry to `LOCALE_REGISTRY` in `src/i18n/registry.ts` (messages + date-fns locale + native name)
3. Run tests — the registry tests will catch any missing wiring

## Source of truth
- Package exports: `packages/shared/src/index.ts` and subpath export entries.
- Agent exports: `packages/shared/src/agent/index.ts`
