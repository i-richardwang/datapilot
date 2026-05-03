# DataPilot Branch Guide

> 品牌改造的设计原则与"故意不改"清单。
> 合并操作、冲突区域、审计脚本请查阅 [FORK_MERGE_GUIDE.md](FORK_MERGE_GUIDE.md)。

## 目标

基于 Craft Agent 开源项目，构建一个专注于数据分析的垂直 Agent。改造分阶段进行，优先处理用户感知层（提示词、品牌），再逐步深入到内部标识和功能增强。改造范围、文件清单、品牌审计 grep 都在 FORK_MERGE_GUIDE.md 维护，本文档只记录"故意不改"的项——这类反指令在 git diff 里看不出来，每次品牌审计都要靠它来排除误报。

## 有意保留的未改动项

### 加密存储 magic bytes 与盐

`MAGIC_BYTES`（`CRAFT01`）和密钥派生盐（`craft-agent-v2`）保持原值。改了会破坏现有用户的本地加密数据，没有 migration 路径。

### 代码注释 & JSDoc

源码中仍有 `// Craft Agent ...` 注释，对用户不可见，全局替换会增加合并冲突面。

### `package.json` `description` 字段

各 `package.json` 的 `"description"` 仍为 `"... for Craft Agents"`，属于 npm 元数据，用户不可见。`@craft-agent/*` package 名同理保留——动它会触发跨包 import 全量重写。

### `scripts/build/` 下的构件文件名

`electron-builder.yml` 的 `artifactName` 已是 `DataPilot-${arch}.${ext}`，但 `scripts/build/linux.ts`、`darwin.ts`、`common.ts` 中仍有 `Craft-Agents-` 引用，与服务端下载 URL 耦合，动了会断掉自动更新。

### Playground 演示数据

`playground/registry/` 下少量 "Craft Agents" 演示文本，不影响产品体验。

### 测试 Fixture

`storage-startup-migration.test.ts` 中的 `'Craft Agents Backend (xxx)'` mock 数据，与旧存储格式匹配——动了反而让迁移测试失去意义。

### 保留的 `CRAFT_*` 命名空间

automation hook 环境变量、webhook secret 前缀、deeplink scheme（`craftagents://`）、feature flag 内部名等带外部契约或用户脚本依赖的名称保持不变。完整 allow-list 见 FORK_MERGE_GUIDE.md 的 "Branding Audit" 段。
