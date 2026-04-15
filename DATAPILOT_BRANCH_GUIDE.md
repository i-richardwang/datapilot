# DataPilot Branch Guide

> 品牌改造的设计记录与参考文档。
> 合并操作请查阅 [FORK_MERGE_GUIDE.md](FORK_MERGE_GUIDE.md)。
>
> **Last updated:** 2026-04-01 (v13, 环境变量/CLI二进制/Agent文档全面品牌适配)

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

### P1（部分）— 数据目录 & 环境变量

将用户数据目录从 `~/.craft-agent/` 改为 `~/.datapilot/`，环境变量 `CRAFT_CONFIG_DIR` 改为 `DATAPILOT_CONFIG_DIR`。涉及 83 个文件。

| 改动类别 | 涉及文件 | 说明 |
|----------|----------|------|
| 核心路径常量 | `config/paths.ts`、`workspaces/storage.ts` 及 12 个本地定义 | `CONFIG_DIR` 从 `.craft-agent` → `.datapilot` |
| 环境变量 | `paths.ts`、`permissions-config.ts`、`electron-dev.ts`、`session-mcp-server` 等 6 处 | `CRAFT_CONFIG_DIR` → `DATAPILOT_CONFIG_DIR` |
| 正则 & 路径匹配 | `config-validator.ts`（9 个正则）、`path-processor.ts`（4 个）、`mode-manager.ts`（3 处）、`UserMessageBubble.tsx`（1 处） | `\.craft-agent` → `\.datapilot` |
| 变量名 | `logo.ts`、`config-validate.ts`、`config-validator.ts` | `CRAFT_AGENT_DIR` → `DATAPILOT_DIR` 等 |
| MCP & 插件标识 | `validation.ts`、`workspaces/storage.ts` | `craft-agent-validator` → `datapilot-validator` 等 |
| UI 组件 | `EditPopover.tsx`、`AppearanceSettingsPage.tsx` 等 8 个 | 用户可见的路径引导文本 |
| 测试文件 | `mode-manager.test.ts`（34 处）等 12 个测试文件 | mock 路径和环境变量 |
| 文档 | `README.md`、`CLAUDE.md`、`resources/docs/*.md`、release notes 等 | 所有 `.craft-agent` 路径引用 |
| 脚本 & 工具 | `electron-dev.ts`、`build-server.ts`、ESLint 规则等 | 多实例开发、Docker、错误信息 |
| Docker 部署 | `docker-compose.yml`、`.env.docker` | `CRAFT_DATA_DIR` → `DATAPILOT_DATA_DIR` 等 |

**未改动：** 加密存储中的 `MAGIC_BYTES`（`CRAFT01`）和密钥派生盐（`craft-agent-v2`）保持原值，仅改了路径。

### P-UI — 用户可感知的品牌名替换

将应用中所有用户能直接看到、读到、听到的 "Craft Agent(s)" 文本替换为 "DataPilot"。涉及约 40 个文件、70+ 处改动。

| 改动类别 | 涉及文件 | 说明 |
|----------|----------|------|
| 应用名称 & 窗口标题 | `electron-builder.yml`、`main/index.ts`、`renderer/index.html` 等 | `productName: DataPilot`、`<title>DataPilot</title>` |
| macOS 菜单栏 | `main/menu.ts`、`AppMenu.tsx`、`TopBar.tsx` | About、Hide、Quit 菜单项 |
| 欢迎/登录流程 | `WelcomeStep.tsx`、`ProviderSelectStep.tsx`、`APISetupStep.tsx` 等 | 所有 onboarding 用户可见文本 |
| 设置页面 | `PreferencesPage.tsx`（5 处） | "Help DataPilot personalize..." |
| 聊天输入框 | `chat.tsx` playground（4 处） | `'Message DataPilot...'` |
| 通知 | `useNotifications.ts` | `'DataPilot has a new message for you'` |
| Provider 标签 | `provider-icons.ts`、`ApiKeyInput.tsx`、`AiSettingsPage.tsx` 等 | `'Craft Agents Backend'` → `'DataPilot Backend'` |
| 错误信息 | `errors.ts`、`connection-setup-logic.ts`、`pi-agent-server/index.ts` | 用户可见错误提示 |
| OAuth 回调页 | `callback-page.ts` | 页面标题和返回链接 |
| CLI 帮助文本 | `cli/src/index.ts` | `'datapilot-cli — Terminal client for DataPilot server'` |
| 安装脚本 | `install-app.sh`（15+ 处）、`install-app.ps1`（10+ 处） | 所有终端输出文本 |
| 构建脚本 | `build/darwin.ts`、`afterPack.cjs`、`build-dmg.sh` 等 | `DataPilot.app` 路径 |
| Viewer 应用 | `viewer/index.html`、`viewer/Header.tsx` | 页面标题和 logo tooltip |
| 应用内文档 | `resources/docs/` 下 8 个 .md | prose 产品名替换 |
| Release Notes | `resources/release-notes/` 下 8 个 .md | prose 产品名替换 |

### 环境变量重命名（v0.8.2 后续，37 文件 176 处）

| 类别 | 示例 |
|------|------|
| 用户可见变量（13 个） | `CRAFT_SERVER_TOKEN` → `DATAPILOT_SERVER_TOKEN`、`CRAFT_RPC_HOST/PORT` → `DATAPILOT_RPC_HOST/PORT`、`CRAFT_WEBUI_*` → `DATAPILOT_WEBUI_*` |
| CLI 变量（2 个） | `CRAFT_SERVER_URL` → `DATAPILOT_SERVER_URL`、`CRAFT_TLS_CA` → `DATAPILOT_TLS_CA` |
| 内部 CLI 变量（7 个） | `CRAFT_CLI_ENTRY` → `DATAPILOT_CLI_ENTRY`、`CRAFT_BUN` → `DATAPILOT_BUN` 等 |

### CLI 二进制名重命名（11 文件 96 处）

- `craft-cli` → `datapilot-cli`（远程终端客户端）
- `craft-server` → `datapilot-server`（服务端二进制、systemd 服务名）
- `craft-agent-batch` → `datapilot-batch`

---

## 有意保留的未改动项

### 代码注释 & JSDoc

源码中仍有 `// Craft Agent ...` 注释，对用户不可见，全局替换会增加合并冲突面。

### package.json `description` 字段

各 `package.json` 的 `"description"` 仍为 `"... for Craft Agents"`，属于 npm 元数据，用户不可见。

### 构件文件名

`electron-builder.yml` 中的 `artifactName` 已改为 `DataPilot-${arch}.${ext}`。但 `scripts/build/` 下的构建脚本中仍有 `Craft-Agents-` 引用（如 `linux.ts`、`darwin.ts`、`common.ts`），与服务端下载 URL 耦合。

### Playground 演示数据

`playground/registry/` 下少量 "Craft Agents" 演示文本，不影响产品体验。

### 测试 Fixture

`storage-startup-migration.test.ts` 中的 `'Craft Agents Backend (xxx)'` mock 数据，与旧存储格式匹配。

