# DataPilot Branch Guide

> Branch: `feature/data-analysis-agent`
> Base: `main` (commit `0a778e2`)
> Purpose: 将 Craft Agent 改造为面向数据分析场景的垂直 Agent — **DataPilot**
>
> **Last updated:** 2026-03-12 (v2)

## 目标

基于 Craft Agent 开源项目，构建一个专注于数据分析的垂直 Agent。改造分阶段进行，优先处理用户感知层（提示词、品牌），再逐步深入到内部标识和功能增强。

---

## 已完成的改动

### P0 — 品牌提示词层（用户直接感知）

将 Agent 的身份从 "Craft Agent" 替换为 "DataPilot"。

| 文件 | 改动内容 |
|------|----------|
| `packages/shared/src/prompts/system.ts` | 身份定义、自称指令、Git co-author、CLI 章节标题及命令、配置文档表格、Mini agent 提示词、文档搜索引用、开发者反馈团队名、环境标记注释（共 11 处） |
| `packages/shared/src/prompts/print-system-prompt.ts` | 调试脚本标题和注释（5 处） |
| `packages/shared/src/auth/oauth.ts` | `CLIENT_NAME = 'DataPilot'` |
| `packages/shared/src/branding.ts` | 品牌注释 |

**合并关注点:** 上游频繁修改 `system.ts`。合并时需检查：
- 上游是否新增了包含 "Craft Agent" 的提示词段落（需同步替换）
- 上游是否重写了我们已修改的行（需保留 DataPilot 版本）
- `print-system-prompt.ts` 冲突风险低，主要是注释文本

### P1（部分）— 数据目录 & 环境变量

将用户数据目录从 `~/.craft-agent/` 改为 `~/.datapilot/`，环境变量 `CRAFT_CONFIG_DIR` 改为 `DATAPILOT_CONFIG_DIR`。涉及 83 个文件。

| 改动类别 | 涉及文件 | 说明 |
|----------|----------|------|
| 核心路径常量 | `config/paths.ts`、`workspaces/storage.ts` 及 12 个本地定义 | `CONFIG_DIR` 从 `.craft-agent` → `.datapilot` |
| 环境变量 | `paths.ts`、`permissions-config.ts`、`electron-dev.ts`、`session-mcp-server` 等 6 处 | `CRAFT_CONFIG_DIR` → `DATAPILOT_CONFIG_DIR` |
| 正则 & 路径匹配 | `config-validator.ts`（9 个正则）、`path-processor.ts`（4 个）、`mode-manager.ts`（3 处）、`UserMessageBubble.tsx`（1 处） | `\.craft-agent` → `\.datapilot`，静默失败风险高 |
| 变量名 | `logo.ts`、`config-validate.ts`、`config-validator.ts` | `CRAFT_AGENT_DIR` → `DATAPILOT_DIR`、`craftAgentRoot` → `datapilotRoot`、`CRAFT_AGENT_CONFIG_PATTERNS` → `DATAPILOT_CONFIG_PATTERNS`、`isCraftAgentConfig` → `isDataPilotConfig` |
| MCP & 插件标识 | `validation.ts`、`workspaces/storage.ts` | `craft-agent-validator` → `datapilot-validator`、`craft-workspace-` → `datapilot-workspace-` |
| UI 组件 | `EditPopover.tsx`、`AppearanceSettingsPage.tsx`、`PermissionsSettingsPage.tsx` 等 8 个 | 用户可见的路径引导文本 |
| 测试文件 | `mode-manager.test.ts`（34 处）等 12 个测试文件 | mock 路径和环境变量 |
| 文档 | `README.md`、`CLAUDE.md`、`resources/docs/*.md`、release notes 等 | 所有 `.craft-agent` 路径引用（含 `dist/` 编译版本） |
| 脚本 & 工具 | `electron-dev.ts`、`build-server.ts`、ESLint 规则等 | 多实例开发、Docker、错误信息 |

**未改动：** 加密存储中的 `MAGIC_BYTES`（`CRAFT01`）和密钥派生盐（`craft-agent-v2`）保持原值，仅改了路径。

