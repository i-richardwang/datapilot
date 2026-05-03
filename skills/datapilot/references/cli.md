---
name: datapilot-cli
description: dtpilot CLI 命令参考。执行任何 dtpilot 命令前加载。只记录 `dtpilot <entity>`（不带 action）列不出来的东西：输入规则、字段、返回结构、枚举、陷阱。
---

# CLI 命令参考

**一手信息来源**：`dtpilot <entity>` 不带 action 会返回该实体的 action 列表；每个 action 的 positional/flag 用法在出错时通常由 `suggestion` 字段给出。本文件记录 **action 列表看不到的东西**：输入规则、必需字段、返回 JSON 结构、枚举值、陷阱。

## Usage 语法

```
dtpilot [global-flags] <entity> [action] [positionals...] [flags...]
```

只传 entity（不带 action）→ 返回该 entity 的 action 列表（JSON）。`--` 结束 flag 解析，后续全按 positional 对待。

## 全局 flags

| flag | 环境变量 | 默认 |
|---|---|---|
| `--url <ws-url>` | `DATAPILOT_SERVER_URL` | `ws://127.0.0.1:9100` |
| `--token <secret>` | `DATAPILOT_SERVER_TOKEN` | discovery 文件 |
| `--workspace <id>` | — | `workspaces:get` 的第一个 |
| `--tls-ca <path>` | `DATAPILOT_TLS_CA` | 无 |
| `--timeout <ms>` | — | `30000` |
| `--json` / `--human` | — | 按 TTY 自动选 |

详细解析顺序见 [connection.md](connection.md)。

## 通用约定

- **输入面规则**：flat flag **只做三件事**：
  - **身份**：`--name`
  - **schema 分支选择**：`--event`、`--provider`、`--type`
  - **读侧 query**：`--limit`、`--offset`、`--sample-size`、`--index`、`--session`、`--html <file>`

  其它**所有数据字段**（`color`、`parentId`、`valueType`、`permissionMode`、`enabledSourceSlugs`、`pattern`、`description`……）一律走 `--input '<json-object>'` 或 `--stdin`。传不认识的 flat flag 会立即 `USAGE_ERROR`，错误消息里会指向对应的 JSON key，例如：`Unknown flag --mode. Pass data fields via --input '<json>' (e.g., --input '{"permissionMode":"..."}')`。

- **Positional vs flag**：ID / slug 是 positional；身份 / schema / query 是 flat flag；业务数据是 `--input` JSON。

## 探未知字段的三招

Server 端 schema 可能会演进，硬编码字段容易过时。不知道怎么填 `--input` 时按这三招依次试：

1. **不带必需字段跑一次**，让错误消息吐合法值。例如不带 `--event` 跑 `automation create`，错误消息会把所有合法事件名列出来。
2. **观察现有实例**：`dtpilot <entity> list | jq '.data[0]'` 拿一个现成的当模板。对 automation 这类按事件分组的：`dtpilot automation list | jq '.data.automations.<EventName>[0]'`。
3. **先 `test` 再 `create`**（只 batch 支持）：`batch test <id> --sample-size 1` 验证单条通过，再 `batch start`。

**别用 `create --input '{}'` 反推 schema**：server 对部分实体（尤其 `automation`）会接受半残配置留一个可触发的存根，事后得手动 `list` + `delete` 清。探 schema 走上面三招就够，不要真 create。

## 输出 envelope（非 TTY）

```json
// 成功
{ "ok": true, "data": <any>, "warnings": [] }
// 失败
{ "ok": false, "error": { "code": "...", "message": "...", "suggestion": "..." }, "warnings": [] }
```

**Error code**（对应 exit code）：

| code | exit | 含义 |
|---|---|---|
| `USAGE_ERROR` | 2 | 参数不对，看 `suggestion` |
| `VALIDATION_ERROR` | 1 | 输入字段非法 / workspace 缺失 |
| `NOT_FOUND` | 1 | ID 不存在 |
| `CONNECTION_ERROR` | 1 | 连不上 server |
| `INTERNAL_ERROR` | 1 | server 内部错 |

---

## 实体参考

当前 CLI 暴露 7 个实体：`session` / `batch` / `automation` / `workspace` / `source` / `skill` / `label`。每个实体完整 action 列表用 `dtpilot <entity>` 拿。下面只记**语义要点、必需字段、返回结构、枚举、陷阱**。

### session — 会话与消息（核心）

**`session create`** — 创建不发消息。**flat flag 只有 `--name`**；其它字段（`permissionMode`、`enabledSourceSlugs`、`model`、`thinkingLevel`、`isFlagged`……）全部走 `--input '<json>'`。不传 `permissionMode` 时默认 `allow-all`。返回完整 session 对象。

示例：`dtpilot session create --name "分析" --input '{"permissionMode":"safe","enabledSourceSlugs":["sales"]}'`