**合并关注点:** 上游新增包含 `.craft-agent` 路径的代码需同步替换。重点关注：
- `config/paths.ts` — 核心路径定义
- `agent/core/config-validator.ts` — 正则模式，上游可能新增 config 类型
- `agent/mode-manager.ts` — 路径匹配逻辑
- `agent/permissions-config.ts` — 权限目录解析

### P-UI — 用户可感知的品牌名替换

将应用中所有用户能直接看到、读到、听到的 "Craft Agent(s)" 文本替换为 "DataPilot"。涉及约 40 个文件、70+ 处改动。

| 改动类别 | 涉及文件 | 说明 |
|----------|----------|------|
| 应用名称 & 窗口标题 | `electron-builder.yml`、`main/index.ts`、`renderer/index.html`、`playground.html`、`viewer/index.html` | `productName: DataPilot`、`app.setName('DataPilot')`、`<title>DataPilot</title>` |
| macOS 菜单栏 | `main/menu.ts`（5 处）、`AppMenu.tsx`、`TopBar.tsx` | About、Hide、Quit 菜单项、Reset 对话框 |
| 欢迎/登录流程 | `WelcomeStep.tsx`、`ProviderSelectStep.tsx`、`APISetupStep.tsx`（5 处）、`ReauthScreen.tsx`、`CredentialsStep.tsx`（2 处）、`GitBashWarning.tsx` | 所有 onboarding 用户可见文本 |
| 设置页面 | `PreferencesPage.tsx`（5 处描述和 placeholder） | "Help DataPilot personalize..." |
| 聊天输入框 | `chat.tsx` playground（4 处） | `'Message DataPilot...'` |
| 通知 | `useNotifications.ts` | `'DataPilot has a new message for you'` |
| Provider 标签 | `provider-icons.ts`、`ApiKeyInput.tsx`、`FreeFormInput.tsx`、`AiSettingsPage.tsx`（4 处）、`pi-agent.ts`（2 处）、`diagnostics.ts`、`models-pi.ts` | `'Craft Agents Backend'` → `'DataPilot Backend'` |
| 错误信息 | `errors.ts`（2 处）、`connection-setup-logic.ts`（3 处）、`pi-agent-server/index.ts` | 用户可见的错误提示文本 |
| 浏览器空状态 | `BrowserEmptyStateCard.tsx` | 安全提示文本 |
| OAuth 回调页 | `callback-page.ts`（2 处） | 页面标题和返回链接 |
| 内置文档源 | `builtin-sources.ts`（2 处） | 源名称和 tagline |
| MCP 日志 | `session-mcp-server/index.ts`（4 处） | Docs proxy 连接状态日志 |
| 工具描述 | `tool-defs.ts`（2 处） | `config_validate` 和 `send_developer_feedback` 描述 |
| CLI 帮助文本 | `cli/src/index.ts` | `'craft-cli — Terminal client for DataPilot server'` |
| Headless 服务器日志 | `headless-start.ts` | 启动监听日志 |
| 安装脚本 | `install-app.sh`（macOS + Linux，15+ 处）、`install-app.ps1`（Windows，10+ 处） | 所有终端输出文本、APP_NAME、进程检测 |
| 构建脚本 | `build/darwin.ts`、`afterPack.cjs`、`build-dmg.sh`、`build-linux.sh`、`build-win.ps1` | `.app` 路径（`DataPilot.app`）、构建输出 |
| 配置/主题元数据 | `config-defaults.json`、`default.json`、`haze.json`、`tool-icons.json` | `"author": "DataPilot"`、`"displayName": "DataPilot"` |
| GitHub Issue 模板 | `bug_report.yml`、`feature_request.yml` | 用户提交 issue 时看到的描述 |
| Viewer 应用 | `viewer/index.html`、`viewer/Header.tsx` | 页面标题和 logo tooltip |
| 多实例开发 | `electron-dev.ts`（2 处） | `'DataPilot [${instanceNum}]'` |
| 应用内文档 | `resources/docs/` 下 8 个 .md 文件 | 所有 prose 产品名替换（保留 `craft-agent` CLI 命令名和 MCP 工具名不变） |
| 应用内 Release Notes | `resources/release-notes/` 下 8 个 .md 文件 | `0.2.32`–`0.7.0` 中 prose 产品名（保留 GitHub Issue 标题引用和包名不变） |
| 自部署构建脚本 | `scripts/build-server.ts`（5 处） | help 文本、echo 输出、systemd `Description`、便捷脚本注释 |

**未改动的应用内文本（有意保留）：**
- `craft-agent`、`craft-agent-batch` — 实际 CLI 可执行文件名，docs 中的命令引用须与 binary 一致
- `craft-agents-docs`、`SearchCraftAgents` — MCP 工具名，属于内部标识符
- `@craft-agent/*` — 包名，属于 npm 元数据
- GitHub Issue 标题引用（如 `0.3.4.md` 中 "Craft Agents on Hyprland..."）— 历史记录，改了会与 GitHub 不一致
- `$CRAFT_LABEL` — 环境变量名，归入 P1

**合并关注点:** 上游新增的用户可见文本中可能包含 "Craft Agent"，合并后需搜索：
```bash
# 搜索所有用户可见的 Craft Agent 文本（排除 node_modules 和代码注释）
grep -rn "Craft Agent" --include='*.tsx' --include='*.ts' --include='*.html' --include='*.sh' --include='*.ps1' --include='*.yml' --include='*.json' . | grep -v node_modules | grep -v '^\s*//' | grep -v '^\s*\*'
```

重点关注上游新增的：
- Onboarding 步骤和 UI 对话框
- 菜单项和设置页描述文本
- 错误信息和通知文本
- 安装/构建脚本输出
- Provider 标签和连接名称

---

## 已知问题

| 问题 | 说明 |
|------|------|
| `createBackend` 测试在新环境失败 | `~/.datapilot/config-defaults.json` 不存在时 `loadConfigDefaults()` 抛异常。需先启动应用创建目录，或在测试中 mock。属于环境依赖，非代码 bug。 |
| `TRADEMARK.md` 中 bundle ID 被误改 | 文档替换时将 `com.lukilabs.craft-agent` 改为了 `com.lukilabs.datapilot`，但实际 bundle ID 未改动（属于 P3 暂不改动范围）。文档与实际不一致，后续需决定是否真正修改 bundle ID。 |

---

## 未改动项（按类别说明）

### 代码注释 & JSDoc

源码中仍有大量 `// Craft Agent ...` 注释未修改，这些对用户不可见，不影响功能。如需改动，可用全局替换批量处理，但会增加与上游合并的冲突面。

### package.json `description` 字段

各 `package.json` 的 `"description"` 仍为 `"... for Craft Agents"`，属于 npm 元数据，用户不可见。归入 P1 剩余（内部标识层）。

### 构件文件名 `Craft-Agent-xxx`

`electron-builder.yml` 中的 `artifactName`（如 `Craft-Agent-arm64.dmg`、`Craft-Agent-x64.exe`）以及安装脚本中对应的文件名引用**暂未改动**。原因：
- 文件名与服务端下载 URL（`agents.craft.do/electron/latest/`）耦合
- 自动更新清单（`latest-mac.yml`）中引用了这些文件名
- 改动需同步服务端配置，否则下载和自动更新会失败

涉及文件：`electron-builder.yml`（4 处 `artifactName`）、`install-app.sh`（Linux AppImage 文件名）、`install-app.ps1`（Windows exe 文件名）、`scripts/build/` 下 3 个构建脚本。

### Playground 演示数据

`playground/registry/` 下的 `browser-ui.tsx`、`planner.tsx`、`icons.tsx` 中有少量 "Craft Agents" 演示文本（假数据），不影响实际产品体验。

### 测试 Fixture