**`session send <id> <message...>`** — 消息是剩余所有 positional 拼起来（`send $ID hello world` → "hello world"）。shell 里有特殊字符用引号包起来。**立刻返回 `{started: true}`**，不是 agent 回复；轮询方式见 [task-delegation.md](task-delegation.md)。

**`session messages <id>`** — **返回整个 session 对象**（不是消息数组）：`{id, name, isProcessing, messages: [...], ...}`。消息在 `.messages[]`，每条有 `role` (`user` / `assistant`) 和 `content`。取最后一条：`jq '.data.messages[-1]'`（注意不是 `.data[-1]`）。

**`session share <id> [--html <file>]`** — 双模式：不带 `--html` 分享整段 session 只读链接；带 `--html <file>` CLI 读取本地 HTML 上传，返回可访问 URL。两种模式都返回 `{url, id}` —— 取 URL：`jq -r .data.url`。`<id>` 可被 `$CRAFT_SESSION_ID` 替代。

**`permissionMode` 合法值**：

| 值 | 行为 |
|---|---|
| `safe` | 只读为主，写/执行需确认 |
| `ask` | 写前问 |
| `allow-all` | 自动执行不问（默认值，危险，只在受控环境） |

**Session 其它常见 `--input` 字段**：

- `model` — 模型 slug（对应某个 LLM connection）
- `thinkingLevel` — `low` / `medium` / `high`
- `enabledSourceSlugs` — `string[]`，允许用的数据源 slug；**不知道 slug 先 `dtpilot source list` 看 `.data[].slug`**。不传就是空集（纯 LLM 无外部工具）
- `workingDirectory` — agent 的 bash cwd，绝对路径或特殊值 `"user_default"` / `"none"`。默认在 `sessions/{sid}/`；需要 session agent 在 workspace 根或某个具体项目目录（git 仓库 / batch 输入文件）做事时必传
- `isFlagged` — 标星

### batch — 批量并发任务（核心）

`source.path` 和 `output.path` 都指向 server 文件系统（绝对路径或相对 workspace root）。创建新 batch 前输入数据需要已在 server 路径上 —— 常见来路：原有 source、之前 session 写的产物、共享挂载，以及 `workspace get` 报 `connection.sameMachine = true` 时本地路径也算（CLI 跟 server 同机）。**远程 server 时 CLI 没有文件上传通道**：要么调用方自己把文件落到 server 可达路径，要么先起一个 session 让 agent 写好输入再 `batch create`。

`batch items` 返回的是每条 item 的 state（status / sessionId / summary / error），不含 `output.jsonl` 的原文 —— 要原文得另起 session 去读那个文件。

**`batch create`** — **flat flag 只有 `--name`**；其它字段走 `--input`。`--name` 也可以放 `--input` 里。返回 `{id, ...}`。

**`--input` 顶层字段**（schema 可能演进，拿不准用"探未知三招"的第 2 招看现有 batch 结构）：

| 字段 | 必填 | 作用 |
|---|---|---|
| `name` | ✓ | 展示名 |
| `source` | ✓ | 数据源配置（对象，含 `type` / `path` / `idField`；`type` 枚举 `csv` / `json` / `jsonl`；`path` 支持绝对路径或相对 workspace root 的相对路径） |
| `action` | ✓ | 对每条 item 做什么。典型形状 `{type: "prompt", prompt: "..."}`。**prompt 里引用 item 字段用 shell env 风格 `${BATCH_ITEM_<FIELDNAME_UPPER>}` 或 `$BATCH_ITEM_<FIELDNAME_UPPER>`**（见下方模板语法），不是 `{{name}}` —— 写错会把字面量发给 agent |
| `execution` | — | 并发、重试、permissionMode、tool profile |
| `output` | — | `{path, schema?}`；`path` 必须 `.jsonl` 后缀，支持绝对/相对路径；output 只在 server 磁盘写，**CLI 没有下载通道** |
| `workingDirectory` | — | batch 起的 session 的 cwd（绝对路径），不传用 workspace 默认 |

**Prompt 模板语法**：item 字段在传给 agent 前做 env 展开，变量名是 `BATCH_ITEM_<FIELDNAME_UPPER>`（字段名大写，非 `A-Z0-9_` 的字符替换成 `_`）。例如 source item 是 `{"id":1,"text":"..."}`，prompt 里写 `${BATCH_ITEM_TEXT}` 或 `$BATCH_ITEM_TEXT` 就会被替换成那条 item 的 text。`{{text}}` 这类 Mustache 风格**不会**被替换。

**`batch get <id>`** — 返回 batch 本体合并一个 `progress` 字段：`{...batch_fields, progress: {batchId, status, totalItems, completedItems, failedItems, runningItems, pendingItems}}`。**轮询状态就用它**，字段在 `.data.progress.status`（注意：是 `status` 不是 `phase`）。

**`batch.progress.status` 合法值**（定义在 `BatchStatus` 类型）：
- 运行中 / 中间态：`pending` / `running` / `paused`
- 终止态：`completed` / `failed`

（**没有 `cancelled`**；想中止 batch 用 `pause` 或 `delete`。）