`storage-startup-migration.test.ts` 中有 6 处 `'Craft Agents Backend (xxx)'` 测试 mock 数据，与实际存储格式匹配旧数据，改动可能导致迁移测试失败。

---

## 未来计划的改动

### P1 剩余 — 内部标识层

| 改动项 | 涉及范围 | 风险说明 |
|--------|----------|---------|
| `@craft-agent/*` 包名 → `@datapilot/*` | 12 个 package.json + 数百个 import + tsconfig path mapping | **极高** — 破坏所有模块解析，需全量修改 |
| 其余 `CRAFT_*` 环境变量 → `DATAPILOT_*` | 12+ 个环境变量（如 `CRAFT_SERVER_TOKEN` 等） | **高** — 需同步修改所有引用点 |
| CLI wrapper 脚本 `craft-agent` → `datapilot` | `resources/bin/` 下 4 个脚本 | **中** |
| `CraftAgent` 类名 | `craft-agent.ts` 中的类和兼容别名 | **中** — 内部 API 变更 |
| `CRAFT_FEATURE_*` feature flag | `feature-flags.ts` + 引用处 | **中** |
| 构件文件名 `Craft-Agent-xxx` → `DataPilot-xxx` | `electron-builder.yml` + 安装/构建脚本 | **高** — 需同步服务端下载 URL |

**建议:** 剩余改动作为独立 PR，充分测试后再合并。P1 改动后与上游合并会产生大量冲突，需权衡是否值得。

### P2 剩余 — 文档 & 元数据

| 改动项 | 涉及范围 |
|--------|----------|
| `README.md` 中的 "Craft Agent(s)" 品牌名 | 标题、描述、示例等 9+ 处 |
| `SECURITY.md` 安全披露文档 | 品牌名引用 |
| `CONTRIBUTING.md` 贡献指南 | 品牌名引用 |
| 根 `package.json` `"name"` 字段 | 元数据 |

### P3 — 暂不改动（依赖外部服务或影响安全）

| 改动项 | 原因 |
|--------|------|
| `craft.do` / `agents.craft.do` / `mcp.craft.do` 域名 | 后端服务地址，改了会断连 |
| `com.lukilabs.craft-agent` bundle ID | 影响签名和数据迁移 |
| `lukilabs/craft-agents-oss` GitHub 仓库引用 | 实际仓库地址 |
| `*@craft.do` 邮箱 | 真实联系方式 |
| `craftagents://` deep link scheme | 影响 URL 跳转和协议注册 |

---

## 合并上游更新指南

### 关注文件

除 `FORK_MERGE_GUIDE.md` 中已列出的文件外，本分支额外需要关注：

| 文件 | 关注点 |
|------|--------|
| `packages/shared/src/prompts/system.ts` | 上游新增的 "Craft Agent" 文本需替换为 "DataPilot" |
| `packages/shared/src/prompts/print-system-prompt.ts` | 注释中的品牌名和示例路径 |
| `packages/shared/src/auth/oauth.ts` | CLIENT_NAME |
| `packages/shared/src/branding.ts` | 品牌常量 |
| `packages/shared/src/config/paths.ts` | 核心路径定义，上游可能修改注释或新增逻辑 |
| `packages/shared/src/agent/core/config-validator.ts` | 正则模式，上游可能新增 config 类型 |
| `packages/shared/src/agent/core/path-processor.ts` | 路径检测正则 |
| `packages/shared/src/agent/mode-manager.ts` | 路径匹配条件 |
| `packages/shared/src/agent/permissions-config.ts` | 权限目录路径和环境变量 |
| `apps/electron/electron-builder.yml` | productName、DMG title — 上游可能修改构建配置 |
| `apps/electron/src/main/menu.ts` | 菜单项文本 |
| `apps/electron/src/renderer/components/onboarding/` | 欢迎/登录流程文本 |
| `packages/shared/src/agent/errors.ts` | 错误信息文本 |
| `packages/server-core/src/domain/connection-setup-logic.ts` | Provider 标签和错误信息 |
| `scripts/install-app.sh`、`scripts/install-app.ps1` | 安装脚本用户提示 |