**`batch items <id> [--offset N] [--limit N]`** — 每条 item 的结果。长任务的最终产物从这里读。**返回 page 对象**：`{items: [{id, state}], total, offset, limit, runningOffset}` —— item 数组在 `.data.items`（不是 `.data[]`），每个 item 的字段在 `.state` 下嵌套，不是 flat。

**`item.state` 字段**：`{status, sessionId, startedAt, completedAt, retryCount, error?, summary?}`。`summary` 是展开后的 prompt 片段（做 UI 显示用），**不是 agent 的回复** —— 要拿回复得用 `.state.sessionId` 起 `dtpilot session messages <sessionId>` 读。

**`item.state.status` 合法值**（`BatchItemStatus`）：`pending` / `running` / `completed` / `failed` / `skipped`。筛失败项：`jq '.data.items[] | select(.state.status=="failed")'`。

**`batch test <id> [--sample-size N]`** — 用已创建 batch 的配置跑单条/小样本，不做 full run。第一次写 config 先 test 再 start 省很多时间。

### automation — 事件驱动（核心）

**`automation create --name <n> --event <EventName> [--input '<json>']`** — `--name` 和 `--event` 是 flat flag，其它 matcher 字段走 `--input`。**合法事件名不用硬记**：不带 `--event` 直接跑，错误消息里会列出所有合法值。

**`actions` 字段必填，`action.type` 只有两种合法值**（create 端不做类型校验，但 test / 真实触发时会按下面 shape 要求；写错类型到 test 才报错）：

| type | 必需字段 | 可选字段 | 语义 |
|---|---|---|---|
| `prompt` | `prompt` (string) | `labels[]` / `mentions[]` / `model` / `llmConnection` | 起 session 跑这段 prompt |
| `webhook` | `url` | `method` (默认 POST) / `headers` / `body` | 发 HTTP 请求 |

**`automation list`** — 按事件分组返回：`{automations: {EventName: [matcher, ...]}}`。想看某个事件的 matcher 字段长什么样：`jq '.data.automations.<EventName>[0]'`。

**`automation history <id> [--limit 50]`** — **id 必须作为位置参数**；返回该 automation 的历史执行条目。

**`automation test --input '<json>'`** — 干跑一次验证 action 可执行。输入需要至少 `{event, actions}`；`workspaceId` 由 CLI 自动补。prompt action 会**真起 session**（返回 `sessionId`），不会走 matcher 过滤（不做事件匹配，就直接执行 actions）。典型：

```bash
dtpilot automation test --input '{
  "event": "UserPromptSubmit",
  "actions": [{"type":"prompt","prompt":"说 hello"}]
}'
# → {actions: [{type:"prompt", success:true, sessionId, duration}]}
```

**`enable` 之后 automation 脱离 CLI 独立运行** —— CLI 只是配置面，enable 后是 server 侧常驻。

### workspace — 工作区（只读）

- `workspace list` — 所有可见 workspace，**第一个是自动检测的默认作用域**。
- `workspace get [<id>]` — 返回 `{...workspace, settings, connection}`；`connection.sameMachine` 是布尔，决定本地文件能否直接喂给 batch/session（见 [batch 段](#batch--批量并发任务核心)）。

---

## 配置类实体

写操作（create/update/delete）主要服务于"管理 DataPilot 自身"，agent-to-agent 场景少用；**读操作**（list/get）常用于发现 slug 与结构。

### source — 数据源（MCP / REST API / 本地 FS）

- **`source list`** 返回扁平数组。给 session 传 `enabledSourceSlugs` 之前先在这里查 `.data[].slug`
- `source get <slug>` 返回 `{...source, permissions, mcpTools}`
- `source create` 的 flat flag：`--name` + `--provider` + `--type`；其它字段走 `--input`
- **`type` 合法值**：`mcp` / `api` / `local`
- **`provider`** 是自由字符串（每个部署自己定义），但有一组走 OAuth 特殊处理的已知值：`google` / `microsoft` / `linear` / `github` / `notion` / `slack` / `exa`

### skill — workspace 内的 skill 定义

- `skill list` 返回扁平数组；`skill get <slug>` 看完整定义
- `skill create` 的 flat flag **只有 `--name`**；**slug 由 server 从 name 自动推导**，要覆盖就在 `--input` 里传 `slug`
- 其它字段（`description`、`body`、`globs`、`requiredSources`……）走 `--input`

### label — 标签树 + auto-rule 自动打标

- **`label list` 返回的是顶层 label 数组，每个带 `children[]`**（树形）。想遍历所有 label 要递归 `children`，`.data[0].id` 只是根分类 id。
- `label create` 的 flat flag 只有 `--name`；`color` / `parentId` / `valueType` 走 `--input`
- `label update <id>` 没有 flat flag，全部走 `--input`；`valueType: "none"` 会清空
- `label auto-rule-add <id> --input '{"pattern":"<regex>", "flags":"...", "valueTemplate":"...", "description":"..."}'`
- `label auto-rule-remove <id> --index <n>`