### 合并步骤补充

在 `FORK_MERGE_GUIDE.md` 的合并检查清单基础上，额外执行：

1. **合并后全局搜索 `Craft Agent`**（区分大小写），确认用户可见文本中无遗漏
   ```bash
   grep -rn "Craft Agent" --include='*.tsx' --include='*.ts' --include='*.html' --include='*.sh' --include='*.ps1' --include='*.yml' --include='*.json' . | grep -v node_modules | grep -v '/\*' | grep -v '^\s*//'
   ```
2. **合并后全局搜索 `.craft-agent`**，确认数据目录路径无遗漏
   ```bash
   grep -rn '\.craft-agent' --include='*.ts' --include='*.tsx' --include='*.md' . | grep -v node_modules
   ```
3. **合并后搜索 `CRAFT_CONFIG_DIR`**，确认环境变量已统一为 `DATAPILOT_CONFIG_DIR`
4. **检查上游是否新增了身份相关的提示词**，如有，需同步改为 DataPilot
5. **检查上游是否新增了 `@craft-agent/` 引用或 `CRAFT_*` 环境变量**
6. **检查上游是否新增了 `Craft Agents.app` 路径引用**（已改为 `DataPilot.app`）
7. **检查上游是否新增了 `resources/docs/*.md` 文档**，新文档中的 "Craft Agent" 需替换为 "DataPilot"
8. **检查上游是否新增了 `resources/release-notes/*.md`**，每次上游发版都会新增 release notes，需替换其中 "Craft Agent(s)" prose 文本

### 高频变动区域（每次合并必查）

以下区域上游大概率会持续新增包含 "Craft Agent" 的内容，合并后需要常规审查和修改：

| 区域 | 原因 | 审查方法 |
|------|------|----------|
| `resources/release-notes/` | **每次上游发版必新增**一个 release notes 文件，里面几乎必然提到 "Craft Agent(s)" | `grep -rn "Craft Agent" apps/electron/resources/release-notes/ \| grep -v craft-agents-oss` |
| `resources/docs/*.md` | 上游新增功能时会创建新文档或修改现有文档，prose 中可能包含产品名 | `grep -rn "Craft Agent" apps/electron/resources/docs/` |
| `prompts/system.ts` | 上游频繁修改系统提示词，可能新增包含 "Craft Agent" 的段落 | `grep -n "Craft Agent" packages/shared/src/prompts/system.ts` |
| `src/renderer/components/onboarding/` | 上游可能新增或修改引导流程步骤 | `grep -rn "Craft Agent" apps/electron/src/renderer/components/onboarding/` |
| `errors.ts`、`connection-setup-logic.ts` | 上游新增 provider 或连接类型时，错误信息会包含产品名 | `grep -n "Craft Agent" packages/shared/src/agent/errors.ts packages/server-core/src/domain/connection-setup-logic.ts` |
| `scripts/build-server.ts` | 上游增强自部署功能时可能新增 echo/log 输出 | `grep -n "Craft Agent" scripts/build-server.ts` |
| `install-app.sh` / `install-app.ps1` | 上游修改安装流程时可能新增用户提示 | `grep -n "Craft Agent" scripts/install-app.sh scripts/install-app.ps1` |

**建议：** 每次合并上游后，运行以下一行命令快速审查所有打包进应用的 "Craft Agent" 残留：
```bash
grep -rn "Craft Agent" apps/electron/resources/docs/ apps/electron/resources/release-notes/ packages/shared/src/prompts/system.ts apps/electron/src/renderer/ scripts/install-app.sh scripts/install-app.ps1 scripts/build-server.ts | grep -v node_modules | grep -v craft-agents-oss
```

---

## 数据分析场景增强（规划中）

后续可考虑的数据分析专项能力：

- 增强数据源连接（数据库、CSV/Excel、API）
- 数据清洗和转换的内置 skill
- 可视化图表生成（ECharts / Matplotlib）
- 统计分析和建模辅助
- 数据质量检测
- 自动报告生成
